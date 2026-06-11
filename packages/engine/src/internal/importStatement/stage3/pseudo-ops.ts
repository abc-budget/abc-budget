/**
 * Pseudo-op expander — Story 2.5, Task 3 (ENT-013).
 *
 * NEW: `expandPseudoOps(row, columns, baseCurrency)`
 *   For each eligible row (generated OR income-skipped — see row-generator.ts for
 *   the spawn scope), inspects BANK_COMMISSION and CASHBACK columns. For every
 *   non-null, non-error cell it spawns an independent TransactionRow (pseudo-op)
 *   with:
 *     - date/account/source from the original row
 *     - abs(amount) from the respective cell
 *     - currency per the column's ENT-011 CurrencyDetectOptions params
 *     - synthetic description via the $t catalog key (hash-stable; translated at 2.8)
 *     - isBankCommission / isCashback set accordingly
 *     - hash via calculateRowHash with the Q-011 discriminator ('commission'|'cashback')
 *
 * Currency resolution (adapted from detectAmountAndCurrency):
 *   'use_base'   → baseCurrency
 *   { code }     → validated via symbolToIso (code passthrough); throws on unknown code
 *   'auto'       → no CURRENCY column context for pseudo-ops (they're not AMOUNT rows);
 *                  falls back to baseCurrency (the safest/least-surprising default)
 *
 * FEAT-022 collect-don't-throw: a failed pseudo-op (cell error, currency throw) →
 *   errors[] entry with { rowIndex, columnId, errors: [msg] }. The sibling pseudo-op
 *   (if any) is unaffected. This function NEVER throws.
 *
 * ENT-013 ordering: commission before cashback (per the design spec shape table).
 */

import { $t } from '../../utils/messages/index';
import type { Message } from '../../utils/messages/message';
import { symbolToIso } from '../../currency/reference';
import { getLogger } from '../../logging';
import type { ImportStatementRowData } from '../stage2/types';
import { ColumnDefinition } from '../types';
import type { BankCommissionColumnParams, CashbackColumnParams } from '../types';
import { calculateRowHash } from './hash';
import type { PseudoOpKind } from './hash';
import type { ColumnInfo } from './row-generator';
import type { RowError, TransactionRow } from './types';

const logger = getLogger('engine.importStatement.stage3.pseudo-ops');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Expands a single source row into zero or more pseudo-operation rows.
 *
 * Called after main-op generation (or after the income-skip branch for
 * income-skipped rows) — the spawn scope is decided by the caller (row-generator).
 *
 * @param row          Source stage2 row data (date, account, commission/cashback cells).
 * @param columns      All column definitions for this statement.
 * @param baseCurrency Resolved base currency ISO code (e.g. 'UAH').
 * @returns            `{ ops, errors }` — NEVER throws.
 */
export async function expandPseudoOps(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
  baseCurrency: string,
): Promise<{ ops: TransactionRow[]; errors: RowError[] }> {
  const ops: TransactionRow[] = [];
  const errors: RowError[] = [];

  // Find the commission column (first one wins)
  const commissionColumn = columns.find(
    (c) => c.definition === ColumnDefinition.BANK_COMMISSION,
  );

  // Find the cashback column (first one wins)
  const cashbackColumn = columns.find(
    (c) => c.definition === ColumnDefinition.CASHBACK,
  );

  // Extract date and account from the original row (shared across pseudo-ops)
  const date = extractDate(row, columns);
  const account = extractAccount(row, columns);

  // ── Commission pseudo-op ──────────────────────────────────────────────────
  if (commissionColumn) {
    const result = await tryBuildPseudoOp(
      row,
      commissionColumn.id,
      commissionColumn.params as BankCommissionColumnParams | null,
      'commission',
      date,
      account,
      baseCurrency,
      columns,
      $t('engine.importStatement.pseudo-op.bank-commission').getText(),
      /* isBankCommission */ true,
      /* isCashback */ false,
    );
    if (result.op) {
      ops.push(result.op);
    }
    if (result.error) {
      errors.push(result.error);
    }
  }

  // ── Cashback pseudo-op ────────────────────────────────────────────────────
  if (cashbackColumn) {
    const result = await tryBuildPseudoOp(
      row,
      cashbackColumn.id,
      cashbackColumn.params as CashbackColumnParams | null,
      'cashback',
      date,
      account,
      baseCurrency,
      columns,
      $t('engine.importStatement.pseudo-op.cashback').getText(),
      /* isBankCommission */ false,
      /* isCashback */ true,
    );
    if (result.op) {
      ops.push(result.op);
    }
    if (result.error) {
      errors.push(result.error);
    }
  }

  return { ops, errors };
}

// ---------------------------------------------------------------------------
// Internal builder
// ---------------------------------------------------------------------------

/**
 * Attempts to build a single pseudo-op for the given column.
 * Returns `{ op }` on success, `{ error }` on failure, `{}` when cell is null/empty.
 * NEVER throws.
 */
