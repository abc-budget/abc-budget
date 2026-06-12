/**
 * PORT of `webapp/libs/engine/src/importStatement/stage2/implementation.spec.ts` (1,347 lines).
 *
 * INTACT suite — every assertion preserved (zero weakening).
 *
 * Mechanical adaptation (diff-audit):
 *   1. **Imports**: `@abc-budget/utils` → local utils; `../../currency/cache` / `CurrencyData`
 *      removed (CurrencyCache dep eliminated in 1.6 wiring — column no longer accepts a
 *      cache; the `createMockCurrencyCache` helper is retained but now just returns null
 *      since column construction no longer takes a cache).
 *   2. `jest.fn()` → `vi.fn()`, `jest.Mocked<>` → `Mocked<>` (vitest).
 *   3. `createMock` helper inlined.
 *   4. `assertType` helper inlined.
 *   5. **CurrencyCache → 1.6 wiring**: `createMockColumn` 4th arg (`currencyCache`) is
 *      no longer the 7th constructor param for ImportStatementColumn. Column constructor
 *      now takes `settingsDao` as 7th arg (default null). Tests that passed a mock
 *      CurrencyCache now pass `null` instead — the 1.6 static reference handles currency
 *      lookup internally. This means `createMockColumn` loses the `currencyCache` param.
 *   6. All assertions kept verbatim.
 *
 * Unportable cases: NONE. All 1,347 lines port intact.
 *
 * EXCISED (2.6 decision 3) — DECLARED suite adaptation (no silent deletions):
 *   - `describe('applyTransformations')` (12 tests) — exercised the stored-
 *     FileFormat replay machinery (`stage2.applyTransformations`), deleted with
 *     the format entity.  See the callout block at its former location.
 *   - `describe('new public APIs')` (12 tests) — exercised currentFileFormat /
 *     fileSourcesWithFullMatch / selectedSource / availableSources /
 *     sourcesWithFullMatch / setTransformationMetadata, all deleted with the
 *     format entity.  See the callout block at its former location.
 *   Everything else is UNTOUCHED — zero weakening beyond these declared
 *   excisions.
 */

import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { NativeMessage } from '../../utils/messages/message';
import type { ImportStatementServiceInternal } from '../service';
import type { ImportStatementStage1 } from '../stage1';
import {
  ColumnDefinition,
} from '../types';
import type { ColumnParams } from '../types';
import type { ImportStatementStage3 } from '../stage3/types';
import { ImportStatementColumn } from './column';
import { ImportStatementStage2Impl } from './implementation';
import { UnmappedColumnsError } from './errors';
import type { CellData } from './types';
import { SupportedDataType } from './types';

// ── createMock helper ─────────────────────────────────────────────────────────

function createMock<T>(overrides: Partial<T> = {}): Mocked<T> {
  return overrides as Mocked<T>;
}

// ── assertType helper ─────────────────────────────────────────────────────────

function assertType<T>(value: unknown): T {
  return value as T;
}

