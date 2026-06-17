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

import { BehaviorSubject, Observable, map } from 'rxjs'; // rxjs — INTERNAL only
import { getLogger } from '../../logging';
import type { ImportStatementServiceInternal } from '../service';
import type { ImportStatementStage1 } from '../stage1';
import type { RecallPool, RecallResult } from '../recall/recall';
import { normalizeKey } from '../recall/recall';
import type {
  ImportStatementColumnHeaderStage2,
  ImportStatementRowData,
  ImportStatementStage2,
} from './types';
import type { ImportStatementStage3 } from '../stage3/types';
import { ImportStatementColumn } from './column';
import { ImportStatementRow } from './row';
import type { CellData } from './types';
import { UnmappedColumnsError } from './errors';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export class ImportStatementStage2Impl implements ImportStatementStage2 {
  /**
   * ONE predicate — the single source of truth for "which columns are unmapped".
   *
   * Returns the list of columns (from the provided array) whose `definition` is
   * null (i.e., still UNKNOWN).  The name is taken from `originalName.getText()`
   * because `originalName` is the header text as it appears in the source file —
   * the same field recall uses for key normalization and the most stable human-
   * readable identifier at this stage.  `name` could be a localized display name
   * that differs per locale; `originalName` is always the raw file header.
   *
   * Used by:
   *   - `getUnmappedColumns()` (public) — for 2.8 Option-A gate rendering
   *   - `next()` — throws `UnmappedColumnsError` when the list is non-empty
   *   - `areAllColumnsProcessed()` (static) — delegates here; ONE source of truth
   */
  private static _computeUnmappedColumns(
    columns: ImportStatementColumnHeaderStage2[]
  ): ReadonlyArray<{ id: string; name: string }> {
    return columns
      .filter((col) => col.definition === null)
      .map((col) => ({ id: col.id, name: col.originalName.getText() }));
  }

  /**
   * Returns the list of currently unmapped columns (definition === null).
   * Empty array means all columns are mapped.
   *
   * The ⟺ pin (decision 3): `getUnmappedColumns().length === 0 ⟺ next() does not throw`.
   * Both sides derive from the same `_computeUnmappedColumns()` predicate.
   */
  getUnmappedColumns(): ReadonlyArray<{ id: string; name: string }> {
    return ImportStatementStage2Impl._computeUnmappedColumns(this._columns.getValue());
  }

  /**
   * Delegates to `_computeUnmappedColumns()` — ONE source of truth.
   * The ported suite's `canMoveForward` observable path calls this static;
   * it is preserved to keep that surface intact.
   */
  private static areAllColumnsProcessed(
    columns: ImportStatementColumnHeaderStage2[]
  ): boolean {
    return ImportStatementStage2Impl._computeUnmappedColumns(columns).length === 0;
  }

  private readonly _stage1: ImportStatementStage1;
  private readonly _service: ImportStatementServiceInternal;
  private readonly _initialState: ImportStatementColumnHeaderStage2[];
  private readonly _columns = new BehaviorSubject<
    ImportStatementColumnHeaderStage2[]
  >([]);
  private readonly _data: Observable<ImportStatementRowData[]>;
  private readonly _canMoveForward: Observable<boolean>;
  // EXCISED (2.6 decision 3): the FileFormat/FileSource metadata fields
  // (_currentFileFormat, _fileSourcesWithFullMatch, _availableFileFormats,
  // the cached source-name lists, and the _selectedSource subject) died with
  // the format entity (FEAT-005) — recall prefill state lives on the columns
  // themselves (recallState) and in `recognized`/`lastSaveCollision` below.

  // Recall pool (2.3)
  private readonly _recallPool: RecallPool | null;

  /**
   * Staged recall writes (2.8 decision #4 — defer-commit).
   *
   * Keyed by columnId (NOT normalizedName) so unstageRecallWrite is per-column-
   * correct and name-collapse (NFC/NFD siblings) is deferred to flush, where it
   * matches the pool's own LWW. Each apply with a definition STAGES here; the
   * actual pool write happens only on flushRecallWrites() (importNext/advance).
   * importAbort lets the buffer die with this instance (= discard);
   * importResetColumn calls unstageRecallWrite. `confirmed` marks an entry the
   * user resolved-confirm → flush uses confirmSave (LWW) instead of save.
   */
  private readonly _stagedRecallWrites = new Map<
    string,
    {
      name: string;
      definition: import('../types').ColumnDefinition;
      params: import('../types').ColumnParams | null;
      confirmed?: boolean;
    }
  >();

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

  // EXCISED (2.6 decision 3): currentFileFormat / fileSourcesWithFullMatch /
  // selectedSource / availableSources / sourcesWithFullMatch getters,
  // selectSource(), and setTransformationMetadata() are deleted — all were
  // FileFormat/FileSource-coupled (format-level recall + the source picker
  // backed by stored FileSources).  Superseded by the 2.3 columnName pool;
  // S3a (2.7) redefines the lean source notion from the design bundle.

  async next(): Promise<ImportStatementStage3> {
    const currentColumns = this._columns.getValue();
    const unmapped = ImportStatementStage2Impl._computeUnmappedColumns(currentColumns);
    if (unmapped.length > 0) {
      throw new UnmappedColumnsError(unmapped);
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

      // ── 2.8 decision #4: DETECT at apply, STAGE the write, DEFER to flush ────
      // STAGE the write keyed by columnId (last apply per column wins). The
      // actual pool write fires on flushRecallWrites() (importNext = the user's
      // advance/endorsement); importAbort discards by dropping this instance;
      // importResetColumn unstages. An apply REPLACES any prior staged entry for
      // this column (incl. clearing a previous `confirmed` flag — a re-apply is a
      // fresh, unresolved mapping).
      this._stagedRecallWrites.set(columnToApply.id, { name, definition, params });

      // Fire the READ-ONLY collision DETECT async — non-blocking so applyColumn
      // stays sync, and map-time UX is byte-identical to the old save() (it sets
      // lastSaveCollision exactly as before). NO IDB WRITE here. NON-FATAL but
      // NEVER SILENT (HC-7): a failed detect means the next import may quietly
      // lose recall — log loudly.
      this._recallPool.detectCollision(name, definition, params).then((result) => {
        if (result.outcome === 'collision') {
          this.lastSaveCollision = result.collision;
        } else {
          this.lastSaveCollision = null;
        }
      }).catch((err) => {
        getLogger('engine.importStatement.stage2').error(
          'recall-pool collision detect failed — the mapping works for THIS import, but it may NOT be recalled next time:',
          name,
          err,
        );
      });
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
   * Install a RECALL-PARSED column (Story 4.9a.1) — the parse-only seam.
   *
   * The recall mount prefills `definition`/`params`/`recallState:'guessed'` but
   * leaves the cells as raw strings. `service.stage2` re-runs the parse via
   * `ImportStatementColumn.parseFromRecall`, which lands HERE to install the
   * now-typed column. UNLIKE {@link applyColumn} this does the swap ONLY:
   *   - NO `guessed → confirmed` transition (the mapping stays GUESSED — the user
   *     hasn't endorsed it yet; a re-import is not a confirmation), and
   *   - NO `_stagedRecallWrites` staging (the mount must not warm the pool — the
   *     learning loop still fires on the user's NEXT advance via applyColumn).
   *
   * Replaces the same-id column in place (recall columns always pre-exist by id).
   *
   * @param column The recall-parsed column to install.
   */
  installParsedRecallColumn(column: ImportStatementColumnHeaderStage2): void {
    if (column instanceof ImportStatementColumn) {
      column.associateWith(this);
    }

    const currentColumns = this._columns.getValue();
    const columnIndex = currentColumns.findIndex((c) => c.id === column.id);

    if (columnIndex !== -1) {
      const newColumns = [...currentColumns];
      newColumns[columnIndex] = column;
      this._columns.next(newColumns);
    } else {
      // A recall-parsed column should always pre-exist by id (the mount created
      // it); append defensively rather than silently drop (HC-7).
      this._columns.next([...currentColumns, column]);
    }
  }

  /**
   * Flush all staged recall writes to the pool (2.8 decision #4).
   *
   * Called on importNext (the advance = the user's endorsement). Commits each
   * staged entry preserving today's write semantics:
   *   - new / identical / unresolved → `save()` (writes new/identical; a
   *     still-unresolved params/type change returns a collision WITHOUT writing —
   *     the safe no-clobber default, exactly as save() does);
   *   - user resolved-confirm (`confirmed`) → `confirmSave()` (LWW overwrite).
   * Awaits all writes. NON-FATAL but NEVER SILENT (HC-7): a failed write is
   * logged loudly, never thrown — a flush failure must not abort the advance.
   * No-op when no pool is wired or nothing is staged.
   */
  async flushRecallWrites(): Promise<void> {
    if (!this._recallPool) return;
    const pool = this._recallPool;
    const writes = Array.from(this._stagedRecallWrites.values()).map((entry) =>
      (entry.confirmed
        ? pool.confirmSave(entry.name, entry.definition, entry.params)
        : pool.save(entry.name, entry.definition, entry.params)
      ).catch((err) => {
        getLogger('engine.importStatement.stage2').error(
          'recall-pool flush failed — this mapping will NOT be recalled next time:',
          entry.name,
          err,
        );
      })
    );
    await Promise.all(writes);
  }

  /**
   * Drop a column's staged recall write (2.8 decision #4 — for importResetColumn).
   *
   * Clean per-id: a sibling column sharing a normalized name is untouched
   * (staging is keyed by columnId, not by normalizedName). No-op if absent.
   */
  unstageRecallWrite(columnId: string): void {
    this._stagedRecallWrites.delete(columnId);
  }

  /**
   * Mark a column's staged recall write as user-confirmed (2.8 decision #4 — for
   * importResolveCollision on confirm). Flush will then use confirmSave (LWW)
   * for this entry instead of the no-clobber save. No-op if nothing is staged
   * for the id (idempotent).
   */
  confirmStagedRecallWrite(columnId: string): void {
    const entry = this._stagedRecallWrites.get(columnId);
    if (entry) {
      entry.confirmed = true;
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

    // 2.8 decision #4: a reset discards this column's staged recall write so an
    // unmapped column never reaches the pool on the next advance (pin d).
    this.unstageRecallWrite(columnId);

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

  // EXCISED (2.6 decision 3): applyTransformations() and
  // applyTransformationToColumn() are deleted — they existed solely to replay
  // a stored FileFormat's transformation list during format-level recall
  // (`service._findBestMatchingFormat`).  Per-column parsing is driven
  // directly via the ImportStatementColumn parseAs* methods; column-name
  // recall prefill is the 2.3 pool's job (constructor recallResult param).
}
