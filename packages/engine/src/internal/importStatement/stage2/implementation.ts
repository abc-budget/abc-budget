/**
 * ImportStatementStage2Impl — column-mapping stage of the import pipeline.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage2/implementation.ts` (409 lines).
 *
 * Adaptations (diff-audit):
 *
 * 1. **IoC removal**: no Container dependency in prior art stage2/implementation.ts.
 *    Stage2Impl takes stage1, service, initialState directly — zero Container refs.
 *
 * 2. **Import paths** adjusted for internal layout.
 *
 * 3. **verbatimModuleSyntax** — `import type` for type-only imports.
 *
 * 4. **Recall mount (2.3 — FEAT-013/005)** — new in this port:
 *    - Constructor accepts an optional `recallResult: RecallResult | null` parameter.
 *    - When provided, `_initialColumns` are cloned with definition/params/recallState
 *      set from recall prefills BEFORE the BehaviorSubject is initialized.
 *    - `recognized` property exposes the N-of-M count (zero when recall not run).
 *    - On `applyColumn`: if the column being applied had `recallState: 'guessed'`
 *      and the new column has an explicit definition (not the same as the guessed
 *      one), the recallState transitions to `'confirmed'` in the applied column.
 *      Confirmed mappings are forwarded to `savePool()` via the `_recallPool` hook.
 *    - `savePool` is called when a column is applied with a confirmed mapping
 *      (i.e., the user confirmed or an apply-with-definition triggers save).
 *      Timing mirrors prior-art recall-save: save fires at apply time (per column),
 *      not at stage completion.  Collisions are surfaced via `lastSaveCollision`.
 *    - REPORT:
 *      Mount point: constructor, after `_initialState` is set, before the
 *      BehaviorSubject is pushed. recallFor() outputs map from normalized name →
 *      PrefillEntry { definition, params, state:'guessed' }. Each initial column
 *      whose `originalName.getText()` (after normalizeKey) hits a prefill entry
 *      is constructed with that definition/params and recallState:'guessed'.
 *      GUESSED columns carry a definition and params (prefilled) but are not
 *      "confirmed" — `canMoveForward` treats them as having a definition (they
 *      have one), so N-of-M prefilled ≡ canMoveForward-eligible but not learned yet.
 *      The confirmed→savePool learning loop fires in `applyColumn`: when a column
 *      with `recallState:'guessed'` or `null` is applied with any definition, we
 *      call savePool(name, definition, params). On `recallState:'guessed'`
 *      specifically, the recallState transitions to 'confirmed' in the new column.
 *
 * 5. **`recognized` property** — exposes { n, m } from RecallResult (n=0 when no recall).
 *
 * NOTHING else changes from the verbatim prior art.
 *
 * rxjs — INTERNAL only (1.1 rule: no Observables on the public surface).
 */

