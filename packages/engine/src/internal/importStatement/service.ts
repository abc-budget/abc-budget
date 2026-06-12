/**
 * ImportStatementService — orchestrates the multi-stage import pipeline.
 *
 * PORT of `webapp/libs/engine/src/importStatement/service.ts` (561 lines).
 *
 * Adaptations (diff-audit):
 *
 * 1. **IoC removal** (Container → constructor-injection).
 *    Prior art: `constructor(private readonly _ioc: Container)` resolved four
 *    dependencies from the container in lazy getters / stage3 method:
 *      IoCKeys.FILE_FORMAT_DAO     → FileFormatDAO   (EXCISED — see note 1.5)
 *      IoCKeys.FILE_SOURCE_DAO     → FileSourceDAO   (EXCISED — see note 1.5)
 *      IoCKeys.CURRENCY_CACHE      → CurrencyCache (stage2: _createInitialColumns)
 *      IoCKeys.USER_SETTINGS_SERVICE → UserSettingsService (stage3)
 *      IoCKeys.DECISION_TREE_SERVICE → DecisionTreeService (stage3)
 *    Ported: each dependency becomes an explicit constructor parameter.
 *    `CurrencyCache` is REMOVED (1.6 wiring: ImportStatementColumn no longer takes
 *    a currency cache; the static reference module is used directly inside column.ts).
 *    `UserSettingsService`, `DecisionTreeService`, stage3 impl references are RETAINED
 *    (stage3 is ported in Task 4; they are type-only stubs for now).
 *
 * 1.5 **Story 2.6 — FileFormat/FileSource EXCISED (locked decision 3).**
 *    The prior-art format-level recall (`_applyTransformationRules`,
 *    `_saveFileFormatAndSource`, `_loadFileFormatsAndSources`,
 *    `_calculateInitialMatchPercentages`, `_findBestMatchingFormat`) is
 *    superseded by the 2.3 columnName recall pool (FEAT-005 «no format entity»,
 *    FEAT-011 revised; parity proven by the map-once-reimport E2E).
 *    `fileFormatDAO` / `fileSourceDAO` constructor params are GONE; dao.ts is
 *    DELETED (it was interface-only — nothing was ever persisted).  The
 *    `lastUsed: Date.now()` residue died with `_saveFileFormatAndSource` — the
 *    determinism grep is back to 2 classified sites (user-settings source-id,
 *    id generator).  S3a (2.7) redefines a LEAN source notion from the design
 *    bundle's actual needs.
 *
 * 2.5 **Story 2.4 — settingsDao injection** + **Story 2.6 — recallPool injection**:
 *    `settingsDao: UserSettingsDAO | null` — injected for engine-config hydration at
 *    import-session start. `recallPool: RecallPool | null` — injected for column-name
 *    recall (FEAT-005/FEAT-013): `stage2()` runs `recallFor()` over the initial column
 *    names and mounts the result + the pool into ImportStatementStage2Impl.
 *    Both default null (deterministic node-without-idb baseline); the production
 *    wiring happens in `internal/worker/composition-root.ts` (composeEngine), which
 *    is used by BOTH the direct client and the worker host.
 *    Constructor injection table — all params (renumbered after the 2.6 excision):
 *      1. _decisionTreeService ← IoCKeys.DECISION_TREE_SERVICE (stage3, EP-4)
 *      2. _userSettingsService ← IoCKeys.USER_SETTINGS_SERVICE (stage3, EP-4)
 *      3. settingsDao          ← UserSettingsDAO (2.4; wired by composeEngine)
 *      4. recallPool           ← RecallPool (2.3/2.6; wired by composeEngine)
 *
 * 2. **`cloneDeep` from lodash-es** → `structuredClone` (built-in; same semantics
 *    for plain-data transformation arrays).
 *
 * 3. **`generateUniqueId`** → local `../../utils/id/generator` port.
 *
 * 4. **`NativeMessage`** → local `../../utils/messages/message` port.
 *
 * 5. **Import paths** adjusted for internal layout.
 *
 * 6. **verbatimModuleSyntax** — `import type` for type-only imports.
 *
 * 7. **Stage3** — method body retained verbatim; stage3 implementation files
 *    are Task 4 stubs. The service.stage3.spec.ts is deferred to Task 4.
 *
 * rxjs — INTERNAL only (1.1 rule: no Observables on the public surface).
 */

