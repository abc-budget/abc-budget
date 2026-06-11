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
 *      IoCKeys.FILE_FORMAT_DAO     → FileFormatDAO
 *      IoCKeys.FILE_SOURCE_DAO     → FileSourceDAO
 *      IoCKeys.CURRENCY_CACHE      → CurrencyCache (stage2: _createInitialColumns)
 *      IoCKeys.USER_SETTINGS_SERVICE → UserSettingsService (stage3)
 *      IoCKeys.DECISION_TREE_SERVICE → DecisionTreeService (stage3)
 *    Ported: each dependency becomes an explicit constructor parameter.
 *    `CurrencyCache` is REMOVED (1.6 wiring: ImportStatementColumn no longer takes
 *    a currency cache; the static reference module is used directly inside column.ts).
 *    `UserSettingsService`, `DecisionTreeService`, stage3 impl references are RETAINED
 *    (stage3 is ported in Task 4; they are type-only stubs for now).
 *
 * 2.5 **Story 2.4 — settingsDao injection** (Task 4):
 *    `settingsDao: UserSettingsDAO | null` — injected for engine-config hydration at
 *    import-session start. Default null for backward-compat; production wiring is 2.6.
 *    DAOs (constructor injection table — all params):
 *      - fileFormatDAO      ← IoCKeys.FILE_FORMAT_DAO
 *      - fileSourceDAO      ← IoCKeys.FILE_SOURCE_DAO
 *      - settingsDao        ← UserSettingsDAO (2.4, default null; 2.6 wiring)
 *      - _decisionTreeService ← IoCKeys.DECISION_TREE_SERVICE (stage3, Task 4)
 *      - _userSettingsService ← IoCKeys.USER_SETTINGS_SERVICE (stage3, Task 4)
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
import type { FileFormatDAO, FileSourceDAO } from './dao';
import { ImportStatementStage1Impl } from './stage1';
import type { ImportStatementStage1 } from './stage1';
import { ImportStatementColumn } from './stage2/column';
import { ImportStatementStage2Impl } from './stage2/implementation';
import type {
  CellData,
  ImportStatementColumnHeaderStage2,
  ImportStatementStage2,
} from './stage2/types';
import { SupportedDataType } from './stage2/types';
import type { ImportStatementStage3 } from './stage3/types';
import type {
  ColumnTransformation,
  FileFormat,
  FileFormatMatch,
  FileSource,
} from './types';

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
 * Constructor injection (IoC removal):
 *   - fileFormatDAO    ← IoCKeys.FILE_FORMAT_DAO
 *   - fileSourceDAO    ← IoCKeys.FILE_SOURCE_DAO
 *   - settingsDao      ← UserSettingsDAO (Story 2.4 — engine-config hydration; default null;
 *                         production wiring is 2.6 ⚠️ MUST-DO before shipping)
 *   - [Stage3 deps are Task 4 — DecisionTreeService, UserSettingsService]
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
    private readonly _fileFormatDAO: FileFormatDAO,
    private readonly _fileSourceDAO: FileSourceDAO,
    // Stage3 deps (Task 4) — optional for now; non-null in production wiring
    private readonly _decisionTreeService: DecisionTreeService = null,
    private readonly _userSettingsService: UserSettingsService = null,
    // Story 2.4: engine-config hydration at import-session start (production wiring 2.6)
    private readonly _settingsDao: UserSettingsDAO | null = null
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
    const stage2 = new ImportStatementStage2Impl(stage1, this, initialColumns);

    return await this._applyTransformationRules(stage2);
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
      // CurrencyCache removed (1.6 wiring) — settingsDao passed as null here.
      // Recall mounts via the ImportStatementStage2Impl CONSTRUCTOR (recallPool
      // param); this service-level path does not wire it yet — the production
      // wiring (recall pool + settingsDao injection) lands with the client
      // surface in 2.6. ⚠️ 2.6 MUST-DO: do not ship the client surface with
      // this path unwired.
      return new ImportStatementColumn(
        generateUniqueId('column'),
        originalName,
        originalName,
        null,
        null,
        cellData,
        null // settingsDao — not needed at column-creation time
      );
    });
  }

  private async _applyTransformationRules(
    originalState: ImportStatementStage2Impl
  ): Promise<ImportStatementStage2Impl> {
    const { fileFormats, fileSources } =
      await this._loadFileFormatsAndSources();

    if (fileFormats.length === 0) {
      return originalState;
    }

    const matches = await this._calculateInitialMatchPercentages(
      originalState,
      fileFormats,
      fileSources
    );

    if (matches.length === 0) {
      return originalState;
    }

    const bestMatch = await this._findBestMatchingFormat(
      originalState,
      matches
    );

    if (!bestMatch) {
      return originalState;
    }

    if (bestMatch.matchPercentage === 1.0) {
      bestMatch.stage2.setTransformationMetadata(
        bestMatch.match.fileFormat,
        bestMatch.match.fileSources,
        matches
      );
    } else {
      const fileFormatWithoutId: FileFormat = {
        transformations: structuredClone(bestMatch.match.fileFormat.transformations),
      };
      bestMatch.stage2.setTransformationMetadata(
        fileFormatWithoutId,
        [],
        matches
      );
    }

    return bestMatch.stage2;
  }

  private async _loadFileFormatsAndSources(): Promise<{
    fileFormats: FileFormat[];
    fileSources: FileSource[];
  }> {
    const [fileFormats, fileSources] = await Promise.all([
      this._fileFormatDAO.list(),
      this._fileSourceDAO.list(),
    ]);

    return { fileFormats, fileSources };
  }

  private async _calculateInitialMatchPercentages(
    originalState: ImportStatementStage2Impl,
    fileFormats: FileFormat[],
    fileSources: FileSource[]
  ): Promise<FileFormatMatch[]> {
    const stage1 = originalState.stage1;
    const stage1ColumnNames = await firstValueFrom(stage1.columns);

    const matches: FileFormatMatch[] = [];

    for (const format of fileFormats) {
      const transformationColumnNames = format.transformations.map(
        (t) => t.columnName
      );

      if (transformationColumnNames.length === 0) {
        continue;
      }

      const matchedCount = transformationColumnNames.filter((colName) =>
        stage1ColumnNames.includes(colName)
      ).length;

      const matchPercentage = matchedCount / transformationColumnNames.length;

      let fileSourcesForFormat: FileSource[];
      if (format.id !== undefined) {
        fileSourcesForFormat = fileSources.filter(
          (s) => s.fileFormatId === format.id
        );
      } else {
        this._logger.error(
          'Unexpected situation: File format ID is null, but it is impossible because it was loaded from the database'
        );
        fileSourcesForFormat = [];
      }

      matches.push({
        fileFormat: format,
        fileSources: fileSourcesForFormat,
        matchPercentage,
      });
    }

    matches.sort((a, b) => b.matchPercentage - a.matchPercentage);

    return matches;
  }

  private async _findBestMatchingFormat(
    stage2: ImportStatementStage2Impl,
    matches: FileFormatMatch[]
  ): Promise<{
    stage2: ImportStatementStage2Impl;
    match: FileFormatMatch;
    matchPercentage: number;
  } | null> {
    let bestActualMatch: {
      stage2: ImportStatementStage2Impl;
      match: FileFormatMatch;
      actualPercentage: number;
    } | null = null;

    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const currentColumns = await firstValueFrom(stage2.columns);
      const stage2Copy = stage2.copy(currentColumns);

      const actualMatchPercentage = await stage2Copy.applyTransformations(
        match.fileFormat.transformations
      );

      const updatedMatch: FileFormatMatch = {
        ...match,
        matchPercentage: actualMatchPercentage,
      };
      matches[i] = updatedMatch;

      if (
        !bestActualMatch ||
        actualMatchPercentage > bestActualMatch.actualPercentage
      ) {
        bestActualMatch = {
          stage2: stage2Copy,
          match: updatedMatch,
          actualPercentage: actualMatchPercentage,
        };
      }

      const nextMatch = matches[i + 1];
      const shouldStop =
        actualMatchPercentage >= (nextMatch?.matchPercentage ?? 0) ||
        i === matches.length - 1;

      if (shouldStop) {
        break;
      }
    }

    matches.sort((a, b) => b.matchPercentage - a.matchPercentage);

    return bestActualMatch
      ? {
          stage2: bestActualMatch.stage2,
          match: bestActualMatch.match,
          matchPercentage: bestActualMatch.actualPercentage,
        }
      : null;
  }
  // endregion

  // region Stage 3
  // NOTE: stage3() is retained verbatim for Task 4 wiring. Until Task 4 ports
  // the stage3 implementation, calling stage3() with null deps will throw at
  // _resolveStage3Dependencies. This is intentional — service.stage3.spec.ts
  // is deferred to Task 4.
  async stage3(stage2: ImportStatementStage2): Promise<ImportStatementStage3> {
    this._logger.debug('Starting stage3 processing');

    // Save file format and source before proceeding
    await this._saveFileFormatAndSource(stage2);

    const { userSettingsService } = this._resolveStage3Dependencies();

    const { columns: stage3Columns, rows: stage3Rows } =
      await this._prepareStage3Data(stage2, userSettingsService);

    const decisionTree$ = this._loadDecisionTree();

    const selectedSource = await firstValueFrom(stage2.selectedSource);

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

  /**
   * Type guard for type narrowing: ensures all columns have non-null definitions.
   */
  private _hasAllColumnDefinitions(
    columns: ImportStatementColumnHeaderStage2[]
  ): columns is Array<
    ImportStatementColumnHeaderStage2 & {
      definition: NonNullable<ImportStatementColumnHeaderStage2['definition']>;
    }
  > {
    return columns.every((col) => col.definition !== null);
  }

  /**
   * Extracts column transformations from stage2 columns.
   * @throws LocalizableException if any column has a null definition
   */
  private _extractTransformations(
    columns: ImportStatementColumnHeaderStage2[]
  ): ColumnTransformation[] {
    if (!this._hasAllColumnDefinitions(columns)) {
      const columnsWithNullDefinition = columns.filter(
        (col) => col.definition === null
      );
      const columnNames = columnsWithNullDefinition
        .map((col) => col.originalName.getText())
        .join(', ');
      throw new LocalizableException(
        $t('engine.importStatement.stage3.columns-without-definition', {
          columns: columnNames,
        })
      );
    }

    return columns.map((col) => ({
      columnName: col.originalName.getText(),
      definition: col.definition,
      params: col.params,
    }));
  }

  /**
   * Saves the current file format and source from stage2.
   * @throws LocalizableException if save operations fail
   */
  private async _saveFileFormatAndSource(
    stage2: ImportStatementStage2
  ): Promise<void> {
    const currentFormat = stage2.currentFileFormat;
    const columns = await firstValueFrom(stage2.columns);
    const transformations = this._extractTransformations(columns);

    const updatedFormat: FileFormat = {
      ...(currentFormat?.id !== undefined ? { id: currentFormat.id } : {}),
      transformations: transformations,
      lastUsed: Date.now(),
    };

    let savedFormat: FileFormat;
    try {
      savedFormat = await this._fileFormatDAO.upsert(updatedFormat);
      this._logger.debug('File format saved successfully', {
        formatId: savedFormat.id,
      });
    } catch (error) {
      this._logger.error('Failed to save file format:', error);
      throw new LocalizableException(
        $t('engine.importStatement.stage3.failed-to-save-format')
      );
    }

    const selectedSourceName = await firstValueFrom(stage2.selectedSource);

    if (selectedSourceName !== null) {
      if (savedFormat.id === undefined) {
        this._logger.error(
          'Cannot save source: file format ID is undefined after upsert'
        );
        throw new LocalizableException(
          $t(
            'engine.importStatement.stage3.failed-to-save-source-format-id-missing'
          )
        );
      }

      const sourcesWithFullMatch = await firstValueFrom(
        stage2.sourcesWithFullMatch
      );

      if (!sourcesWithFullMatch.includes(selectedSourceName)) {
        try {
          await this._fileSourceDAO.create({
            name: selectedSourceName,
            fileFormatId: savedFormat.id,
          });
          this._logger.debug('File source saved successfully', {
            sourceName: selectedSourceName,
            formatId: savedFormat.id,
          });
        } catch (error) {
          this._logger.error('Failed to save file source:', error);
          throw new LocalizableException(
            $t('engine.importStatement.stage3.failed-to-save-source')
          );
        }
      } else {
        this._logger.debug(
          'File source already exists in full match list, skipping save',
          {
            sourceName: selectedSourceName,
          }
        );
      }
    }
  }

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