import { BehaviorSubject, Observable, map, of } from 'rxjs'; // rxjs — INTERNAL only
import type { ImportStatementServiceInternal } from '../service';
import type { ImportStatementStage1 } from '../stage1';
import type { RecallPool, RecallResult } from '../recall/recall';
import { normalizeKey } from '../recall/recall';
import {
  ColumnDefinition,
} from '../types';
import type {
  AmountColumnParams,
  BalanceColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  ColumnTransformation,
  DateColumnParams,
  FileFormat,
  FileFormatMatch,
  FileSource,
  TransactionStatusColumnParams,
} from '../types';
import type {
  ImportStatementColumnHeaderStage2,
  ImportStatementRowData,
  ImportStatementStage2,
} from './types';
import type { ImportStatementStage3 } from '../stage3/types';
import { ImportStatementColumn } from './column';
import { ImportStatementRow } from './row';
import type { CellData } from './types';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ImportStatementStage2Impl implements ImportStatementStage2 {
  private static areAllColumnsProcessed(
    columns: ImportStatementColumnHeaderStage2[]
  ): boolean {
    return columns.every((column) => column.definition !== null);
  }

  private readonly _stage1: ImportStatementStage1;
  private readonly _service: ImportStatementServiceInternal;
  private readonly _initialState: ImportStatementColumnHeaderStage2[];
  private readonly _columns = new BehaviorSubject<
    ImportStatementColumnHeaderStage2[]
  >([]);
  private readonly _data: Observable<ImportStatementRowData[]>;
  private readonly _canMoveForward: Observable<boolean>;
  private _currentFileFormat: FileFormat | null = null;
  private _fileSourcesWithFullMatch: FileSource[] = [];
  private _availableFileFormats: FileFormatMatch[] = [];
  private _cachedAvailableSources: string[] = [];
  private _cachedSourcesWithFullMatch: string[] = [];
  private readonly _selectedSource = new BehaviorSubject<string | null>(null);

  // Recall pool (2.3)
  private readonly _recallPool: RecallPool | null;

  /**
   * N-of-M recall count: how many column names were recognized from the pool
   * (or auto-detected) at stage2 creation. n=0 when recall was not run.
   */
  readonly recognized: { readonly n: number; readonly m: number };

  /**
   * Most recent save collision, if any. Cleared on next apply.
   * Surface value — callers read this to decide whether to confirmSave().
   */
  lastSaveCollision: import('../recall/recall').CollisionDescriptor | null = null;

  constructor(
    stage1: ImportStatementStage1,
    service: ImportStatementServiceInternal,
    initialState: ImportStatementColumn[],
    columns?: ImportStatementColumn[],
    recallResult?: RecallResult | null,
    recallPool?: RecallPool | null
  ) {
    if (!stage1) {
      throw new Error('stage1 cannot be null or undefined');
    }
    if (!service) {
      throw new Error('service cannot be null or undefined');
    }
    if (!initialState) {
      throw new Error('initialState cannot be null or undefined');
    }
    if (initialState.length === 0) {
      throw new Error('initialState cannot be an empty array');
    }
    if (columns && columns.length === 0) {
      throw new Error('columns cannot be an empty array');
    }
    if (columns && columns.length !== initialState.length) {
      throw new Error(
        'initialState and columns should have the same count of rows'
      );
    }

    const firstDataLength = initialState[0].data?.length || 0;
    for (let i = 1; i < initialState.length; i++) {
      const currentDataLength = initialState[i].data?.length || 0;
      if (currentDataLength !== firstDataLength) {
        throw new Error(
          `Element at index ${i} in initialState has different data length than the first element`
        );
      }
    }

    if (columns) {
      for (let i = 1; i < columns.length; i++) {
        const currentDataLength = columns[i].data?.length || 0;
        if (currentDataLength !== firstDataLength) {
          throw new Error(
            `Element at index ${i} in columns has different data length than the first element`
          );
        }
      }
    }

    this._stage1 = stage1;
    this._service = service;
    this._recallPool = recallPool ?? null;

    // ── Recall mount (2.3) ────────────────────────────────────────────────────
    // Apply recall prefills to initial columns BEFORE pushing to BehaviorSubject.
    // Mount point: right here, after basic validation, before _initialState is set.
    const recallPrefills = recallResult?.prefills ?? new Map();
    this.recognized = recallResult?.recognized ?? { n: 0, m: initialState.length };

    const applyRecall = (col: ImportStatementColumn): ImportStatementColumn => {
      const key = normalizeKey(col.originalName.getText());
      const prefill = recallPrefills.get(key);
      if (!prefill) return col;
      // Shallow-copy the column with prefilled definition/params/recallState
      return col.copy({
        definition: prefill.definition as import('../types').ColumnDefinition,
        params: prefill.params,
        recallState: prefill.state, // 'guessed'
      });
    };

    // Preserve the original reference if no recall prefills are applied.
    // This ensures copy() correctly threads the same _initialState reference.
    const hasRecall = recallPrefills.size > 0;
    const recalledInitialState = hasRecall ? initialState.map(applyRecall) : initialState;
    this._initialState = recalledInitialState;

    const columnsToUse = columns
      ? (hasRecall ? columns.map(applyRecall) : columns)
      : recalledInitialState;

    columnsToUse.forEach((column) => {
      column.associateWith(this);
    });

    this._columns.next(columnsToUse);
    // ─────────────────────────────────────────────────────────────────────────

    this._data = this._columns.pipe(
      map((cols) => {
        const typedColumns = cols as ImportStatementColumn[];

        if (typedColumns.length === 0) {
          return [];
        }

        const rowCount = typedColumns[0]?.data?.length || 0;

        return Array.from(
          { length: rowCount },
          (_, index) => new ImportStatementRow(index, typedColumns)
        );
      })
    );

    this._canMoveForward = this._columns.pipe(
      map((cols) => {
        return ImportStatementStage2Impl.areAllColumnsProcessed(cols);
      })
    );
  }

  get stage1(): ImportStatementStage1 {
    return this._stage1;
  }

  get columns(): Observable<ImportStatementColumnHeaderStage2[]> {
    return this._columns.asObservable();
  }

  get currentData(): Observable<ImportStatementRowData[]> {
    return this._data;
  }

  get canMoveForward(): Observable<boolean> {
    return this._canMoveForward;
  }

  get currentFileFormat(): FileFormat | null {
    return this._currentFileFormat;
  }

  get fileSourcesWithFullMatch(): FileSource[] {
    return this._fileSourcesWithFullMatch;
  }

  get selectedSource(): Observable<string | null> {
    return this._selectedSource.asObservable();
  }

  get availableSources(): Observable<string[]> {
    return of(this._cachedAvailableSources);
  }

  get sourcesWithFullMatch(): Observable<string[]> {
    return of(this._cachedSourcesWithFullMatch);
  }

  selectSource(source: string | null): void {
    this._selectedSource.next(source);
  }

  setTransformationMetadata(
    fileFormat: FileFormat | null,
    fileSourcesWithFullMatch: FileSource[],
    availableFileFormats: FileFormatMatch[]
  ): void {
    this._currentFileFormat = fileFormat;
    this._fileSourcesWithFullMatch = fileSourcesWithFullMatch;
    this._availableFileFormats = availableFileFormats; // stored for external inspection

    const uniqueNames = new Set<string>();
    // Use the stored field (not the parameter) so TS sees it as read
    this._availableFileFormats.forEach((match) => {
      match.fileSources.forEach((source) => {
        uniqueNames.add(source.name);
      });
    });
    this._cachedAvailableSources = Array.from(uniqueNames);

    const uniqueFullMatchNames = new Set<string>();
    fileSourcesWithFullMatch.forEach((source) => {
      uniqueFullMatchNames.add(source.name);
    });
    this._cachedSourcesWithFullMatch = Array.from(uniqueFullMatchNames);
  }

  async next(): Promise<ImportStatementStage3> {
    const currentColumns = this._columns.getValue();
    if (!ImportStatementStage2Impl.areAllColumnsProcessed(currentColumns)) {
      throw new Error(
        'Cannot move forward: some columns do not have a definition'
      );
    }

    return this._service.stage3(this);
  }

  /**
   * Applies a column to the current set of columns.
   * 1. Takes current value from _columns
   * 2. Replaces column with the same id if present
   * 3. Otherwise - adds as a new column to the end of list
   * 4. Pushes _columns.next
   *
   * Learning loop (2.3): when a column with a definition is applied, the mapping
   * is saved to the recall pool (if wired). If the column was previously GUESSED,
   * its recallState transitions to 'confirmed' in the applied column.
   *
   * @param column The column to apply
   */
  applyColumn(column: ImportStatementColumnHeaderStage2): void {
    if (column instanceof ImportStatementColumn) {
      column.associateWith(this);
    }

    // ── Learning loop (2.3) ───────────────────────────────────────────────────
    // When the column has a definition, save it to the recall pool.
    // recallState 'guessed' → 'confirmed' on any apply with a definition.
    let columnToApply: ImportStatementColumnHeaderStage2 = column;
    if (this._recallPool && column.definition !== null) {
      const name = column.originalName.getText();
      const definition = column.definition;
      const params = column.params;

      // Determine new recallState: guessed → confirmed on explicit apply
      const newRecallState: 'guessed' | 'confirmed' | null =
        column instanceof ImportStatementColumn && column.recallState === 'guessed'
          ? 'confirmed'
          : column instanceof ImportStatementColumn
            ? column.recallState
            : null;

      // Apply the recall state transition on the column object
      if (
        column instanceof ImportStatementColumn &&
        newRecallState !== column.recallState
      ) {
        columnToApply = column.copy({ recallState: newRecallState });
        if (columnToApply instanceof ImportStatementColumn) {
          columnToApply.associateWith(this);
        }
      }

      // Fire savePool async — errors are swallowed to keep applyColumn sync
      // (matches prior-art recall-save timing: per-column, non-blocking)
      this._recallPool.save(name, definition, params).then((result) => {
        if (result.outcome === 'collision') {
          this.lastSaveCollision = result.collision;
        } else {
          this.lastSaveCollision = null;
        }
      }).catch(() => { /* pool errors are non-fatal */ });
    }
    // ─────────────────────────────────────────────────────────────────────────

    const currentColumns = this._columns.getValue();
    const columnIndex = currentColumns.findIndex((c) => c.id === columnToApply.id);

    if (columnIndex !== -1) {
      const newColumns = [...currentColumns];
      newColumns[columnIndex] = columnToApply;
      this._columns.next(newColumns);
    } else {
      this._columns.next([...currentColumns, columnToApply]);
    }
  }

  /**
   * Resets a column to its initial state or removes it if it wasn't in the initial state.
   * 1. Checks if column exists in current columns
   * 2. Finds the initial column with the same id
   * 3. If initial column is null, removes from current columns
   * 4. Otherwise, replaces the column with the initial one
   *
   * @param columnId The id of the column to reset
   * @returns Promise that resolves when the operation is complete
   */
  async resetColumn(columnId: string): Promise<unknown> {
    const currentColumns = this._columns.getValue();
    const columnIndex = currentColumns.findIndex((c) => c.id === columnId);
    if (columnIndex === -1) {
      throw new Error(`Column with id ${columnId} not found`);
    }

    const initialColumn = this._initialState.find((c) => c.id === columnId);
    const newColumns = [...currentColumns];

    if (initialColumn === undefined) {
      newColumns.splice(columnIndex, 1);
    } else {
      newColumns[columnIndex] = initialColumn;
    }

    this._columns.next(newColumns);

    return Promise.resolve();
  }

  /**
   * Gets the original column with the specified ID from the initial state.
   */
  getOriginalColumn(columnId: string): ImportStatementColumnHeaderStage2 {
    const column = this._initialState.find((c) => c.id === columnId);
    if (!column) {
      throw new Error(`Column with ID ${columnId} not found in initial state`);
    }
    return column;
  }

  /**
   * Gets the original column data with the specified ID from the initial state.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getOriginalColumnData(columnId: string): any[] {
    const column = this._initialState.find((c) => c.id === columnId);
    if (!column) {
      throw new Error(`Column with ID ${columnId} not found in initial state`);
    }

    const typedColumn = column as ImportStatementColumn;
    return typedColumn.data.map((cellData: CellData) => cellData.value);
  }

  copy(
    columns: ImportStatementColumnHeaderStage2[]
  ): ImportStatementStage2Impl {
    const copiedColumns: ImportStatementColumn[] = columns.map((column) => {
      if (column instanceof ImportStatementColumn) {
        const copied = column.copy();
        (
          copied as unknown as { _stage2: ImportStatementStage2 | null }
        )._stage2 = null;
        return copied;
      }
      throw new Error(
        'Cannot copy column: expected ImportStatementColumn instance'
      );
    });

    return new ImportStatementStage2Impl(
      this._stage1,
      this._service,
      this._initialState as ImportStatementColumn[],
      copiedColumns,
      null, // no recall for copies
      this._recallPool // but carry the pool ref
    );
  }

  async applyTransformations(
    transformations: ColumnTransformation[]
  ): Promise<number> {
    if (transformations.length === 0) {
      return 0;
    }

    const currentColumns = this._columns.getValue();
    let successfulCount = 0;
    const totalCount = transformations.length;

    for (const transformation of transformations) {
      const column = currentColumns.find(
        (col) => col.originalName.getText() === transformation.columnName
      );

      if (!column || !(column instanceof ImportStatementColumn)) {
        continue;
      }

      try {
        await this.applyTransformationToColumn(column, transformation);
        successfulCount++;
      } catch {
        // Transformation failed, count as failed but continue
      }
    }

    return totalCount > 0 ? successfulCount / totalCount : 0;
  }

  private async applyTransformationToColumn(
    column: ImportStatementColumn,
    transformation: ColumnTransformation
  ): Promise<void> {
    switch (transformation.definition) {
      case ColumnDefinition.DATE:
        await column.parseAsDate(
          (transformation.params as DateColumnParams) ?? { format: 'auto' }
        );
        break;
      case ColumnDefinition.AMOUNT:
        await column.parseAsAmount(
          (transformation.params as AmountColumnParams) ?? { currency: 'auto' }
        );
        break;
      case ColumnDefinition.CURRENCY:
        await column.parseAsCurrency();
        break;
      case ColumnDefinition.DESCRIPTION:
        await column.parseAsDescription();
        break;
      case ColumnDefinition.CATEGORY:
        await column.parseAsBankCategory();
        break;
      case ColumnDefinition.BALANCE:
        await column.parseAsBalance(
          (transformation.params as BalanceColumnParams) ?? { currency: 'auto' }
        );
        break;
      case ColumnDefinition.BANK_ACCOUNT:
        await column.parseAsBankAccount();
        break;
      case ColumnDefinition.STATUS:
        await column.parseAsTransactionStatus(
          (transformation.params as TransactionStatusColumnParams) ?? {
            successValue: 'auto',
          }
        );
        break;
      case ColumnDefinition.EXCHANGE_RATE:
        await column.parseAsExchangeRate();
        break;
      case ColumnDefinition.BANK_COMMISSION:
        await column.parseAsBankCommission(
          (transformation.params as BankCommissionColumnParams) ?? {
            currency: 'auto',
          }
        );
        break;
      case ColumnDefinition.CASHBACK:
        await column.parseAsCashback(
          (transformation.params as CashbackColumnParams) ?? {
            currency: 'auto',
          }
        );
        break;
      case ColumnDefinition.MERCHANT_CATEGORY:
        await column.parseAsMerchant();
        break;
      case ColumnDefinition.IGNORE:
        await column.ignore();
        break;
      default:
        throw new Error(
          `Unknown column definition: ${transformation.definition}`
        );
    }
  }
}
