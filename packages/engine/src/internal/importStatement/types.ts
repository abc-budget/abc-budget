/**
 * Import statement types — catalog + params + file-format shapes.
 *
 * PORT of `webapp/libs/engine/src/importStatement/types.ts` with:
 *   1. EXTEND: TIME = 'time', COUNTERPARTY = 'counterparty'  (ENT-009 → 16 entries)
 *   2. ADAPT:  AmountColumnParams.currency typed as the 1.6 CurrencyDetectOptions
 *              (imported from ../currency/detect — prior art had its own inline alias).
 *   3. verbatimModuleSyntax: all re-export/import fixes applied.
 *
 * Trimming decision:
 *   The prior-art file's top-level re-exports reference Observable (from rxjs) and
 *   stage1/stage3 interfaces that depend on modules not ported in 2.2.
 *   Those stage-orchestration interfaces (ImportStatementStage, ImportStatementStage4,
 *   ImportStatementColumnHeader) are retained verbatim — they compile standalone with
 *   the Message type from our ported utils. The Observable import and the stage1/stage3
 *   re-exports ARE removed because rxjs is not a dep of this package and those stages
 *   are not needed by column.ts or row.ts.
 *
 * // 2.3 ports the rest (stage orchestration: ImportStatementStage, ImportStatementStage4,
 * //                      stage1/stage3 re-exports, Observable-dependent interfaces).
 *
 * Diff-audit note:
 *   Prior art declared `CurrencyDetectOptions = 'auto' | 'use_base' | { code: string }`
 *   inline in this file (line ~122). That inline declaration is REPLACED by the import
 *   below — the type shape is identical so no callers are broken.
 */

import type { Message } from '../utils/messages/message';
import type { CurrencyDetectOptions } from '../currency/detect';

// ---------------------------------------------------------------------------
// Column Definition and Parameters
// ---------------------------------------------------------------------------

/**
 * Enumeration of possible column types for import statements.
 * Ported from prior art (14 values) + extended with TIME and COUNTERPARTY
 * to reach the 16-entry ENT-009 canon.
 */
export enum ColumnDefinition {
  UNKNOWN = 'unknown',
  DATE = 'date',
  AMOUNT = 'amount',
  DESCRIPTION = 'description',
  CURRENCY = 'currency',
  BALANCE = 'balance',
  BANK_ACCOUNT = 'bank_account',
  CATEGORY = 'category',
  STATUS = 'status',
  MERCHANT_CATEGORY = 'merchant_category',
  EXCHANGE_RATE = 'exchange_rate',
  BANK_COMMISSION = 'bank_commission',
  CASHBACK = 'cashback',
  // --- ENT-009 additions (2.2) ---
  /** TIME — recognized-and-IGNORED.  Transform outputs NOTHING (ENT-001, privacy). */
  TIME = 'time',
  /** COUNTERPARTY — distinct from DESCRIPTION; writes the `counterparty` output field (ENT-006). */
  COUNTERPARTY = 'counterparty',
  IGNORE = 'ignore',
}

/**
 * Base interface for column parameters.
 * Extended by specific parameter types for different column definitions.
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface, @typescript-eslint/no-empty-object-type
export interface ColumnParams {}

/**
 * Parameters for date columns.
 */
export interface DateColumnParams extends ColumnParams {
  /** Format specification for date parsing */
  readonly format: 'auto' | { custom: string };
}

/**
 * Parameters for amount columns.
 *
 * ADAPT (diff-audit): prior art declared `currency: CurrencyDetectOptions` with the
 * type defined inline in this file.  We import the canonical 1.6 type instead — same
 * shape, no callers broken.
 */
export interface AmountColumnParams extends ColumnParams {
  /**
   * Currency detection configuration — the 1.6 ENT-011 hook.
   *
   * 'auto'      → inspect the currency column value for this row.
   * 'use_base'  → always use the budget's base currency.
   * { code }    → unconditional override.
   */
  readonly currency: CurrencyDetectOptions;
  /**
   * Type of amount column:
   * - 'auto':    Deterministic detection (outcome vs mixed) — HC-9.
   * - 'income':  Rows SKIPPED with reason (VIS-011, label-and-discard).
   * - 'outcome': All positive debits.
   * - 'mixed':   Sign decides; positive/income side DISCARDED with reason; negative kept.
   */
  readonly type?: 'auto' | 'mixed' | 'income' | 'outcome';
}

/**
 * Parameters for balance columns.
 */
export interface BalanceColumnParams extends ColumnParams {
  /** Currency detection configuration */
  readonly currency: CurrencyDetectOptions;
}

/**
 * Parameters for transaction status columns.
 */
export interface TransactionStatusColumnParams extends ColumnParams {
  /** Value that indicates a successful transaction */
  readonly successValue: 'auto' | { useValue: string };
}

/**
 * Parameters for bank commission columns.
 */
export interface BankCommissionColumnParams extends ColumnParams {
  /** Currency detection configuration */
  readonly currency: CurrencyDetectOptions;
}

/**
 * Parameters for cashback columns.
 */
export interface CashbackColumnParams extends ColumnParams {
  /** Currency detection configuration */
  readonly currency: CurrencyDetectOptions;
}

// ---------------------------------------------------------------------------
// Column Transformation and File Format Interfaces
// (needed by column.ts / row.ts in 2.2)
// ---------------------------------------------------------------------------

/**
 * Base interface for column headers in import statements.
 */
export interface ImportStatementColumnHeader {
  /** Unique identifier for the column */
  readonly id: string;
  /** Localized display name for the column */
  readonly name: Message;
}

/**
 * Represents a column transformation rule for import statements.
 * Defines how a specific column should be parsed.
 */
export interface ColumnTransformation<T extends ColumnParams = ColumnParams> {
  /** The index or name of the column in the source file */
  readonly columnName: string;
  /** The type of column this represents */
  readonly definition: ColumnDefinition;
  /** Additional parameters for processing this column */
  readonly params: T | null;
}

/**
 * Represents a file format configuration for import statements.
 * Defines how a specific file format should be parsed.
 */
export interface FileFormat {
  /** Unique identifier for the file format */
  readonly id?: number;
  /** The set of column transformations to apply */
  readonly transformations: ColumnTransformation[];
  /** Timestamp when this format was last used (milliseconds since epoch, GMT-0) */
  readonly lastUsed?: number;
}

/**
 * Represents a file source configuration for import statements.
 * Associates a file source with a file format.
 */
export interface FileSource {
  /** Unique identifier for the file source */
  readonly id?: number;
  /** User-defined name for the file source */
  readonly name: string;
  /** Optional description of the file source */
  readonly description?: string;
  /** Identifier of the associated file format */
  readonly fileFormatId: number;
}

/**
 * Represents a file format match result with its associated sources and match percentage.
 */
export interface FileFormatMatch {
  /** The file format being matched */
  readonly fileFormat: FileFormat;
  /** The associated file sources for this format */
  readonly fileSources: FileSource[];
  /** The match percentage (0.0 to 1.0) indicating how well the format matches */
  readonly matchPercentage: number;
}

// 2.3 ports the rest (stage orchestration: ImportStatementStage, ImportStatementStage4,
//                      stage1/stage3 re-exports, Observable-dependent interfaces —
//                      these require rxjs which is not a dep of this package in 2.2).
