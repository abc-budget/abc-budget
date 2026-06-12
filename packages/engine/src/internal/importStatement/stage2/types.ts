/**
 * Stage 2 cell/row data types + stage interfaces.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage2/types.ts`.
 *
 * (2.3) COMPLETE: the full ImportStatementStage2, ImportStatementColumnHeaderStage2,
 * and ImportStatementRowData interfaces are now included (rxjs is now a dep).
 *
 * SupportedDataType extension decision (diff-audit note):
 *   COUNTERPARTY outputs a string value.  In the prior art, DESCRIPTION maps to
 *   SupportedDataType.TEXT (column.ts `transformToDescription` returns TEXT cells).
 *   COUNTERPARTY mirrors that mapping exactly — it also writes string text to the
 *   `counterparty` output field (ENT-006), so no new enum member is needed; TEXT
 *   covers both.  TIME produces NO output cells — the transform discards them, so
 *   no new member is needed for TIME either.
 *   Decision: SupportedDataType is ported VERBATIM (no extension required).
 *
 * 2.3 delta vs 2.2 trimmed version:
 *   + `import type { Observable } from 'rxjs'`
 *   + Full `ImportStatementStage2` interface (extends ImportStatementStage<...>)
 *   + Full `ImportStatementColumnHeaderStage2` interface (extends ImportStatementColumnHeader)
 *   = SupportedDataType, CellData, ImportStatementRowData were already present
 *   = The minimal stage interfaces that column.ts / row.ts used are now replaced by
 *     the full interfaces (no callers break — the minimal subset is a strict subset
 *     of the full interface).
 */

import type { Observable } from 'rxjs';
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

// ── Stage interfaces ──────────────────────────────────────────────────────────

import type {
  AmountColumnParams,
  BalanceColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  ColumnDefinition,
  ColumnParams,
  DateColumnParams,
  ImportStatementColumnHeader,
  ImportStatementStage,
  TransactionStatusColumnParams,
} from '../types';
import type { ImportStatementStage1 } from '../stage1';
import type { ImportStatementStage3 } from '../stage3/types';

/**
 * Second stage of the import statement process.
 * Handles column mapping and data validation.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage2/types.ts` ImportStatementStage2.
 * 2.3 additions vs the 2.2 minimal: extends ImportStatementStage<...>, stage1 getter,
 * next(), canMoveForward, getOriginalColumn, getOriginalColumnData.
 * N-of-M recall: recognized, recallPrefilled added in 2.3.
 *
 * EXCISED (2.6 decision 3): currentFileFormat, selectSource, selectedSource,
 * availableSources, sourcesWithFullMatch removed from this interface — all were
 * FileFormat/FileSource-coupled (format entity abolished, FEAT-005).  S3a (2.7)
 * redefines the lean source notion from the design bundle.
 */
export interface ImportStatementStage2
  extends ImportStatementStage<
    ImportStatementColumnHeaderStage2,
    ImportStatementRowData
  > {
  /** Access to the previous stage data */
  get stage1(): ImportStatementStage1;

  /**
   * Proceeds to the next stage of the import process
   * @returns Promise resolving to the third stage
   */
  next(): Promise<ImportStatementStage3>;

  /** Observable indicating whether the process can move to the next stage */
  get canMoveForward(): Observable<boolean>;

  /**
   * Applies a column to the current set of columns
   * 1. Takes current value from _columns
   * 2. Replaces column with the same id if present
   * 3. Otherwise - adds as a new column to the end of a list
   * 4. Pushes _columns.next
   *
   * @param column The column to apply
   */
  applyColumn(column: ImportStatementColumnHeaderStage2): void;

  /**
   * Resets a column to its initial state or removes it if it wasn't in the initial state
   * @param columnId The id of the column to reset
   * @returns Promise that resolves when the operation is complete
   */
  resetColumn(columnId: string): Promise<unknown>;

  /**
   * Gets the original column with the specified ID from the initial state
   * @param columnId The ID of the column to retrieve
   * @returns The original column from the initial state
   */
  getOriginalColumn(columnId: string): ImportStatementColumnHeaderStage2;

  /**
   * Gets the original column data with the specified ID from the initial state
   * @param columnId The ID of the column to retrieve data from
   * @returns Array of values extracted from CellData
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getOriginalColumnData(columnId: string): any[];

  /**
   * N-of-M recall count: how many column names were recognized from the pool
   * (or auto-detected) at stage2 creation. n=0 when recall was not run.
   */
  readonly recognized: { readonly n: number; readonly m: number };
}