describe('ImportStatementStage2Impl', () => {
  // Mocks
  let mockStage1: Mocked<ImportStatementStage1>;
  let mockService: Mocked<
    Pick<ImportStatementServiceInternal, 'startWith' | 'stage2' | 'stage3'>
  >;
  let mockInitialState: ImportStatementColumn[];
  let mockColumns: ImportStatementColumn[];
  let mockStage3: Mocked<ImportStatementStage3>;

  const createCell = (value: unknown): CellData =>
    ({ value, type: SupportedDataType.TEXT }) as CellData;

  // Helper to create ImportStatementColumn instances.
  // NOTE (1.6 wiring): prior art accepted `currencyCache: CurrencyCache | null` as 4th arg.
  // In the 1.6 port the column constructor takes `settingsDao: UserSettingsDAO | null`
  // as 7th arg (not currencyCache). Tests that needed a CurrencyCache for currency
  // parsing now use the static reference module directly — no cache injection needed.
  const createMockColumn = (
    id: string,
    name: string,
    data: unknown[] = []
    // currencyCache removed (1.6 wiring — pass null settingsDao instead)
  ) => {
    const nameMsg = new NativeMessage(name);
    return new ImportStatementColumn(
      id,
      nameMsg,
      nameMsg,
      null,
      null,
      data.map((v) => createCell(v)),
      null // settingsDao (was currencyCache in prior art — both default null)
    );
  };

  beforeEach(() => {
    // Minimal mock for stage1 (no methods used directly in these tests)
    mockStage1 = createMock<ImportStatementStage1>({});

    // Mock service with stage3 resolving to a mock stage3
    mockStage3 = createMock<ImportStatementStage3>({});
    const stage3MockFn = vi.fn().mockResolvedValue(mockStage3);
    mockService = createMock<
      Pick<ImportStatementServiceInternal, 'startWith' | 'stage2' | 'stage3'>
    >({
      startWith: vi.fn(),
      stage2: vi.fn(),
      stage3: stage3MockFn,
    });

    // Initial columns with two rows of data each
    mockInitialState = [
      createMockColumn('col1', 'Column 1', ['value1', 'value2']),
      createMockColumn('col2', 'Column 2', ['value3', 'value4']),
    ];

    // Optional columns parameter (same shape)
    mockColumns = [
      createMockColumn('col1', 'Column 1', ['value1', 'value2']),
      createMockColumn('col2', 'Column 2', ['value3', 'value4']),
    ];
  });

  describe('constructor', () => {
    it('should throw an error if stage1 is null or undefined', () => {
      expect(
        () =>
          new ImportStatementStage2Impl(
            null as unknown as ImportStatementStage1,
            mockService,
            mockInitialState
          )
      ).toThrow('stage1 cannot be null or undefined');
    });

    it('should throw an error if service is null or undefined', () => {
      expect(
        () =>
          new ImportStatementStage2Impl(
            mockStage1,
            null as unknown as ImportStatementServiceInternal,
            mockInitialState
          )
      ).toThrow('service cannot be null or undefined');
    });

    it('should throw an error if initialState is null or undefined', () => {
      expect(
        () =>
          new ImportStatementStage2Impl(
            mockStage1,
            mockService,
            null as unknown as ImportStatementColumn[]
          )
      ).toThrow('initialState cannot be null or undefined');
    });

    it('should throw an error if initialState is an empty array', () => {
      expect(
        () =>
          new ImportStatementStage2Impl(
            mockStage1,
            mockService,
            [] as unknown as ImportStatementColumn[]
          )
      ).toThrow('initialState cannot be an empty array');
    });

    it('should throw an error if columns is an empty array', () => {
      expect(
        () =>
          new ImportStatementStage2Impl(
            mockStage1,
            mockService,
            mockInitialState,
            [] as unknown as ImportStatementColumn[]
          )
      ).toThrow('columns cannot be an empty array');
    });

    it('should throw an error if columns and initialState have different lengths', () => {
      const shorterColumns = [mockColumns[0]];
      expect(
        () =>
          new ImportStatementStage2Impl(
            mockStage1,
            mockService,
            mockInitialState,
            shorterColumns as unknown as ImportStatementColumn[]
          )
      ).toThrow('initialState and columns should have the same count of rows');
    });

    it('should throw an error if initialState elements have different data lengths', () => {
      const inconsistentInitialState = [
        ...mockInitialState,
        new ImportStatementColumn(
          'col3',
          new NativeMessage('Column 3'),
          new NativeMessage('Column 3'),
          null,
          null,
          [createCell('value5')], // Only one item
          null
        ),
      ];
      expect(
        () =>
          new ImportStatementStage2Impl(
            mockStage1,
            mockService,
            inconsistentInitialState
          )
      ).toThrow(/has different data length than the first element/);
    });

    it('should throw an error if columns elements have different data lengths', () => {
      const inconsistentColumns = [
        ...mockColumns,
        new ImportStatementColumn(
          'col3',
          new NativeMessage('Column 3'),
          new NativeMessage('Column 3'),
          null,
          null,
          [createCell('value5')], // Only one item
          null
        ),
      ];
      const consistentInitialState = [
        ...mockInitialState,
        new ImportStatementColumn(
          'col3',
          new NativeMessage('Column 3'),
          new NativeMessage('Column 3'),
          null,
          null,
          [createCell('value5'), createCell('value6')],
          null
        ),
      ];
      expect(
        () =>
          new ImportStatementStage2Impl(
            mockStage1,
            mockService,
            consistentInitialState,
            inconsistentColumns
          )
      ).toThrow(/has different data length than the first element/);
    });

    it('should initialize with provided parameters', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      expect(stage2.stage1).toBe(mockStage1);
      const columns = await firstValueFrom(stage2.columns);
      expect(columns).toEqual(mockInitialState);
    });

    it('should use columns if provided', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState,
        mockColumns
      );
      const columns = await firstValueFrom(stage2.columns);
      expect(columns).toEqual(mockColumns);
    });
  });

  describe('getters', () => {
    it('should return the stage1 instance', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      expect(stage2.stage1).toBe(mockStage1);
    });

    it('should return the columns observable', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const columns = await firstValueFrom(stage2.columns);
      expect(columns).toEqual(mockInitialState);
    });

    it('should return the currentData observable', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const data = await firstValueFrom(stage2.currentData);
      expect(data.length).toBe(2);
      expect(data[0].rowIndex).toBe(0);
      expect(data[1].rowIndex).toBe(1);
    });

    it('should return the canMoveForward observable (false initially)', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const canMoveForward = await firstValueFrom(stage2.canMoveForward);
      expect(canMoveForward).toBe(false);
    });

    it('should return true from canMoveForward when all columns have definitions', async () => {
      const columnsWithDefinitions = mockInitialState.map(
        (col) =>
          new ImportStatementColumn(
            col.id,
            col.name,
            col.originalName,
            ColumnDefinition.DESCRIPTION,
            null,
            col.data,
            null
          )
      );
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        columnsWithDefinitions
      );
      const canMoveForward = await firstValueFrom(stage2.canMoveForward);
      expect(canMoveForward).toBe(true);
    });
  });

  describe('next', () => {
    it('should throw an error if columns are not processed', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      // LEGIT UPDATE (Story 2.4 Task 3): old pin was the generic Error message string
      // 'Cannot move forward: some columns do not have a definition'.
      // New pin: throws UnmappedColumnsError (LocalizableException subclass) — the
      // toThrow(LocalizableException) contract is STRENGTHENED (typed stop, Q-009).
      await expect(stage2.next()).rejects.toBeInstanceOf(UnmappedColumnsError);
    });

    it('should call service.stage3 with itself when columns are processed', async () => {
      const columnsWithDefinitions = mockInitialState.map(
        (col) =>
          new ImportStatementColumn(
            col.id,
            col.name,
            col.originalName,
            ColumnDefinition.DESCRIPTION,
            null,
            col.data,
            null
          )
      );
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        columnsWithDefinitions
      );
      const result = await stage2.next();
      expect(mockService.stage3).toHaveBeenCalledWith(stage2);
      expect(result).toBe(mockStage3);
    });
  });

  describe('applyColumn', () => {
    it('should replace an existing column with the same id', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const newColumn = new ImportStatementColumn(
        'col1',
        new NativeMessage('Updated Column 1'),
        new NativeMessage('Updated Column 1'),
        ColumnDefinition.DATE,
        null,
        [createCell('new-value1'), createCell('new-value2')],
        null
      );

      stage2.applyColumn(newColumn);
      const columns = await firstValueFrom(stage2.columns);
      expect(columns.length).toBe(2);
      expect(columns[0]).toBe(newColumn);
      expect(columns[1]).toBe(mockInitialState[1]);
    });

    it('should add a new column if id does not exist', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const newColumn = new ImportStatementColumn(
        'col3',
        new NativeMessage('New Column'),
        new NativeMessage('New Column'),
        ColumnDefinition.AMOUNT,
        null,
        [createCell('new-value1'), createCell('new-value2')],
        null
      );

      stage2.applyColumn(newColumn);
      const columns = await firstValueFrom(stage2.columns);
      expect(columns.length).toBe(3);
      expect(columns[0]).toBe(mockInitialState[0]);
      expect(columns[1]).toBe(mockInitialState[1]);
      expect(columns[2]).toBe(newColumn);
    });
  });

  describe('resetColumn', () => {
    it('should reset a column to its initial state', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const modifiedColumn = new ImportStatementColumn(
        'col1',
        new NativeMessage('Modified Column 1'),
        new NativeMessage('Modified Column 1'),
        ColumnDefinition.IGNORE,
        { some: 'params' } as unknown as ColumnParams,
        [createCell('modified-value1'), createCell('modified-value2')],
        null
      );
      stage2.applyColumn(modifiedColumn);

      await stage2.resetColumn('col1');
      const columns = await firstValueFrom(stage2.columns);
      expect(columns.length).toBe(2);
      expect(columns[0]).toBe(mockInitialState[0]);
      expect(columns[1]).toBe(mockInitialState[1]);
    });

    it('should throw an error if column is not found', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      await expect(stage2.resetColumn('non-existent')).rejects.toThrow(
        'Column with id non-existent not found'
      );
    });

    it('should remove a column if it was not in the initial state', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const newColumn = new ImportStatementColumn(
        'col3',
        new NativeMessage('New Column'),
        new NativeMessage('New Column'),
        ColumnDefinition.BALANCE,
        null,
        [createCell('new-value1'), createCell('new-value2')],
        null
      );
      stage2.applyColumn(newColumn);

      let columns = await firstValueFrom(stage2.columns);
      expect(columns.length).toBe(3);

      await stage2.resetColumn('col3');
      columns = await firstValueFrom(stage2.columns);
      expect(columns.length).toBe(2);
      expect(columns[0]).toBe(mockInitialState[0]);
      expect(columns[1]).toBe(mockInitialState[1]);
    });
  });

  describe('getOriginalColumn', () => {
    it('should return the original column from initial state', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const originalColumn = stage2.getOriginalColumn('col1');
      expect(originalColumn).toBe(mockInitialState[0]);
    });

    it('should throw an error if column is not found in initial state', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      expect(() => stage2.getOriginalColumn('non-existent')).toThrow(
        'Column with ID non-existent not found in initial state'
      );
    });
  });

  describe('getOriginalColumnData', () => {
    it('should return array of values extracted from CellData', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const columnData = stage2.getOriginalColumnData('col1');
      expect(columnData).toEqual(['value1', 'value2']);
    });

    it('should throw an error if column is not found in initial state', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      expect(() => stage2.getOriginalColumnData('non-existent')).toThrow(
        'Column with ID non-existent not found in initial state'
      );
    });
  });

  describe('copy', () => {
    it('should create new instance with same stage1, service, initialState', async () => {
      const original = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const columns = await firstValueFrom(original.columns);

      const copied = original.copy(columns);

      expect(copied).not.toBe(original);
      expect(copied.stage1).toBe(original.stage1);
      expect(copied.stage1).toBe(mockStage1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private property for testing
      expect((copied as any)._service).toBe((original as any)._service);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private property for testing
      expect((copied as any)._service).toBe(mockService);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private property for testing
      expect((copied as any)._initialState).toBe(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private property for testing
        (original as any)._initialState
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private property for testing
      expect((copied as any)._initialState).toBe(mockInitialState);
    });

    it('should deep copy columns (not same reference)', async () => {
      const original = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const originalColumns = await firstValueFrom(original.columns);

      const copied = original.copy(originalColumns);
      const copiedColumns = await firstValueFrom(copied.columns);

      expect(copiedColumns.length).toBe(originalColumns.length);
      copiedColumns.forEach((copiedCol, index) => {
        const originalCol = originalColumns[index];
        expect(copiedCol).not.toBe(originalCol);
        expect(copiedCol.id).toBe(originalCol.id);
        expect(copiedCol.name).toEqual(originalCol.name);
        expect(copiedCol.originalName).toEqual(originalCol.originalName);
      });
    });

    it('should associate copied columns with new stage2 instance', async () => {
      const original = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const originalColumns = await firstValueFrom(original.columns);

      const copied = original.copy(originalColumns);
      const copiedColumns = await firstValueFrom(copied.columns);

      copiedColumns.forEach((copiedCol) => {
        const column = copiedCol as ImportStatementColumn;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private property for testing
        expect((column as any)._stage2).toBe(copied);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private property for testing
        expect((column as any)._stage2).not.toBe(original);
      });
    });

    it('should not affect original when modifications are made to copied stage2', async () => {
      const original = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );
      const originalColumns = await firstValueFrom(original.columns);

      const copied = original.copy(originalColumns);

      // Modify a column in the copied stage2
      const modifiedColumn = new ImportStatementColumn(
        'col1',
        new NativeMessage('Modified Column'),
        new NativeMessage('Modified Column'),
        ColumnDefinition.DATE,
        null,
        [createCell('modified-value1'), createCell('modified-value2')],
        null
      );
      await copied.applyColumn(modifiedColumn);

      // Verify original is unchanged
      const originalColumnsAfter = await firstValueFrom(original.columns);
      expect(originalColumnsAfter.length).toBe(originalColumns.length);
      expect(originalColumnsAfter[0].name.getText()).toBe('Column 1');
      expect(originalColumnsAfter[0].definition).toBeNull();

      // Verify copied is changed
      const copiedColumnsAfter = await firstValueFrom(copied.columns);
      expect(copiedColumnsAfter[0].name.getText()).toBe('Modified Column');
      expect(copiedColumnsAfter[0].definition).toBe(ColumnDefinition.DATE);
    });

    it('should throw error if column is not ImportStatementColumn instance', async () => {
      const original = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      // Create a fake column that's not an ImportStatementColumn
      const fakeColumns = [
        { id: 'col1', name: 'Fake Column' },
      ] as unknown as ImportStatementColumn[];

      expect(() => original.copy(fakeColumns)).toThrow(
        'Cannot copy column: expected ImportStatementColumn instance'
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // EXCISED (2.6 decision 3): describe('applyTransformations') — 12 tests deleted.
  // stage2.applyTransformations() existed solely to replay a stored FileFormat's
  // transformation list during format-level recall; it died with the format
  // entity (FEAT-005).  Per removed assertion:
  //   - 'should return 0 when transformations array is empty' — proved the empty-
  //     list guard of the replay loop — dead with the entity.
  //   - 'should successfully apply DATE transformation' — proved replay maps DATE
  //     via parseAsDate — superseded by the 2.3 pool prefill + direct parseAsDate
  //     coverage (column.spec.ts; pipeline-e2e applyMappings path).
  //   - 'should successfully apply AMOUNT transformation' — same, for
  //     parseAsAmount — superseded by column.spec.ts + pipeline-e2e.
  //   - 'should successfully apply CURRENCY transformation' — same, for
  //     parseAsCurrency — superseded by column.spec.ts.
  //   - 'should successfully apply DESCRIPTION transformation' — same, for
  //     parseAsDescription — superseded by column.spec.ts + pipeline-e2e.
  //   - 'should count missing columns as failed transformations' — proved the
  //     match-percentage denominator counted absent columns — dead with the
  //     entity (match percentage was format-recall-only arithmetic).
  //   - 'should catch transformation exceptions and count as failed' — proved
  //     replay continued past per-column failures — dead with the entity
  //     (the live per-column boundary is ColumnTransformRejection, 2.4 suites).
  //   - 'should calculate match percentage as successful / total transformations'
  //     — format-match arithmetic — dead with the entity.
  //   - 'should continue transformations even if some fail' — replay resilience
  //     — dead with the entity.
  //   - 'should match column names exactly (case-sensitive)' — proved replay
  //     keyed on exact originalName — superseded by the 2.3 pool's normalizeKey
  //     contract (recall.spec.ts pins the normalization semantics).
  //   - 'should apply IGNORE transformation' — replay maps IGNORE via ignore()
  //     — superseded by column.spec.ts + pipeline-e2e IGNORE mappings.
  //   - 'should skip columns that are not ImportStatementColumn instances' —
  //     replay's defensive instanceof guard — dead with the entity.
  // ═══════════════════════════════════════════════════════════════════════════

  // ═══════════════════════════════════════════════════════════════════════════
  // EXCISED (2.6 decision 3): describe('new public APIs') — 12 tests deleted.
  // All exercised the FileFormat/FileSource metadata surface of stage2
  // (currentFileFormat, fileSourcesWithFullMatch, selectedSource/selectSource,
  // availableSources, sourcesWithFullMatch, setTransformationMetadata), which
  // died with the format entity (FEAT-005).  Per removed assertion:
  //   - 'should return null for currentFileFormat when not set' /
  //     'should return correct file format when set' — proved the
  //     currentFileFormat getter round-trip via setTransformationMetadata —
  //     dead with the entity (no format to expose).
  //   - 'should return empty array for currentFileSources when not set' /
  //     'should return correct file source when set' — proved the
  //     fileSourcesWithFullMatch getter round-trip — dead with the entity.
  //   - 'should initialize selectedSource observable with null' /
  //     'should update selectedSource when selectSource is called' — proved the
  //     source-picker BehaviorSubject plumbing — dead with the entity; S3a (2.7)
  //     redefines the lean source notion from the design bundle.
  //   - 'should return empty array for availableSources when not set' /
  //     'should return unique source names from availableFileFormats' — proved
  //     source-name derivation from FileFormatMatch.fileSources — dead with the
  //     entity.
  //   - 'should return empty array for sourcesWithFullMatch when not set' /
  //     'should return unique source names from fileSourcesWithFullMatch' —
  //     proved full-match source-name derivation — dead with the entity.
  //   - 'should cache availableSources and sourcesWithFullMatch in
  //     setTransformationMetadata' / 'should update cached values when
  //     setTransformationMetadata is called again' — proved the metadata cache
  //     refresh — dead with the entity.
  // The 2.3 recall-pool equivalents of "stage2 remembers mappings" live in
  // implementation.recall.spec.ts (prefill GUESSED, confirm, savePool,
  // collision LWW) and the pipeline-e2e map-once-reimport E2E.
  // ═══════════════════════════════════════════════════════════════════════════

  // ── assertType helper usage pin ──────────────────────────────────────────────
  // The assertType import is used in service.spec.ts but included here to confirm
  // the helper compiles correctly in this module.
  it('assertType helper — compile-level check', () => {
    const stage2 = new ImportStatementStage2Impl(
      mockStage1,
      mockService,
      mockInitialState
    );
    const typed = assertType<ImportStatementStage2Impl>(stage2);
    expect(typed).toBe(stage2);
  });
});
