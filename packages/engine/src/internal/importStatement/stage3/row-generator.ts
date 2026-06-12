/**
 * Row generator for stage 3 — REBUILT per FEAT-022.
 *
 * PORT+REBUILD of `webapp/libs/engine/src/importStatement/stage3/row-generator.ts`.
 *
 * REBUILD contract (FEAT-022) vs prior art:
 *   Prior art: `generateStage3Rows` throws `LocalizableException` on the FIRST bad row
 *              and aborts generation.
 *   This version: `generateRows` NEVER throws. A bad row → `rowErrors.push(...)` and
 *              generation CONTINUES with the next row. Good rows always generate.
 *
 * New output shape (GenerateRowsResult):
 *   { rows: TransactionRow[], rowErrors: RowError[], skipped: SkippedRow[] }
 *   - `rows`      — successfully generated transaction rows.
 *   - `rowErrors` — per-row error entries for rows that could not be generated.
 *   - `skipped`   — income / mixed-positive rows discarded with a reason (VIS-011).
 *                   DISTINCT from errors — the row is valid data, not a spend.
 *
 * COUNTERPARTY (ENT-006):
 *   Generated rows carry `counterparty: string | null` — distinct from `description`.
 *   Populated from COUNTERPARTY-mapped columns.
 *
 * TIME (ENT-001):
 *   No `time` field is ever emitted (TIME columns discard their data in stage 2;
 *   this generator never looks for TIME columns).
 *
 * Categorization (scope decision):
 *   `category` and `isManuallySetCategory` are hardcoded to `null` / `false`.
 *   `isBankCommission` and `isCashback` are hardcoded to `false` (2.5 expansion).
 *   The decision-tree / categorization machinery is NOT ported here (EP-4).
 *
 * Adaptations vs prior art (diff-audit):
 *   1. `UserSettingsService` + `CurrencyCache` → replaced with plain `baseCurrency: string`
 *      and the internal `detectAmountAndCurrency` (which uses `symbolToIso` for validation).
 *   2. `calculateRowHash` imported from local `./hash` (inlines WebCrypto).
 *   3. `$t` / `LocalizableException` from internal `../../utils/messages/index`.
 *   4. `getLogger` from internal `../../logging`.
 *   5. Import paths all relative-internal.
 *   6. verbatimModuleSyntax: `import type` for interfaces.
 *   7. Output function renamed `generateRows` (was `generateStage3Rows`); the old name
 *      is re-exported as an alias for backward compat with any callers.
 */

import { getLogger } from '../../logging';
import { $t } from '../../utils/messages/index';
import type { Message } from '../../utils/messages/message';
import type { ImportStatementRowData } from '../stage2/types';
import { ColumnDefinition } from '../types';
import type { AmountColumnParams, ColumnParams } from '../types';
import { detectAmountAndCurrency } from './amount-currency-detector';
import { calculateRowHash } from './hash';
import { expandPseudoOps } from './pseudo-ops';
import type {
  GenerateRowsResult,
  RowError,
  SkippedRow,
  TransactionRow,
} from './types';

const logger = getLogger('engine.importStatement.stage3.row-generator');

// ---------------------------------------------------------------------------
// ColumnInfo — identical shape to prior art
// ---------------------------------------------------------------------------

/**
 * Column information for row generation.
 * Verbatim from prior art.
 */
export interface ColumnInfo {
  /** The column ID */
  id: string;
  /** The column definition */
  definition: ColumnDefinition | null;
  /** The column parameters (for AMOUNT columns) */
  params: ColumnParams | AmountColumnParams | null;
}

// ---------------------------------------------------------------------------
// Main entry point — FEAT-022 collect-don't-throw
// ---------------------------------------------------------------------------

/**
 * Generates transaction rows from filtered stage2 rows.
 *
 * FEAT-022 contract: NEVER throws. A bad row → `rowErrors` entry + generation
 * continues. Income / ignored rows → `skipped` entries with reasons (VIS-011).
 *
 * @param rows         Stage2 rows to process.
 * @param columns      Column definitions (AMOUNT, DATE, DESCRIPTION, COUNTERPARTY, etc.).
 * @param baseCurrency Resolved base currency ISO code (e.g. 'USD').
 * @returns            `{ rows, rowErrors, skipped }` — never throws.
 */
