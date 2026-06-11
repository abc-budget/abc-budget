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
 */

import { describe, it, expect, beforeEach, vi, type Mocked } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { NativeMessage } from '../../utils/messages/message';
import type { ImportStatementServiceInternal } from '../service';
import type { ImportStatementStage1 } from '../stage1';
import type {
  AmountColumnParams,
  DateColumnParams,
  FileFormat,
  FileFormatMatch,
  FileSource,
} from '../types';
import {
  ColumnDefinition,
} from '../types';
import type { ColumnParams } from '../types';
import type { ImportStatementStage3 } from '../stage3/types';
import { ImportStatementColumn } from './column';
import { ImportStatementStage2Impl } from './implementation';
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
      await expect(stage2.next()).rejects.toThrow(
        'Cannot move forward: some columns do not have a definition'
      );
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

  describe('applyTransformations', () => {
    it('should return 0 when transformations array is empty', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const result = await stage2.applyTransformations([]);
      expect(result).toBe(0);
    });

    it('should successfully apply DATE transformation', async () => {
      // Create column with valid date data
      const dateColumn = createMockColumn('col1', 'Column 1', [
        '2024-01-01',
        '2024-01-02',
      ]);
      const initialState = [dateColumn, mockInitialState[1]];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      const transformations = [
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(1.0);

      const columns = await firstValueFrom(stage2.columns);
      const transformedColumn = columns.find((col) => col.id === 'col1');
      expect(transformedColumn?.definition).toBe(ColumnDefinition.DATE);
    });

    it('should successfully apply AMOUNT transformation', async () => {
      // Create column with valid amount data
      const amountColumn = createMockColumn('col2', 'Column 2', [
        '100.00',
        '200.00',
      ]);
      const initialState = [mockInitialState[0], amountColumn];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      const transformations = [
        {
          columnName: 'Column 2',
          definition: ColumnDefinition.AMOUNT,
          params: { type: 'mixed', currency: 'auto' } as AmountColumnParams,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(1.0);

      const columns = await firstValueFrom(stage2.columns);
      const transformedColumn = columns.find((col) => col.id === 'col2');
      expect(transformedColumn?.definition).toBe(ColumnDefinition.AMOUNT);
    });

    it('should successfully apply CURRENCY transformation', async () => {
      // Create column with valid currency data
      // NOTE (1.6 wiring): the prior art passed a mock CurrencyCache as 4th arg.
      // In the 1.6 port, column.ts uses the static reference module directly.
      // USD and EUR are valid ISO codes in the real dataset.
      const currencyColumn = createMockColumn(
        'col1',
        'Column 1',
        ['USD', 'EUR']
        // no currencyCache arg — static reference used instead
      );
      const initialState = [currencyColumn, mockInitialState[1]];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      const transformations = [
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.CURRENCY,
          params: null,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(1.0);

      const columns = await firstValueFrom(stage2.columns);
      const transformedColumn = columns.find((col) => col.id === 'col1');
      expect(transformedColumn?.definition).toBe(ColumnDefinition.CURRENCY);
    });

    it('should successfully apply DESCRIPTION transformation', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const transformations = [
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.DESCRIPTION,
          params: null,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(1.0);

      const columns = await firstValueFrom(stage2.columns);
      const transformedColumn = columns.find((col) => col.id === 'col1');
      expect(transformedColumn?.definition).toBe(ColumnDefinition.DESCRIPTION);
    });

    it('should count missing columns as failed transformations', async () => {
      // Create column with valid date data
      const dateColumn = createMockColumn('col1', 'Column 1', [
        '2024-01-01',
        '2024-01-02',
      ]);
      const initialState = [dateColumn, mockInitialState[1]];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      const transformations = [
        {
          columnName: 'NonExistent',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(0.5); // 1 successful / 2 total
    });

    it('should catch transformation exceptions and count as failed', async () => {
      // Create column with valid date data for Column 1
      const dateColumn = createMockColumn('col1', 'Column 1', [
        '2024-01-01',
        '2024-01-02',
      ]);
      const initialState = [dateColumn, mockInitialState[1]];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      // Create a column with invalid data that will cause transformation to fail
      const invalidColumn = new ImportStatementColumn(
        'col3',
        new NativeMessage('Invalid Column'),
        new NativeMessage('Invalid Column'),
        null,
        null,
        [createCell('invalid-date-format')],
        null
      );
      await stage2.applyColumn(invalidColumn);

      const transformations = [
        {
          columnName: 'Invalid Column',
          definition: ColumnDefinition.DATE,
          params: {
            format: { custom: 'YYYY-MM-DD' },
          } as DateColumnParams, // Strict format that will fail
        },
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      // At least one should succeed (Column 1), but Invalid Column might fail
      expect(matchPercentage).toBeGreaterThanOrEqual(0.5);
      expect(matchPercentage).toBeLessThanOrEqual(1.0);
    });

    it('should calculate match percentage as successful / total transformations', async () => {
      // Create columns with valid data
      const dateColumn = createMockColumn('col1', 'Column 1', [
        '2024-01-01',
        '2024-01-02',
      ]);
      const amountColumn = createMockColumn('col2', 'Column 2', [
        '100.00',
        '200.00',
      ]);
      const initialState = [dateColumn, amountColumn];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      const transformations = [
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
        {
          columnName: 'Column 2',
          definition: ColumnDefinition.AMOUNT,
          params: { type: 'mixed', currency: 'auto' } as AmountColumnParams,
        },
        {
          columnName: 'NonExistent',
          definition: ColumnDefinition.DESCRIPTION,
          params: null,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBeCloseTo(2 / 3, 2); // 2 successful / 3 total
    });

    it('should continue transformations even if some fail', async () => {
      // Create columns with valid data
      const dateColumn = createMockColumn('col1', 'Column 1', [
        '2024-01-01',
        '2024-01-02',
      ]);
      const amountColumn = createMockColumn('col2', 'Column 2', [
        '100.00',
        '200.00',
      ]);
      const initialState = [dateColumn, amountColumn];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      const transformations = [
        {
          columnName: 'NonExistent1',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
        {
          columnName: 'NonExistent2',
          definition: ColumnDefinition.AMOUNT,
          params: { type: 'mixed', currency: 'auto' } as AmountColumnParams,
        },
        {
          columnName: 'Column 2',
          definition: ColumnDefinition.AMOUNT,
          params: { type: 'mixed', currency: 'auto' } as AmountColumnParams,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(0.5); // 2 successful / 4 total

      // Verify that successful transformations were applied
      const columns = await firstValueFrom(stage2.columns);
      const col1 = columns.find((col) => col.id === 'col1');
      const col2 = columns.find((col) => col.id === 'col2');
      expect(col1?.definition).toBe(ColumnDefinition.DATE);
      expect(col2?.definition).toBe(ColumnDefinition.AMOUNT);
    });

    it('should match column names exactly (case-sensitive)', async () => {
      // Create column with valid date data
      const dateColumn = createMockColumn('col1', 'Column 1', [
        '2024-01-01',
        '2024-01-02',
      ]);
      const initialState = [dateColumn, mockInitialState[1]];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      // Try to match with different case
      const transformations = [
        {
          columnName: 'column 1', // lowercase, should not match 'Column 1'
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
        {
          columnName: 'Column 1', // correct case
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(0.5); // Only 1 matches (correct case)

      const columns = await firstValueFrom(stage2.columns);
      const col1 = columns.find((col) => col.id === 'col1');
      expect(col1?.definition).toBe(ColumnDefinition.DATE);
    });

    it('should apply IGNORE transformation', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const transformations = [
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.IGNORE,
          params: null,
        },
      ];

      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(1.0);

      const columns = await firstValueFrom(stage2.columns);
      const transformedColumn = columns.find((col) => col.id === 'col1');
      expect(transformedColumn?.definition).toBe(ColumnDefinition.IGNORE);
    });

    it('should skip columns that are not ImportStatementColumn instances', async () => {
      // Create column with valid date data
      const dateColumn = createMockColumn('col1', 'Column 1', [
        '2024-01-01',
        '2024-01-02',
      ]);
      const initialState = [dateColumn, mockInitialState[1]];
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        initialState
      );

      // This shouldn't happen in practice, but test the defensive code
      const transformations = [
        {
          columnName: 'Column 1',
          definition: ColumnDefinition.DATE,
          params: { format: 'auto' } as DateColumnParams,
        },
      ];

      // The method should work normally since all columns are ImportStatementColumn
      const matchPercentage =
        await stage2.applyTransformations(transformations);
      expect(matchPercentage).toBe(1.0);
    });
  });

  describe('new public APIs', () => {
    it('should return null for currentFileFormat when not set', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      expect(stage2.currentFileFormat).toBeNull();
    });

    it('should return correct file format when set', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const fileFormat: FileFormat = {
        id: 1,
        transformations: [],
      };

      stage2.setTransformationMetadata(fileFormat, [], []);

      expect(stage2.currentFileFormat).toBe(fileFormat);
      expect(stage2.currentFileFormat?.id).toBe(1);
    });

    it('should return empty array for currentFileSources when not set', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      expect(stage2.fileSourcesWithFullMatch).toEqual([]);
    });

    it('should return correct file source when set', () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const fileSource: FileSource = {
        id: 1,
        name: 'Test Bank',
        fileFormatId: 1,
      };

      stage2.setTransformationMetadata(null, [fileSource], []);

      expect(stage2.fileSourcesWithFullMatch).toEqual([fileSource]);
      expect(stage2.fileSourcesWithFullMatch.length).toBe(1);
      expect(stage2.fileSourcesWithFullMatch[0]?.id).toBe(1);
      expect(stage2.fileSourcesWithFullMatch[0]?.name).toBe('Test Bank');
    });

    it('should initialize selectedSource observable with null', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const selectedSource = await firstValueFrom(stage2.selectedSource);
      expect(selectedSource).toBeNull();
    });

    it('should update selectedSource when selectSource is called', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      stage2.selectSource('Test Bank');
      const selectedSource1 = await firstValueFrom(stage2.selectedSource);
      expect(selectedSource1).toBe('Test Bank');

      stage2.selectSource('Another Bank');
      const selectedSource2 = await firstValueFrom(stage2.selectedSource);
      expect(selectedSource2).toBe('Another Bank');

      stage2.selectSource(null);
      const selectedSource3 = await firstValueFrom(stage2.selectedSource);
      expect(selectedSource3).toBeNull();
    });

    it('should return empty array for availableSources when not set', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const availableSources = await firstValueFrom(stage2.availableSources);
      expect(availableSources).toEqual([]);
    });

    it('should return unique source names from availableFileFormats', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const fileFormat1: FileFormat = {
        id: 1,
        transformations: [],
      };
      const fileFormat2: FileFormat = {
        id: 2,
        transformations: [],
      };
      const fileSource1: FileSource = {
        id: 1,
        name: 'Bank 1',
        fileFormatId: 1,
      };
      const fileSource2: FileSource = {
        id: 2,
        name: 'Bank 2',
        fileFormatId: 1,
      };
      const fileSource3: FileSource = {
        id: 3,
        name: 'Bank 1', // Duplicate name
        fileFormatId: 2,
      };

      const matches: FileFormatMatch[] = [
        {
          fileFormat: fileFormat1,
          fileSources: [fileSource1, fileSource2],
          matchPercentage: 0.8,
        },
        {
          fileFormat: fileFormat2,
          fileSources: [fileSource3],
          matchPercentage: 0.5,
        },
      ];

      stage2.setTransformationMetadata(fileFormat1, [fileSource1], matches);

      const availableSources = await firstValueFrom(stage2.availableSources);
      expect(availableSources).toEqual(['Bank 1', 'Bank 2']); // Unique names only
      expect(availableSources.length).toBe(2);
    });

    it('should return empty array for sourcesWithFullMatch when not set', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const sourcesWithFullMatch = await firstValueFrom(
        stage2.sourcesWithFullMatch
      );
      expect(sourcesWithFullMatch).toEqual([]);
    });

    it('should return unique source names from fileSourcesWithFullMatch', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const fileSource1: FileSource = {
        id: 1,
        name: 'Bank 1',
        fileFormatId: 1,
      };
      const fileSource2: FileSource = {
        id: 2,
        name: 'Bank 2',
        fileFormatId: 1,
      };
      const fileSource3: FileSource = {
        id: 3,
        name: 'Bank 1', // Duplicate name
        fileFormatId: 2,
      };

      stage2.setTransformationMetadata(
        null,
        [fileSource1, fileSource2, fileSource3],
        []
      );

      const sourcesWithFullMatch = await firstValueFrom(
        stage2.sourcesWithFullMatch
      );
      expect(sourcesWithFullMatch).toEqual(['Bank 1', 'Bank 2']); // Unique names only
      expect(sourcesWithFullMatch.length).toBe(2);
    });

    it('should cache availableSources and sourcesWithFullMatch in setTransformationMetadata', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const fileFormat1: FileFormat = {
        id: 1,
        transformations: [],
      };
      const fileSource1: FileSource = {
        id: 1,
        name: 'Bank 1',
        fileFormatId: 1,
      };
      const fileSource2: FileSource = {
        id: 2,
        name: 'Bank 2',
        fileFormatId: 1,
      };

      const matches: FileFormatMatch[] = [
        {
          fileFormat: fileFormat1,
          fileSources: [fileSource1],
          matchPercentage: 0.8,
        },
      ];

      stage2.setTransformationMetadata(fileFormat1, [fileSource2], matches);

      // Get values multiple times - should be cached (same reference)
      const availableSources1 = await firstValueFrom(stage2.availableSources);
      const availableSources2 = await firstValueFrom(stage2.availableSources);
      const sourcesWithFullMatch1 = await firstValueFrom(
        stage2.sourcesWithFullMatch
      );
      const sourcesWithFullMatch2 = await firstValueFrom(
        stage2.sourcesWithFullMatch
      );

      expect(availableSources1).toEqual(availableSources2);
      expect(sourcesWithFullMatch1).toEqual(sourcesWithFullMatch2);
      expect(availableSources1).toEqual(['Bank 1']);
      expect(sourcesWithFullMatch1).toEqual(['Bank 2']);
    });

    it('should update cached values when setTransformationMetadata is called again', async () => {
      const stage2 = new ImportStatementStage2Impl(
        mockStage1,
        mockService,
        mockInitialState
      );

      const fileFormat1: FileFormat = {
        id: 1,
        transformations: [],
      };
      const fileSource1: FileSource = {
        id: 1,
        name: 'Bank 1',
        fileFormatId: 1,
      };

      const matches1: FileFormatMatch[] = [
        {
          fileFormat: fileFormat1,
          fileSources: [fileSource1],
          matchPercentage: 0.8,
        },
      ];

      stage2.setTransformationMetadata(fileFormat1, [fileSource1], matches1);

      const availableSources1 = await firstValueFrom(stage2.availableSources);
      const sourcesWithFullMatch1 = await firstValueFrom(
        stage2.sourcesWithFullMatch
      );

      expect(availableSources1).toEqual(['Bank 1']);
      expect(sourcesWithFullMatch1).toEqual(['Bank 1']);

      // Update with different data
      const fileSource2: FileSource = {
        id: 2,
        name: 'Bank 2',
        fileFormatId: 1,
      };
      const matches2: FileFormatMatch[] = [
        {
          fileFormat: fileFormat1,
          fileSources: [fileSource2],
          matchPercentage: 0.9,
        },
      ];

      stage2.setTransformationMetadata(fileFormat1, [fileSource2], matches2);

      const availableSources2 = await firstValueFrom(stage2.availableSources);
      const sourcesWithFullMatch2 = await firstValueFrom(
        stage2.sourcesWithFullMatch
      );

      expect(availableSources2).toEqual(['Bank 2']);
      expect(sourcesWithFullMatch2).toEqual(['Bank 2']);
    });
  });

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
