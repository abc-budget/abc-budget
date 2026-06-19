/**
 * import-review-echo — surfaces the already-decoded stage2 cell values for a
 * NON-OK review row (error/skipped) WITHOUT re-running any validator/detector
 * (PM Option 2). Raw value where the cell decoded to the expected type, null
 * where it failed / is absent. Never throws (row.get may throw on corrupt rows).
 * @module internal/worker/import-review-echo
 * @internal
 */
import type { ImportStatementRowData } from '../importStatement/stage2/types';
import type { ColumnInfo } from '../importStatement/stage3/row-generator';
import { ColumnDefinition } from '../importStatement/types';

export interface EchoedCells {
  readonly date: string | null;
  readonly amount: number | null;
  readonly currency: string | null;
  readonly description: string | null;
}

/** First cell value for a column definition, or undefined (never throws). */
function firstValue(
  row: ImportStatementRowData,
  columns: ColumnInfo[],
  definition: ColumnDefinition,
): unknown {
  const col = columns.find((c) => c.definition === definition);
  if (!col) return undefined;
  try {
    return row.get(col.id).value;
  } catch {
    return undefined; // corrupt cell — raw/null, no re-validate
  }
}

export function echoDecodedCells(row: ImportStatementRowData, columns: ColumnInfo[]): EchoedCells {
  const dateVal = firstValue(row, columns, ColumnDefinition.DATE);
  const amountVal = firstValue(row, columns, ColumnDefinition.AMOUNT);
  const currencyVal = firstValue(row, columns, ColumnDefinition.CURRENCY);
  const descVal = firstValue(row, columns, ColumnDefinition.DESCRIPTION);
  return {
    date: dateVal instanceof Date ? dateVal.toISOString() : null,
    amount: typeof amountVal === 'number' ? amountVal : null,
    currency: typeof currencyVal === 'string' ? currencyVal : null,
    description: typeof descVal === 'string' ? descVal : null,
  };
}