export async function generateRows(
  rows: ImportStatementRowData[],
  columns: ColumnInfo[],
  baseCurrency: string,
): Promise<GenerateRowsResult> {
  const resultRows: TransactionRow[] = [];
  const rowErrors: RowError[] = [];
  const skipped: SkippedRow[] = [];

  for (const row of rows) {
    try {
      // ── Check for income / ignored cells (VIS-011) ────────────────────────
      // A row is skipped (not errored) when the AMOUNT cell has an `ignore` message.
      // This mirrors the stage2 label-and-discard semantics end-to-end.
      // NOTE: getAmountIgnoreMessage calls row.get() which may throw for corrupted rows;
      // we check it inside the try so corrupt rows land in rowErrors, not uncaught.
      const amountIgnoreMessage = getAmountIgnoreMessage(row, columns);
      if (amountIgnoreMessage !== null) {
        logger.debug(`Row ${row.rowIndex} skipped (income/ignored):`, amountIgnoreMessage);
        skipped.push({ rowIndex: row.rowIndex, reason: amountIgnoreMessage });
        // ── SPAWN-SCOPE PIN 1 (decision 3): income-skipped main still spawns pseudo-ops ──
        // An income transfer (+50 000) may carry a real commission/cashback expense.
        // Dropping it would silently lose money (the worst failure class).
        // Pseudo-ops are INDEPENDENT operations — their nature does not inherit the
        // main's income direction (ENT-013).
        const { ops: pseudoOps, errors: pseudoErrors } = await expandPseudoOps(
          row, columns, baseCurrency,
        );
        resultRows.push(...pseudoOps);
        rowErrors.push(...pseudoErrors);
        continue;
      }

      // ── Generate the row ───────────────────────────────────────────────────
      const transactionRow = await generateSingleRow(row, columns, baseCurrency);
      resultRows.push(transactionRow);

      // ── SPAWN-SCOPE: expand pseudo-ops after successful main-op generation ──
      // Ordered: main (already pushed), then commission, then cashback.
      // The final re-index pass syncs rowIndex = array index for all.
      const { ops: pseudoOps, errors: pseudoErrors } = await expandPseudoOps(
        row, columns, baseCurrency,
      );
      resultRows.push(...pseudoOps);
      rowErrors.push(...pseudoErrors);
    } catch (err) {
      // ── SPAWN-SCOPE PIN 2 (decision 3): errored rows NEVER spawn pseudo-ops ──
      // No reliable date/account to donate; the rowError already reports loudly.
      const errorMessage =
        err instanceof Error
          ? $t('engine.importStatement.stage3.row-generation-error', {
              rowIndex: row.rowIndex,
              message: err.message,
            })
          : $t('engine.importStatement.stage3.row-generation-error', {
              rowIndex: row.rowIndex,
              message: String(err),
            });

      logger.error(`Row generation error at row ${row.rowIndex}:`, err);
      rowErrors.push({
        rowIndex: row.rowIndex,
        errors: [errorMessage as Message],
      });
    }
  }

  // Sync rowIndex with array index (performance optimization, verbatim from prior art)
  for (let i = 0; i < resultRows.length; i++) {
    resultRows[i].rowIndex = i;
  }

  return { rows: resultRows, rowErrors, skipped };
}

// ---------------------------------------------------------------------------
// Single-row generator (throws — wrapped by generateRows)
// ---------------------------------------------------------------------------

/**
 * Generates a single TransactionRow from a stage2 row.
 * Throws on any validation failure — `generateRows` catches and collects.
 */
async function generateSingleRow(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
  baseCurrency: string,
): Promise<TransactionRow> {
  // Hash
  const hash = await calculateRowHash(row, columns);

  // Date (required)
  const date = extractDate(row, columns);

  // Amount + currency (synchronous with pre-resolved baseCurrency)
  const { amount, currency } = detectAmountAndCurrency(row, columns, baseCurrency);

  // Description
  const description = extractDescription(row, columns);

  // Counterparty (ENT-006 — distinct from description)
  const counterparty = extractCounterparty(row, columns);

  // Account
  const account = extractAccount(row, columns);

  // Bank category
  const bankCategory = extractBankCategory(row, columns);

  // MCC
  const mcc = extractMerchantCategoryCode(row, columns);

  return {
    rowIndex: row.rowIndex,
    hash,
    source: null,
    date,
    amount,
    currency,
    description,
    counterparty,
    account,
    bankCategory,
    mcc,
    isBankCommission: false,   // 2.5 expansion — hardcoded false (per prior art)
    isCashback: false,          // 2.5 expansion — hardcoded false (per prior art)
    category: null,             // EP-4 — categorization not in scope
    isManuallySetCategory: false,
  };
}