/**
 * Extended column header interface used in stage 2 of the import process.
 * Provides methods for column mapping and configuration.
 *
 * PORT of prior-art ImportStatementColumnHeaderStage2 verbatim + 2.3 extension:
 *   recallState: 'guessed' | 'confirmed' | null  (null = not from recall)
 */
export interface ImportStatementColumnHeaderStage2 extends ImportStatementColumnHeader {
  /** Whether this column is ignored in the import process */
  readonly isIgnored: boolean;
  /** The type of data this column represents */
  readonly definition: ColumnDefinition | null;
  /** Additional parameters for processing this column */
  readonly params: ColumnParams | null;
  /** The original name of the column from the import file (stage 1) */
  readonly originalName: Message;

  /**
   * Recall state of this column's definition.
   * 'guessed'   — prefilled from pool or auto-detect; awaiting user confirmation.
   * 'confirmed' — user explicitly confirmed the mapping.
   * null        — not from recall; manually mapped or not yet mapped.
   */
  readonly recallState: 'guessed' | 'confirmed' | null;

  /**
   * Marks this column as ignored in the import process
   * @returns Promise that resolves when the operation is complete
   */
  ignore(): Promise<void>;

  /**
   * Configures this column to be parsed as a date
   * @param params Configuration for date parsing
   * @returns Promise that resolves when the operation is complete
   */
  parseAsDate(params: DateColumnParams): Promise<void>;

  /**
   * Configures this column to be parsed as an amount
   * @param params Configuration for amount parsing
   * @returns Promise that resolves when the operation is complete
   */
  parseAsAmount(params: AmountColumnParams): Promise<void>;

  /**
   * Configures this column to be parsed as a currency
   * @returns Promise that resolves when the operation is complete
   */
  parseAsCurrency(): Promise<void>;

  /**
   * Configures this column to be parsed as a description
   * @returns Promise that resolves when the operation is complete
   */
  parseAsDescription(): Promise<void>;

  /**
   * Configures this column to be parsed as a bank category
   * @returns Promise that resolves when the operation is complete
   */
  parseAsBankCategory(): Promise<void>;

  /**
   * Configures this column to be parsed as a balance
   * @param params Configuration for balance parsing
   * @returns Promise that resolves when the operation is complete
   */
  parseAsBalance(params: BalanceColumnParams): Promise<void>;

  /**
   * Configures this column to be parsed as a bank account
   * @returns Promise that resolves when the operation is complete
   */
  parseAsBankAccount(): Promise<void>;

  /**
   * Configures this column to be parsed as a transaction status
   * @param params Configuration for transaction status parsing
   * @returns Promise that resolves when the operation is complete
   */
  parseAsTransactionStatus(
    params: TransactionStatusColumnParams
  ): Promise<void>;

  /**
   * Configures this column to be parsed as an exchange rate
   * @returns Promise that resolves when the operation is complete
   */
  parseAsExchangeRate(): Promise<void>;

  /**
   * Configures this column to be parsed as a bank commission
   * @param params Configuration for bank commission parsing
   * @returns Promise that resolves when the operation is complete
   */
  parseAsBankCommission(params: BankCommissionColumnParams): Promise<void>;

  /**
   * Configures this column to be parsed as cashback
   * @param params Configuration for cashback parsing
   * @returns Promise that resolves when the operation is complete
   */
  parseAsCashback(params: CashbackColumnParams): Promise<void>;

  /**
   * Configures this column to be parsed as a merchant category code (MCC)
   * @returns Promise that resolves when the operation is complete
   */
  parseAsMerchant(): Promise<void>;

  /**
   * Undoes the last operation on this column
   * @returns Promise that resolves when the operation is complete
   */
  undo(): Promise<void>;
}

/**
 * Interface for accessing and manipulating row data during import.
 * Ported verbatim from prior art.
 */
export interface ImportStatementRowData {
  /** Index of this row in the dataset */
  readonly rowIndex: number;

  /**
   * Gets cell data from a specific column
   * @param column - The column identifier
   * @returns The cell data from the specified column
   */
  get(column: string): CellData;

  /** Whether this row is marked as ignored */
  readonly isIgnored: boolean;

  /** Whether this row has validation errors */
  readonly hasErrors: boolean;

  /**
   * Gets the error message for a specific column, if any
   * @param column - The column identifier
   * @returns The error message or null if no error
   */
  errorMessageAt(column: string): Message | null;

  /**
   * Gets the ignore message for a specific column, if any
   * @param column - The column identifier
   * @returns The ignore message or null if not ignored
   */
  ignoreMessageAt(column: string): Message | null;
}