import { firstValueFrom, type Observable, tap } from 'rxjs'; // rxjs — INTERNAL only
import { getLogger } from '../logging';
import { $t, LocalizableException, NativeMessage } from '../utils/messages/index';
import { generateUniqueId } from '../utils/id/generator';
import { hydrateEngineConfig } from '../settings/engine-config';
import type { UserSettingsDAO } from '../settings/user-settings';
import type { RecallPool, RecallResult } from './recall/recall';
import { ImportStatementStage1Impl } from './stage1';
import type { ImportStatementStage1 } from './stage1';
import { ImportStatementColumn } from './stage2/column';
import { ImportStatementStage2Impl } from './stage2/implementation';
import type { CellData, ImportStatementStage2 } from './stage2/types';
import { SupportedDataType } from './stage2/types';
import type { ImportStatementStage3 } from './stage3/types';

// ---------------------------------------------------------------------------
// Stage3 dependencies — stubs until Task 4 ports the full implementation
// The interfaces below are referenced as opaque types to let the service compile.
// ---------------------------------------------------------------------------

/** Stub type for DecisionTreeService until Task 4. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DecisionTreeService = any;

/** Stub type for UserSettingsService (already defined in settings/user-settings.ts — re-import). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type UserSettingsService = any;

// ---------------------------------------------------------------------------
// Service interfaces
// ---------------------------------------------------------------------------

/**
 * Abstract base class for the import statement service.
 */
export abstract class ImportStatementService {
  abstract startWith(data: Record<string, unknown>[]): ImportStatementStage1;
}

/**
 * Internal service interface that exposes stage2 and stage3 transitions.
 */