// ---------------------------------------------------------------------------
// Field extractors (verbatim logic from prior art, adapted to new ColumnInfo shape)
// ---------------------------------------------------------------------------

/**
 * Returns the `ignore` message from the AMOUNT column cell for this row, or null.
 * Used to detect income / mixed-positive rows (VIS-011 label-and-discard).
 */
function getAmountIgnoreMessage(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): Message | null {
  const amountColumns = columns.filter(
    (col) => col.definition === ColumnDefinition.AMOUNT
  );
  for (const col of amountColumns) {
    const cell = row.get(col.id);
    if (cell.ignore !== null && cell.ignore !== undefined) {
      return cell.ignore;
    }
  }
  return null;
}

/**
 * Extracts the date from a row.
 * Verbatim from prior art — throws LocalizableException on missing or duplicate DATE column.
 */
function extractDate(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): Date {
  const dateColumns = columns.filter(
    (col) => col.definition === ColumnDefinition.DATE
  );

  if (dateColumns.length === 0) {
    logger.error('No DATE column found in the data');
    throw new Error(
      $t('engine.importStatement.stage3.no-date-column').getText()
    );
  }

  if (dateColumns.length > 1) {
    logger.error('Multiple DATE columns found in the data');
    throw new Error(
      $t('engine.importStatement.stage3.multiple-date-columns').getText()
    );
  }

  return row.get(dateColumns[0].id).value as Date;
}

/**
 * Extracts the description from a row.
 * Multiple DESCRIPTION columns → joined by space (verbatim from prior art).
 */
function extractDescription(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): string | null {
  const descriptionColumns = columns.filter(
    (col) => col.definition === ColumnDefinition.DESCRIPTION
  );

  if (descriptionColumns.length === 0) {
    return null;
  }

  if (descriptionColumns.length > 1) {
    const descriptions = descriptionColumns.map(
      (col) => row.get(col.id).value as string
    );
    return descriptions.filter(Boolean).join(' ');
  }

  return row.get(descriptionColumns[0].id).value as string;
}

/**
 * Extracts the counterparty from a row (ENT-006).
 * Multiple COUNTERPARTY columns → joined by space (mirrors DESCRIPTION logic).
 * Returns null if no COUNTERPARTY column is mapped.
 */
function extractCounterparty(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): string | null {
  const counterpartyColumns = columns.filter(
    (col) => col.definition === ColumnDefinition.COUNTERPARTY
  );

  if (counterpartyColumns.length === 0) {
    return null;
  }

  if (counterpartyColumns.length > 1) {
    const values = counterpartyColumns.map(
      (col) => row.get(col.id).value as string
    );
    return values.filter(Boolean).join(' ');
  }

  return row.get(counterpartyColumns[0].id).value as string;
}

/**
 * Extracts the bank account from a row.
 * Multiple BANK_ACCOUNT columns → joined by space (verbatim from prior art).
 */
function extractAccount(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): string | null {
  const accountColumns = columns.filter(
    (col) => col.definition === ColumnDefinition.BANK_ACCOUNT
  );

  if (accountColumns.length === 0) {
    return null;
  }

  if (accountColumns.length > 1) {
    const accounts = accountColumns.map(
      (col) => row.get(col.id).value as string
    );
    return accounts.filter(Boolean).join(' ');
  }

  return row.get(accountColumns[0].id).value as string;
}

/**
 * Extracts the bank category from a row.
 * Multiple CATEGORY columns → first wins (verbatim from prior art).
 */
function extractBankCategory(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): string | null {
  const categoryColumns = columns.filter(
    (col) => col.definition === ColumnDefinition.CATEGORY
  );

  if (categoryColumns.length === 0) {
    return null;
  }

  return row.get(categoryColumns[0].id).value as string;
}

/**
 * Extracts the merchant category code from a row.
 * Multiple MERCHANT_CATEGORY columns → first wins (verbatim from prior art).
 */
function extractMerchantCategoryCode(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
): number | null {
  const mccColumns = columns.filter(
    (col) => col.definition === ColumnDefinition.MERCHANT_CATEGORY
  );

  if (mccColumns.length === 0) {
    return null;
  }

  return row.get(mccColumns[0].id).value as number;
}
