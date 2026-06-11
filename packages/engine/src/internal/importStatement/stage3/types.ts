/**
 * Stage 3 types — minimal stub for Task 3.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/types.ts` (minimal subset).
 *
 * This file provides the types needed by service.ts and stage2/types.ts so that
 * the stage orchestration compiles.  The full implementation of stage3 is ported
 * in Task 4 (row-generator rebuild).
 *
 * Adaptations (diff-audit):
 *   1. `Category` type removed — it lives in the categories module not yet ported;
 *      replaced with `unknown` (category field is opaque at this boundary).
 *   2. `DecisionTreeDebugger` and `Rule` types replaced with `unknown` stubs — those
 *      modules (decision-tree) are not part of Task 3/4 scope.
 *   3. Import of `ImportStatementColumnHeader` from '../types' kept verbatim.
 *   4. `ImportStatementStage4` referenced from '../types' (already ported).
 *   5. verbatimModuleSyntax — type-only imports use `import type`.
 *
 * Task 4 will replace this stub with the full implementation.
 */

import type { ImportStatementColumnHeader, ImportStatementStage, ImportStatementStage4 } from '../types';

/**
 * Represents a row in Stage 3 of the import statement process.
 * Stub for Task 3 — full shape in Task 4.
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

/**
 * Type representing the field names from ImportStatementStage3Row,
 * excluding 'rowIndex', 'hash', 'category' and 'isManuallySetCategory' fields.
 */
export type ImportStatementStage3RowField = Exclude<
  keyof ImportStatementStage3Row,
  'rowIndex' | 'hash' | 'category' | 'isManuallySetCategory'
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
 * Stub for Task 3 — full implementation in Task 4.
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
   * @returns Promise that resolves with the debugger object (opaque until Task 4)
   */
  runDebugCategorization(): Promise<unknown>;

  /**
   * Applies filtering rules to the data (opaque rule type until Task 4)
   */
  applyFilters(rules: unknown[], hideCategorisedRows?: boolean): Promise<void>;

  /**
   * Clears all applied filters and resets data to original state
   */
  clearFilters(): Promise<void>;

  /** The selected file source name, or null if none selected */
  readonly selectedSource: string | null;
}
