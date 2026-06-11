/**
 * Amount and currency detector for stage 3.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/amount-currency-detector.ts`.
 *
 * Adaptations (diff-audit):
 *   1. `CurrencyCache` / `UserSettingsService` removed — base currency is a plain
 *      string parameter; currency code validation uses `symbolToIso` from the 1.6
 *      reference module (code passthrough rule validates ISO alpha codes).
 *   2. `$t` / `LocalizableException` imported from internal utils/messages.
 *   3. Import paths updated to relative internal paths.
 *   4. verbatimModuleSyntax: `import type` for interface-only imports.
 *   5. The income-type throw is RETAINED (called from single-row helper) — the
 *      row-generator wraps it in collect-don't-throw per FEAT-022.
 *
 * Behavior change (diff-audit — the 1.6 replacement):
 *   Prior art: validated `{ code }` currency params via `CurrencyCache.getByCodeOrNull`.
 *   Replacement: `symbolToIso(code)` — the reference module's "code passthrough" rule
 *   (Rule 1: byCode.has(input)) returns the code if it is a valid ISO alpha code.
 *   Unknown codes still throw LocalizableException, preserving the error contract.
 */

import { $t, LocalizableException } from '../../utils/messages/index';
import { getLogger } from '../../logging';
import { symbolToIso } from '../../currency/reference';
import type { ImportStatementRowData } from '../stage2/types';
import { ColumnDefinition } from '../types';
import type { AmountColumnParams, ColumnParams } from '../types';

const logger = getLogger('engine.importStatement.stage3.amount-currency-detector');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of the amount and currency detection process.
 */
export interface AmountCurrencyResult {
  /** The detected amount value */
  amount: number;
  /** The detected currency code */
  currency: string;
}

// ---------------------------------------------------------------------------
// Internal column info shape (verbatim from prior art)
// ---------------------------------------------------------------------------

