/**
 * Typed exception classes for stage2 column transforms.
 * @module internal/importStatement/stage2/errors
 *
 * Story 2.4, Task 2 — ENT-015 evidence payload.
 * Story 2.4, Task 3 — Q-009 explicit stop.
 *
 * `ColumnTransformRejection` is a subclass of `LocalizableException` that carries
 * structured evidence for the >30%-bad-column rejection gate:
 *
 *   ЩО   — class identity + counts (errorCount / totalCount / threshold)
 *   ЧОМУ  — the complete per-cell error list (cellErrors[], ALL collected — FEAT-022)
 *   ДІЯ   — localizable action hint (engine.importStatement.transform-rejected-action)
 *
 * `UnmappedColumnsError` is a subclass of `LocalizableException` that carries
 * the list of column ids+names that are still unmapped when `next()` is called:
 *
 *   ЩО   — class identity + unmapped column list (ids + names)
 *   ЧОМУ  — enumerated column names in the localizable message
 *   ДІЄ   — Q-009: the stop is explicit and structured so that 2.8's Option-A gate
 *            can render the list without provoking the throw
 *
 * Catalog keys:
 *   `engine.importStatement.unmapped-columns-stop` (new, uk/en)
 *     uk: "Неможливо продовжити: незіставлені стовпці — {names}"
 *     en: "Cannot proceed: unmapped columns — {names}"
 *
 * Subclassing `LocalizableException` means all existing `toThrow(LocalizableException)`
 * assertions in the 1,347-line ported suites stay green without weakening.
 */

import { LocalizableException } from '../../utils/messages/exceptions';
import { $t } from '../../utils/messages/index';
import type { Message } from '../../utils/messages/message';

/**
 * Thrown when a column transform is rejected because the fraction of per-cell
 * errors exceeds the configured `acceptableColumnErrorPercentage` threshold.
 *
 * Carries the complete evidence payload (ЩО/ЧОМУ/ДІЯ) so that callers can
 * surface actionable detail without re-running the transform.
 *
 * The exception message is constructed from two catalog keys:
 *   - `engine.importStatement.too-many-parsing-errors` (existing, ЩО/ЧОМУ)
 *   - `engine.importStatement.transform-rejected-action` (new, ДІЯ)
 */
export class ColumnTransformRejection extends LocalizableException {
  /** Number of cells that produced an error during parsing. */
  readonly errorCount: number;

  /** Total number of cells in the column (= denominator for error %). */
  readonly totalCount: number;

  /** The threshold that was active when the gate fired (fraction, 0–1). */
  readonly threshold: number;

  /**
   * ALL per-cell errors collected during the failed transform (FEAT-022:
   * complete-not-first).  `rowIndex` is the cell's position in the column data
   * array; `error` is the per-cell `Message` already stored in `newData[i].error`.
   */
  readonly cellErrors: ReadonlyArray<{ rowIndex: number; error: Message }>;

  constructor(
    errorCount: number,
    totalCount: number,
    threshold: number,
    cellErrors: ReadonlyArray<{ rowIndex: number; error: Message }>,
    errorMessageKey: string,
  ) {
    const errorPercentage = totalCount > 0 ? errorCount / totalCount : 0;
    const acceptablePercentage = threshold;

    super(
      $t(errorMessageKey, {
        message: $t('engine.importStatement.too-many-parsing-errors', {
          errorPercentage: (errorPercentage * 100).toFixed(1),
          acceptablePercentage: (acceptablePercentage * 100).toFixed(1),
        }),
        action: $t('engine.importStatement.transform-rejected-action'),
      }),
    );

    // Restore prototype chain so `instanceof ColumnTransformRejection` works across
    // compilation boundaries.
    Object.setPrototypeOf(this, ColumnTransformRejection.prototype);
    this.name = 'ColumnTransformRejection';

    this.errorCount = errorCount;
    this.totalCount = totalCount;
    this.threshold = threshold;
    this.cellErrors = cellErrors;
  }
}

/**
 * Thrown by `ImportStatementStage2Impl.next()` when one or more columns are still
 * unmapped (definition === null) and the user attempts to advance to stage 3.
 *
 * Carries the complete list of unmapped columns so that 2.8's Option-A gate can
 * render the names without provoking the throw via `getUnmappedColumns()`.
 *
 * Catalog key: `engine.importStatement.unmapped-columns-stop`
 *   uk: "Неможливо продовжити: незіставлені стовпці — {names}"
 *   en: "Cannot proceed: unmapped columns — {names}"
 *
 * The `names` interpolation param is the comma-joined list of column names from
 * `unmappedColumns[].name`.
 *
 * Subclassing `LocalizableException` means all existing `toThrow(LocalizableException)`
 * assertions in the 1,347-line ported suites stay green without weakening.
 */
export class UnmappedColumnsError extends LocalizableException {
  /**
   * The list of columns that are still unmapped at the time `next()` was called.
   * Each entry carries `id` (stable column identifier) and `name` (display name
   * from `originalName.getText()` — the header text as it appears in the file).
   */
  readonly unmappedColumns: ReadonlyArray<{ id: string; name: string }>;

  constructor(unmappedColumns: ReadonlyArray<{ id: string; name: string }>) {
    const names = unmappedColumns.map((c) => c.name).join(', ');
    super($t('engine.importStatement.unmapped-columns-stop', { names }));

    // Restore prototype chain so `instanceof UnmappedColumnsError` works across
    // compilation boundaries.
    Object.setPrototypeOf(this, UnmappedColumnsError.prototype);
    this.name = 'UnmappedColumnsError';

    this.unmappedColumns = unmappedColumns;
  }
}