async function tryBuildPseudoOp(
  row: ImportStatementRowData,
  columnId: string,
  params: BankCommissionColumnParams | CashbackColumnParams | null,
  discriminator: PseudoOpKind,
  date: Date,
  account: string | null,
  baseCurrency: string,
  columns: ColumnInfo[],
  description: string,
  isBankCommission: boolean,
  isCashback: boolean,
): Promise<{ op?: TransactionRow; error?: RowError }> {
  try {
    const cell = row.get(columnId);

    // Skip null cells (empty stage2 value — no pseudo-op, no error)
    if (cell.value === null || cell.value === undefined) {
      return {};
    }

    // If the cell itself carries a stage2 parse error, report it as a pseudo-op error
    if (cell.error != null) {
      logger.debug(
        `Pseudo-op ${discriminator} at row ${row.rowIndex} column ${columnId}: cell error`,
        cell.error,
      );
      return {
        error: {
          rowIndex: row.rowIndex,
          columnId,
          errors: [cell.error as Message],
        },
      };
    }

    // Resolve amount — abs value per the spec (flags carry semantics, not sign)
    const rawAmount = cell.value as number;
    const amount = Math.abs(rawAmount);

    // Resolve currency from the column's ENT-011 params
    const currency = resolvePseudoOpCurrency(params, baseCurrency, columns, row);

    // Compute hash with Q-011 discriminator
    const hash = await calculateRowHash(row, columns, discriminator);

    const op: TransactionRow = {
      rowIndex: row.rowIndex, // re-index pass in generateRows will sync this
      hash,
      source: null,
      date,
      amount,
      currency,
      description,
      counterparty: null,
      account,
      bankCategory: null,
      mcc: null,
      isBankCommission,
      isCashback,
      category: null,
      isManuallySetCategory: false,
    };

    return { op };
  } catch (err) {
    const msg =
      err instanceof Error
        ? $t('engine.importStatement.stage3.row-generation-error', {
            rowIndex: row.rowIndex,
            message: err.message,
          })
        : $t('engine.importStatement.stage3.row-generation-error', {
            rowIndex: row.rowIndex,
            message: String(err),
          });

    logger.error(
      `Pseudo-op ${discriminator} at row ${row.rowIndex} column ${columnId}: threw`,
      err,
    );

    return {
      error: {
        rowIndex: row.rowIndex,
        columnId,
        errors: [msg as Message],
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Currency resolution (adapted from detectAmountAndCurrency)
// ---------------------------------------------------------------------------

/**
 * Resolves the currency for a pseudo-op cell.
 *
 * Adapted from the single-amount-column path of `detectAmountAndCurrency`:
 *   - 'use_base'  → baseCurrency
 *   - { code }    → validated via symbolToIso (code passthrough rule); throws
 *                   LocalizableException on unknown code
 *   - 'auto'      → no per-row CURRENCY column context for pseudo-ops
 *                   (they're not AMOUNT rows); falls back to baseCurrency
 *   - null params → baseCurrency
 *
 * The 'auto' fallback is the one deliberate adaptation from detectAmountAndCurrency:
 * the AMOUNT 'auto' path reads the CURRENCY column for the same row, but pseudo-ops
 * are additional ops, not the main AMOUNT row. Reading the main row's CURRENCY column
 * for the pseudo-op's amount would be semantically incorrect (the commission/cashback
 * may be in the same or different currency). ENT-011 'auto' for pseudo-ops therefore
 * means "unspecified — use base". This is documented here for the diff-audit.
 */
function resolvePseudoOpCurrency(
  params: BankCommissionColumnParams | CashbackColumnParams | null,
  baseCurrency: string,
  _columns: ColumnInfo[],
  _row: ImportStatementRowData,
): string {
  if (!params) {
    return baseCurrency;
  }

  if (params.currency === 'use_base') {
    return baseCurrency;
  }

  if (params.currency === 'auto') {
    // 'auto' with no dedicated CURRENCY-column context for pseudo-ops → base
    return baseCurrency;
  }

  // { code } override — validate via symbolToIso code passthrough
  if (typeof params.currency === 'object' && params.currency.code) {
    const code = params.currency.code;
    const resolved = symbolToIso(code.toUpperCase());
    if (resolved !== undefined) {
      return code;
    }
    // Unknown code — throw (caller's try/catch converts to RowError)
    throw new Error(
      `expandPseudoOps: unknown currency code "${code}" in column params`,
    );
  }

  return baseCurrency;
}

// ---------------------------------------------------------------------------
// Field extractors (mirrors row-generator.ts logic; copied for locality)
// ---------------------------------------------------------------------------

/**
 * Extracts the date from the row's DATE column.
 * Returns a sentinel date on failure (pseudo-ops should still get a date even
 * if date extraction is dodgy — the main-op error path already handles the error).
 */
function extractDate(row: ImportStatementRowData, columns: ColumnInfo[]): Date {
  const dateCols = columns.filter((c) => c.definition === ColumnDefinition.DATE);
  if (dateCols.length === 1) {
    const val = row.get(dateCols[0].id).value;
    if (val instanceof Date) {
      return val;
    }
  }
  // Fallback: epoch (should not reach here in normal usage — main-op already threw)
  return new Date(0);
}

/**
 * Extracts the account from the row's BANK_ACCOUNT column(s).
 * Mirrors row-generator.ts extractAccount — joins multiple values with space.
 */
function extractAccount(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): string | null {
  const accountCols = columns.filter(
    (c) => c.definition === ColumnDefinition.BANK_ACCOUNT,
  );
  if (accountCols.length === 0) return null;
  if (accountCols.length === 1) {
    return row.get(accountCols[0].id).value as string;
  }
  const values = accountCols.map((c) => row.get(c.id).value as string);
  return values.filter(Boolean).join(' ') || null;
}
