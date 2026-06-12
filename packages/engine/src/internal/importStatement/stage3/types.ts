/**
 * Stage 3 types — Task 4 full implementation.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/types.ts` with:
 *   1. `Category` type replaced with `unknown` — categories module not yet ported.
 *   2. `DecisionTreeDebugger` and `Rule` replaced with `unknown` — out of Task 4 scope.
 *   3. EXTEND: `counterparty: string | null` added to `ImportStatementStage3Row` (ENT-006).
 *   4. NEW (FEAT-022): `RowError`, `SkippedRow`, `TransactionRow`, and
 *      `GenerateRowsResult` — the collect-don't-throw row-generator output shape.
 *   5. verbatimModuleSyntax — type-only imports use `import type`.
 *
 * Diff-audit vs Task 3 stub:
 *   - `counterparty` field added to `ImportStatementStage3Row`
 *   - `ImportStatementStage3RowField` Exclude updated to also exclude 'counterparty'
 *     from the field-name type (counterparty is a distinct output field, not a
 *     stage-column-header field — mirrors how 'source' is not a column-header field).
 *   - New types: `RowError`, `SkippedRow`, `TransactionRow`, `GenerateRowsResult`
 *   - Stage3 interfaces unchanged from stub.
 */

import type { Message } from '../../utils/messages/message';
import type { ImportStatementColumnHeader, ImportStatementStage, ImportStatementStage4 } from '../types';

// ---------------------------------------------------------------------------
// Core row shape (FEAT-022 extended)
// ---------------------------------------------------------------------------

/**
 * Represents a fully-generated transaction row from Stage 3.
 *
 * EXTEND vs prior art (ENT-006): `counterparty` field added — distinct from
 * `description`.  TIME column outputs NO field (ENT-001 privacy).
 *
 * Category fields are present but opaque until the categories module is ported.
 */
export interface ImportStatementStage3Row {
  /** Index of the row in the original data */
  rowIndex: number;
  /** Unique hash for the row */
  hash: string;
  /** Source file information */
  source: string | null;
  /** Transaction date */
  date: Date;
  /** Transaction amount */
  amount: number;
  /** Currency code */
  currency: string;
  /** Transaction description */
  description: string | null;
  /**
   * Counterparty of the transaction — distinct from `description` (ENT-006).
   * Populated when the statement has a COUNTERPARTY-mapped column.
   */
  counterparty: string | null;
  /** Account identifier */
  account: string | null;
  /** Bank's category for the transaction */
  bankCategory: string | null;
  /** Merchant Category Code */
  mcc: number | null;
  /** Indicates if the transaction is a bank commission */
  isBankCommission: boolean;
  /** Indicates if the transaction is a cashback */
  isCashback: boolean;
  /** Budget category of the current operation (opaque until categories module is ported) */
  category: unknown;
  /** Flag is a user manually set the category */
  isManuallySetCategory: boolean;
}

/** Convenience alias — the public name used by the row-generator and tests. */
export type TransactionRow = ImportStatementStage3Row;

// ---------------------------------------------------------------------------
// FEAT-022: collect-don't-throw output types
// ---------------------------------------------------------------------------

/**
 * A per-row error entry.  When row generation fails for a specific row, the
 * error is collected here and generation continues with the next row.
 *
 * FEAT-022 contract: `generateRows()` NEVER throws; it collects.
 *
 * 2.5 amendment (RowError columnId): optional `columnId` carries the cell
 * coordinate for pseudo-op failures so S3b/S3d can point at the exact column.
 * Main-op row errors leave it absent (whole-row errors have no single column).
 * Optional field — zero churn in the 2.3/2.4 suites.
 */
export interface RowError {
  /** Index of the row that failed (matches `ImportStatementRowData.rowIndex`) */
  readonly rowIndex: number;
  /** One or more error messages describing why this row could not be generated */
  readonly errors: readonly Message[];
  /**
   * Column id for pseudo-op failures (BANK_COMMISSION / CASHBACK column that
   * caused the error). Absent for whole-row main-op errors.
   */
  readonly columnId?: string;
}

/**
 * A per-row skip entry.  Income rows (VIS-011) and other label-and-discard
 * cells produce skip entries — DISTINCT from errors (the row is valid data, just
 * not a spend transaction).
 */
export interface SkippedRow {
  /** Index of the skipped row */
  readonly rowIndex: number;
  /** Reason the row was skipped (e.g. "income value ignored") */
  readonly reason: Message;
}

/**
 * Full output of `generateRows()`.
 *
 * FEAT-022 contract:
 *  - `rows`      — successfully generated transaction rows (good rows always generated).
 *  - `rowErrors` — rows that could not be generated; one entry per bad row.
 *  - `skipped`   — rows discarded for non-error reasons (income / mixed-positive, etc.).
 */
export interface GenerateRowsResult {
  readonly rows: TransactionRow[];
  readonly rowErrors: RowError[];
  readonly skipped: SkippedRow[];
}

// ---------------------------------------------------------------------------
// Stage 3 column / stage interfaces (unchanged from Task 3 stub)
// ---------------------------------------------------------------------------

/**
 * Type representing the field names from ImportStatementStage3Row,
 * excluding 'rowIndex', 'hash', 'category', 'isManuallySetCategory', and
 * 'counterparty' (counterparty is a distinct output field, not a column-header field).
 */
export type ImportStatementStage3RowField = Exclude<
  keyof ImportStatementStage3Row,
  'rowIndex' | 'hash' | 'category' | 'isManuallySetCategory' | 'counterparty'
>;

/**
 * Column header interface for Stage 3 of the import process.
 */
export interface ImportStatementColumnHeaderStage3 extends ImportStatementColumnHeader {
  /** The field in ImportStatementStage3Row that this column maps to. */
  readonly field: ImportStatementStage3RowField;
}

/**
 * Third stage of the import statement process.
 */
export interface ImportStatementStage3
  extends ImportStatementStage<
    ImportStatementColumnHeaderStage3,
    ImportStatementStage3Row
  > {
  /**
   * Proceeds to the next stage of the import process
   * @returns Promise resolving to the fourth stage
   */
  next(): Promise<ImportStatementStage4>;

  /**
   * Runs categorization asynchronously
   * @returns Promise that resolves when categorization is complete
   */
  runCategorization(): Promise<void>;

  /**
   * Runs debug categorization asynchronously
   * @returns Promise that resolves with the debugger object (opaque until categorization module)
   */
  runDebugCategorization(): Promise<unknown>;

  /**
   * Applies filtering rules to the data (opaque rule type until categorization module)
   */
  applyFilters(rules: unknown[], hideCategorisedRows?: boolean): Promise<void>;

  /**
   * Clears all applied filters and resets data to original state
   */
  clearFilters(): Promise<void>;

  /**
   * The selected source name — ALWAYS null since the 2.6 excision (decision 3):
   * the FileSource-backed stage2 source picker died with the format entity.
   * S3a (2.7) redefines the lean source notion from the design bundle.
   */
  readonly selectedSource: string | null;
}
