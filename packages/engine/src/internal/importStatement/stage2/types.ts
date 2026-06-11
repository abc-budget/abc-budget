/**
 * Stage 2 cell/row data types.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage2/types.ts`.
 *
 * Trimming: the prior-art stage2/types.ts also contained ImportStatementStage2,
 * ImportStatementColumnHeaderStage2, ImportStatementRowData (Observable-dependent,
 * rxjs-coupled stage interfaces). Those are NOT ported here — column.ts and row.ts
 * only consume CellData and SupportedDataType from this file in 2.2.
 *
 * // 2.3 ports the rest (ImportStatementStage2, ImportStatementColumnHeaderStage2,
 * //                      ImportStatementRowData — requires rxjs).
 *
 * SupportedDataType extension decision (diff-audit note):
 *   COUNTERPARTY outputs a string value.  In the prior art, DESCRIPTION maps to
 *   SupportedDataType.TEXT (column.ts `transformToDescription` returns TEXT cells).
 *   COUNTERPARTY mirrors that mapping exactly — it also writes string text to the
 *   `counterparty` output field (ENT-006), so no new enum member is needed; TEXT
 *   covers both.  TIME produces NO output cells — the transform discards them, so
 *   no new member is needed for TIME either.
 *   Decision: SupportedDataType is ported VERBATIM (no extension required).
 */

import type { Message } from '../../utils/messages/message';

/**
 * Supported data types for cell values.
 * Ported verbatim from prior art — no extension needed for TIME/COUNTERPARTY
 * (TEXT covers COUNTERPARTY; TIME outputs nothing).
 */
export enum SupportedDataType {
  TEXT = 'TEXT',
  DATE = 'DATE',
  NUMBER = 'NUMBER',
  CURRENCY = 'CURRENCY',
  MCC = 'MCC',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Represents data for a single cell in the import process.
 * Ported verbatim from prior art.
 */
export interface CellData {
  /** The value of the cell */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly value: any; // Using 'any' is necessary here as the value can be of various types based on SupportedDataType
  /** Error message if the cell has an error */
  readonly error?: Message | null;
  /** Ignore message if the cell is ignored */
  readonly ignore?: Message | null;
  /** The data type of the cell */
  readonly type: SupportedDataType;
}

// ── Minimal stage interfaces needed by column.ts / row.ts (2.2) ─────────────
//
// The full prior-art ImportStatementStage2 / ImportStatementColumnHeaderStage2 /
// ImportStatementRowData interfaces have Observable<> return types (rxjs) which
// is not a dep of this package in 2.2.  Only the subset used by column.ts and
// row.ts is included here.  2.3 will merge the full set when rxjs is added.

import type {
  AmountColumnParams,
  BalanceColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  ColumnDefinition,
  ColumnParams,
  DateColumnParams,
  TransactionStatusColumnParams,
} from '../types';

/**
 * Minimal stage-2 interface used by ImportStatementColumn and ImportStatementRow.
 * The full Observable-bearing surface is carried forward to 2.3.
 *
 * // 2.3 ports the rest (full ImportStatementStage2 with Observable<> members,
 * //                      stage1/stage3 cross-refs, rxjs imports).
 */
export interface ImportStatementStage2 {
  /**
   * Applies (upserts) a column into the stage's column list.
   * @param column The column to apply.
   */
  applyColumn(column: ImportStatementColumnHeaderStage2): void;

  /**
   * Resets a column to its initial state.
   * @param columnId The id of the column to reset.
   * @returns Promise that resolves when complete.
   */
  resetColumn(columnId: string): Promise<unknown>;
}

/**
 * Minimal column-header interface for stage 2.
 * Full surface (all parseAs* methods) is included here because column.ts
 * implements them; the Observable-dependent members live in 2.3.
 */
export interface ImportStatementColumnHeaderStage2 {
  readonly id: string;
  readonly name: Message;
  readonly isIgnored: boolean;
  readonly definition: ColumnDefinition | null;
  readonly params: ColumnParams | null;
  readonly originalName: Message;

  ignore(): Promise<void>;
  parseAsDate(params: DateColumnParams): Promise<void>;
  parseAsAmount(params: AmountColumnParams): Promise<void>;
  parseAsCurrency(): Promise<void>;
  parseAsDescription(): Promise<void>;
  parseAsBankCategory(): Promise<void>;
  parseAsBalance(params: BalanceColumnParams): Promise<void>;
  parseAsBankAccount(): Promise<void>;
  parseAsTransactionStatus(params: TransactionStatusColumnParams): Promise<void>;
  parseAsExchangeRate(): Promise<void>;
  parseAsBankCommission(params: BankCommissionColumnParams): Promise<void>;
  parseAsCashback(params: CashbackColumnParams): Promise<void>;
  parseAsMerchant(): Promise<void>;
  parseAsTime(): Promise<void>;
  parseAsCounterparty(): Promise<void>;
  undo(): Promise<void>;
}

/**
 * Minimal row-data interface for stage 2.
 * // 2.3 ports the full surface (extends ImportStatementStage<…>, Observable members).
 */
export interface ImportStatementRowData {
  readonly rowIndex: number;
  get(column: string): CellData;
  readonly isIgnored: boolean;
  readonly hasErrors: boolean;
  errorMessageAt(column: string): Message | null;
  ignoreMessageAt(column: string): Message | null;
}
