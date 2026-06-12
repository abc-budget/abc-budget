/**
 * Import statement types — catalog + params + stage interfaces.
 * (2.6 decision 3: the prior-art file-format shapes are EXCISED — see below.)
 *
 * PORT of `webapp/libs/engine/src/importStatement/types.ts` with:
 *   1. EXTEND: TIME = 'time', COUNTERPARTY = 'counterparty'  (ENT-009 → 16 entries)
 *   2. ADAPT:  AmountColumnParams.currency typed as the 1.6 CurrencyDetectOptions
 *              (imported from ../currency/detect — prior art had its own inline alias).
 *   3. verbatimModuleSyntax: all re-export/import fixes applied.
 *   4. (2.3) COMPLETE: stage orchestration interfaces (ImportStatementStage,
 *      ImportStatementStage4) and re-exports of stage1/stage2/stage3 interfaces added.
 *      rxjs is now a dep of this package (internal only — 1.1 rule: no Observables on
 *      the public surface; the boundary spec must stay green).
 *
 * Diff-audit note:
 *   Prior art declared `CurrencyDetectOptions = 'auto' | 'use_base' | { code: string }`
 *   inline in this file (line ~122). That inline declaration is REPLACED by the import
 *   below — the type shape is identical so no callers are broken.
 *
 * 2.3 types.ts delta vs 2.2 trimmed version:
 *   + `import type { Observable } from 'rxjs'` (rxjs is now a package dep)
 *   + `ImportStatementStage<Column, Data>` interface (uses Observable)
 *   + `ImportStatementStage4` interface
 *   + Re-export `ImportStatementStage1` from './stage1'
 *   + Re-export stage2 interfaces from './stage2/types'
 *   = Everything else was already present in the 2.2 trimmed version
 */

import type { Observable } from 'rxjs';
import type { Message } from '../utils/messages/message';
import type { CurrencyDetectOptions } from '../currency/detect';

// ---------------------------------------------------------------------------
// Stage orchestration re-exports (2.3 completion)
// ---------------------------------------------------------------------------

export type { ImportStatementStage1 } from './stage1';
export type {
  CellData,
  ImportStatementColumnHeaderStage2,
  ImportStatementRowData,
  ImportStatementStage2,
  SupportedDataType,
} from './stage2/types';

// ---------------------------------------------------------------------------
// Stage interfaces (2.3 completion — require rxjs Observable)
// ---------------------------------------------------------------------------

/**
 * Base interface for all import statement stages.
 * Provides access to the current data and columns for a specific stage.
 *
 * @template Column - The type of column data for this stage
 * @template Data - The type of row data for this stage
 */
export interface ImportStatementStage<Column, Data> {
  /** Gets the current data rows for this stage as a subscribable */
  get currentData(): Observable<Data[]>;

  /** Gets the column definitions for this stage as a subscribable */
  get columns(): Observable<Column[]>;

  /**
   * Proceeds to the next stage of the import process
   * @returns Promise resolving to the next stage
   */
  next?: () => Promise<ImportStatementStage<unknown, unknown>>;

  /** Observable indicating whether the process can move to the next stage */
  readonly canMoveForward?: Observable<boolean>;

  /**
   * Saves the imported data
   * @returns Promise that resolves when the save operation is complete
   */
  save?: () => Promise<void>;
}

/**
 * Final stage of the import statement process.
 * Handles saving the imported data.
 */
export interface ImportStatementStage4
  extends ImportStatementStage<string, Record<string, unknown>> {
  /**
   * Saves the imported data
   * @returns Promise that resolves when the save operation is complete
   */
  save(): Promise<void>;
}

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
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
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
// Column header interface (needed by column.ts / row.ts in 2.2)
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

// EXCISED (2.6 decision 3): the prior-art format-entity types
// (`ColumnTransformation`, the file-format/-source shapes, and the
// format-match shape) are DELETED — the format entity is abolished
// (FEAT-005 «no format entity», FEAT-011 revised).  Column-name recall is
// the 2.3 pool's job (./recall/recall.ts: PrefillEntry over
// definition+params, keyed by normalized column name).

// (2.3) stage orchestration interfaces and re-exports are now complete above.