export interface ImportStatementServiceInternal extends ImportStatementService {
  stage2(stage1: ImportStatementStage1): Promise<ImportStatementStage2>;
  stage3(stage2: ImportStatementStage2): Promise<ImportStatementStage3>;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Implementation of the import statement service.
 *
 * Constructor injection (IoC removal; renumbered after the 2.6 excision —
 * fileFormatDAO / fileSourceDAO are GONE, decision 3):
 *   1. _decisionTreeService ← IoCKeys.DECISION_TREE_SERVICE (stage3, EP-4)
 *   2. _userSettingsService ← IoCKeys.USER_SETTINGS_SERVICE (stage3, EP-4)
 *   3. settingsDao          ← UserSettingsDAO (Story 2.4 — engine-config hydration;
 *                             default null; wired in production by composeEngine,
 *                             internal/worker/composition-root.ts)
 *   4. recallPool           ← RecallPool (Story 2.3/2.6 — column-name recall;
 *                             default null; wired in production by composeEngine)
 *
 * Note: CurrencyCache is NOT injected. The 1.6 wiring removed it from
 * ImportStatementColumn; column.ts uses the static reference module directly.
 */
export class ImportStatementServiceImpl
  extends ImportStatementService
  implements ImportStatementServiceInternal
{
  private static readonly ERROR_KEYS = {
    DECISION_TREE_REQUIRED:
      'engine.importStatement.stage3.decision-tree-required',
    CATEGORIZATION_REQUIRED:
      'engine.importStatement.stage3.categorization-required',
  } as const;

  private readonly _logger = getLogger('engine.importStatement.service');

  constructor(
    // Stage3 deps (EP-4 categorization) — optional; non-null when EP-4 wires them
    private readonly _decisionTreeService: DecisionTreeService = null,
    private readonly _userSettingsService: UserSettingsService = null,
    // Story 2.4: engine-config hydration at import-session start (wired by composeEngine)
    private readonly _settingsDao: UserSettingsDAO | null = null,
    // Story 2.3/2.6: column-name recall pool (wired by composeEngine)
    private readonly _recallPool: RecallPool | null = null
  ) {
    super();
  }

  // region Stage 1
  startWith(data: Record<string, unknown>[]): ImportStatementStage1 {
    return new ImportStatementStage1Impl(data, this);
  }
  // endregion

  // region Stage 2
  async stage2(stage1: ImportStatementStage1): Promise<ImportStatementStage2> {
    // Story 2.4 (Task 4) — SESSION ENTRY HYDRATION:
    // `stage2()` is the import-session boundary: it is the first async transition
    // that commits decoded rows into the column-mapping pipeline where getEngineConfig()
    // is read.  Hydrating here (once, before any column is created) ensures the
    // snapshot is frozen for the duration of this import session.
    // A mid-session `setEngineParam` after this point writes store-only (locked
    // decision 1); the next call to `stage2()` will hydrate again and pick up the
    // new value.  Null dao → no hydrate call, defaults stand (deterministic baseline).
    if (this._settingsDao !== null) {
      await hydrateEngineConfig(this._settingsDao);
    }

    const initialColumns = await this._createInitialColumns(stage1);

    // EXCISED (2.6 decision 3): `_applyTransformationRules(stage2)` is gone —
    // format-level recall is superseded by the 2.3 columnName pool (FEAT-005).
    // Column prefill happens via the RecallResult/RecallPool constructor params
    // of ImportStatementStage2Impl (the 2.3 mount), not via stored FileFormats.
    //
    // Recall mount (2.6 — the 2.3 wiring lands here): when a recall pool is
    // injected, look up the initial column names and pass the GUESSED prefills
    // + the pool into the stage2 constructor.  Null pool → null recall result —
    // the deterministic baseline path is byte-identical to 2.3..2.5 behavior.
    let recallResult: RecallResult | null = null;
    if (this._recallPool !== null) {
      const names = initialColumns.map((col) => col.originalName.getText());
      recallResult = await this._recallPool.recallFor(names);
    }

    return new ImportStatementStage2Impl(
      stage1,
      this,
      initialColumns,
      undefined,
      recallResult,
      this._recallPool
    );
  }

  private async _createInitialColumns(
    stage1: ImportStatementStage1
  ): Promise<ImportStatementColumn[]> {
    const columns = await firstValueFrom(stage1.columns);
    const data = await firstValueFrom(stage1.currentData);

    return columns.map((columnName, _index) => {
      const cellData = data.map(
        (row) =>
          ({
            value: row[columnName],
            type: SupportedDataType.UNKNOWN,
            error: null,
            ignore: null,
          }) as CellData
      );

      const originalName = new NativeMessage(columnName);
      // CurrencyCache removed (1.6 wiring).  Recall mounts via the
      // ImportStatementStage2Impl CONSTRUCTOR (recallResult/recallPool params,
      // passed by stage2() above); settingsDao is injected per-column so
      // `use_base` amount resolution works at parse time.  The production
      // wiring of both deps happens in internal/worker/composition-root.ts
      // (composeEngine) — used by the direct client AND the worker host.
      return new ImportStatementColumn(
        generateUniqueId('column'),
        originalName,
        originalName,
        null,
        null,
        cellData,
        this._settingsDao // enables use_base resolution in parseAsAmount
      );
    });
  }

  // EXCISED (2.6 decision 3): `_applyTransformationRules`,
  // `_loadFileFormatsAndSources`, `_calculateInitialMatchPercentages`, and
  // `_findBestMatchingFormat` deleted — format-level recall superseded by the
  // 2.3 columnName recall pool (FEAT-005 «no format entity»; parity proven by
  // the map-once-reimport E2E in pipeline-e2e.spec.ts).
  // endregion

  // region Stage 3
  // NOTE: stage3() is retained verbatim for Task 4 wiring. Until Task 4 ports
  // the stage3 implementation, calling stage3() with null deps will throw at
  // _resolveStage3Dependencies. This is intentional — service.stage3.spec.ts
  // is deferred to Task 4.
  async stage3(stage2: ImportStatementStage2): Promise<ImportStatementStage3> {
    this._logger.debug('Starting stage3 processing');

    // EXCISED (2.6 decision 3): `_saveFileFormatAndSource(stage2)` call site
    // deleted — nothing format-shaped is persisted anymore; the recall pool
    // saves per-column at apply time (stage2.applyColumn, 2.3).

    const { userSettingsService } = this._resolveStage3Dependencies();

    const { columns: stage3Columns, rows: stage3Rows } =
      await this._prepareStage3Data(stage2, userSettingsService);

    const decisionTree$ = this._loadDecisionTree();

    // S3a (2.7) redefines the lean source notion from the design bundle —
    // the FileSource-backed `stage2.selectedSource` plumbing died with the
    // 2.6 excision (decision 3), so stage3 receives null until then.
    const selectedSource: string | null = null;

    return this._createAndInitializeStage3(
      stage2,
      stage3Columns,
      stage3Rows,
      decisionTree$,
      selectedSource
    );
  }

  private _resolveStage3Dependencies(): {
    userSettingsService: UserSettingsService;
  } {
    if (!this._userSettingsService) {
      throw new LocalizableException(
        $t(ImportStatementServiceImpl.ERROR_KEYS.DECISION_TREE_REQUIRED)
      );
    }
    return {
      userSettingsService: this._userSettingsService,
    };
  }

  private async _prepareStage3Data(
    stage2: ImportStatementStage2,
    _userSettingsService: UserSettingsService
  ): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    columns: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows: any[];
  }> {
    // Task 4 will fill in the actual stage3 column/row generation.
    // For now this is a placeholder that satisfies the type contract.
    void stage2;
    void _userSettingsService;
    return { columns: [], rows: [] };
  }