interface ColumnInfo {
  id: string;
  definition: ColumnDefinition;
  params: AmountColumnParams | null;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Detects the amount and currency for a row based on its column values.
 *
 * @param row          The stage2 row data.
 * @param columns      The column definitions (only AMOUNT/CURRENCY are used).
 * @param baseCurrency The resolved base currency ISO code (pre-fetched by the caller).
 *
 * ADAPT (diff-audit): prior art accepted `UserSettingsService` + `CurrencyCache`.
 * Replaced with a plain `baseCurrency: string` parameter and `symbolToIso` for
 * code validation — no async needed inside this function.
 */
export function detectAmountAndCurrency(
  row: ImportStatementRowData,
  columns: {
    id: string;
    definition: ColumnDefinition | null;
    params: ColumnParams | null;
  }[],
  baseCurrency: string,
): AmountCurrencyResult {
  // Filter columns to get only those with definitions
  const definedColumns = columns
    .filter((col) => col.definition !== null)
    .map((col) => ({
      id: col.id,
      definition: col.definition as ColumnDefinition,
      params: col.params,
    }));

  // Get amount columns
  const amountColumns = definedColumns.filter(
    (col) => col.definition === ColumnDefinition.AMOUNT
  ) as ColumnInfo[];

  // Get currency columns
  const currencyColumns = definedColumns.filter(
    (col) => col.definition === ColumnDefinition.CURRENCY
  ) as ColumnInfo[];

  // Case 1: Only one AMOUNT column
  if (amountColumns.length === 1) {
    return handleSingleAmountColumn(
      row,
      amountColumns[0],
      currencyColumns,
      baseCurrency,
    );
  }

  // Case 2: Multiple AMOUNT columns
  if (amountColumns.length > 1) {
    return handleMultipleAmountColumns(
      row,
      amountColumns,
      currencyColumns,
      baseCurrency,
    );
  }

  // No amount columns found
  logger.error('No AMOUNT columns found in the data');
  throw new LocalizableException(
    $t('engine.importStatement.stage3.no-amount-column')
  );
}

// ---------------------------------------------------------------------------
// Single-amount column handler (verbatim from prior art, CurrencyCache removed)
// ---------------------------------------------------------------------------

function handleSingleAmountColumn(
  row: ImportStatementRowData,
  amountColumn: ColumnInfo,
  currencyColumns: ColumnInfo[],
  baseCurrency: string,
): AmountCurrencyResult {
  const params = amountColumn.params;

  // No params → amount + base currency
  if (!params) {
    return {
      amount: row.get(amountColumn.id).value as number,
      currency: baseCurrency,
    };
  }

  // Income-only column → throw (caller wraps in collect-don't-throw)
  if (params.type === 'income') {
    logger.error('Income-only column detected');
    throw new LocalizableException(
      $t('engine.importStatement.stage3.income-only-column')
    );
  }

  const amount = row.get(amountColumn.id).value as number;

  if (params.currency === 'use_base') {
    return { amount, currency: baseCurrency };
  }

  if (params.currency === 'auto') {
    if (currencyColumns.length === 0) {
      return { amount, currency: baseCurrency };
    } else if (currencyColumns.length === 1) {
      const currencyValue = row.get(currencyColumns[0].id).value as string;
      return { amount, currency: currencyValue };
    } else {
      logger.error('Multiple CURRENCY columns found with auto currency parameter');
      throw new LocalizableException(
        $t('engine.importStatement.stage3.multiple-currency-columns')
      );
    }
  }

  // { code } override — validate via symbolToIso code passthrough
  if (typeof params.currency === 'object' && params.currency.code) {
    const currencyCode = params.currency.code;
    const resolved = symbolToIso(currencyCode.toUpperCase());
    if (resolved !== undefined) {
      return { amount, currency: currencyCode };
    } else {
      logger.error(`Invalid currency code: ${currencyCode}`);
      throw new LocalizableException(
        $t('engine.importStatement.stage3.invalid-currency-code', {
          code: currencyCode,
        })
      );
    }
  }

  // Fallback to base currency
  return { amount, currency: baseCurrency };
}

// ---------------------------------------------------------------------------
// Multiple-amount column handler (verbatim from prior art, CurrencyCache removed)
// ---------------------------------------------------------------------------

function handleMultipleAmountColumns(
  row: ImportStatementRowData,
  amountColumns: ColumnInfo[],
  currencyColumns: ColumnInfo[],
  baseCurrency: string,
): AmountCurrencyResult {
  // Two columns: one 'income', one 'outcome' → use outcome
  const incomeColumn = amountColumns.find((col) => col.params?.type === 'income');
  const outcomeColumn = amountColumns.find((col) => col.params?.type === 'outcome');

  if (incomeColumn && outcomeColumn) {
    return handleSingleAmountColumn(
      row,
      outcomeColumn,
      currencyColumns,
      baseCurrency,
    );
  }

  // If one has currency === 'auto' and there's a CURRENCY column
  if (currencyColumns.length === 1) {
    const autoColumn = amountColumns.find((col) => col.params?.currency === 'auto');
    if (autoColumn) {
      const currencyValue = row.get(currencyColumns[0].id).value as string;
      return {
        amount: row.get(autoColumn.id).value as number,
        currency: currencyValue,
      };
    }
  }

  // If one has currency === 'use_base'
  const useBaseColumn = amountColumns.find((col) => col.params?.currency === 'use_base');
  if (useBaseColumn) {
    return {
      amount: row.get(useBaseColumn.id).value as number,
      currency: baseCurrency,
    };
  }

  // If one has currency?.code === base currency
  const baseCurrencyColumn = amountColumns.find(
    (col) =>
      typeof col.params?.currency === 'object' &&
      col.params?.currency.code === baseCurrency
  );
  if (baseCurrencyColumn) {
    return {
      amount: row.get(baseCurrencyColumn.id).value as number,
      currency: baseCurrency,
    };
  }

  // If one has currency?.code === 'USD'
  const usdColumn = amountColumns.find(
    (col) =>
      typeof col.params?.currency === 'object' &&
      col.params?.currency.code === 'USD'
  );
  if (usdColumn) {
    return {
      amount: row.get(usdColumn.id).value as number,
      currency: 'USD',
    };
  }

  // Otherwise: use any column with a valid currency code
  for (const column of amountColumns) {
    if (
      column.params &&
      typeof column.params.currency === 'object' &&
      column.params.currency.code
    ) {
      const currencyCode = column.params.currency.code;
      const resolved = symbolToIso(currencyCode.toUpperCase());
      if (resolved !== undefined) {
        return {
          amount: row.get(column.id).value as number,
          currency: currencyCode,
        };
      }
    }
  }

  // Could not determine — throw
  logger.error('Could not determine amount and currency from multiple columns');
  throw new LocalizableException(
    $t('engine.importStatement.stage3.contact-developers')
  );
}