  private _loadDecisionTree(): Observable<unknown> {
    if (!this._decisionTreeService) {
      throw new LocalizableException(
        $t(ImportStatementServiceImpl.ERROR_KEYS.DECISION_TREE_REQUIRED)
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const decisionTree$ = (this._decisionTreeService as any).getDecisionTree();
    return decisionTree$.pipe(
      tap({
        next: (decisionTree: unknown) => {
          this._logger.debug(
            'Loaded decision tree with',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (decisionTree as any).complexRules?.length,
            'complex rules'
          );
        },
        error: (error: unknown) => {
          this._logger.error('Failed to load decision tree:', error);
        },
      })
    );
  }

  // EXCISED (2.6 decision 3): `_hasAllColumnDefinitions`,
  // `_extractTransformations`, and `_saveFileFormatAndSource` deleted —
  // nothing FileFormat/FileSource-shaped is built or saved anymore.  The
  // `lastUsed: Date.now()` residue died here (determinism: 2 classified sites
  // remain — user-settings source-id, id generator).  The all-columns-mapped
  // guard `_extractTransformations` provided is owned by `stage2.next()`
  // (UnmappedColumnsError, Q-009 — the ⟺ pin).  Per-column learning is the
  // 2.3 recall pool's job (savePool at applyColumn time).

  /**
   * @throws LocalizableException if categorization fails
   */
  private async _createAndInitializeStage3(
    _stage2: ImportStatementStage2,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _columns: any[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _rows: any[],
    _decisionTree$: Observable<unknown>,
    _selectedSource: string | null
  ): Promise<ImportStatementStage3> {
    // Task 4 will implement this. Until then, throw to signal not implemented.
    throw new LocalizableException(
      $t(ImportStatementServiceImpl.ERROR_KEYS.CATEGORIZATION_REQUIRED)
    );
  }
  // endregion
}
