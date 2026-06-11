/**
 * Tests for ColumnTransformRejection — ENT-015 evidence payload.
 * @module internal/importStatement/stage2/errors.spec
 *
 * Story 2.4, Task 2 — TDD failing-suite-first.
 *
 * Contracts tested:
 *   1. >30%-bad column apply → ColumnTransformRejection with exact errorCount/totalCount/threshold;
 *      cellErrors.length === errorCount; rowIndexes correct; each error is the per-cell Message.
 *   2. <30% → applied, per-cell issues flagged on cells (re-asserted existing behavior).
 *   3. Boundary pin (decision 2): two columns, one >30%-bad — bad apply throws with payload,
 *      bad column state stays UNKNOWN (definition null, data untouched); sibling column applies
 *      fine; stage2 alive (columns observable functional).
 *   4. Store-backing proof: hydrate with acceptableColumnErrorPercentage=0.05 (memory DAO) →
 *      ~10%-bad column REJECTED; resetEngineConfigForTests() → same column applies.
 *   5. instanceof LocalizableException explicitly asserted (the subclass guarantee the ported
 *      suites rely on).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { LocalizableException } from '../../utils/messages/exceptions';
import { NativeMessage } from '../../utils/messages/message';
import type { Message } from '../../utils/messages/message';
import { ColumnTransformRejection, UnmappedColumnsError } from './errors';
import { ImportStatementColumn } from './column';
import type { ImportStatementServiceInternal } from '../service';
import type { ImportStatementStage1 } from '../stage1';
import type { ImportStatementStage3 } from '../stage3/types';
import { ImportStatementStage2Impl } from './implementation';
import { SupportedDataType } from './types';
import type { CellData, ImportStatementStage2 } from './types';
import { ColumnDefinition } from '../types';
import type { DateColumnParams } from '../types';
import {
  hydrateEngineConfig,
  resetEngineConfigForTests,
} from '../../settings/engine-config';
import { SettingKeys, type UserSettingsDAO } from '../../settings/user-settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

function cell(
  value: unknown,
  type: SupportedDataType = SupportedDataType.TEXT,
): CellData {
  return { value, type } as CellData;
}

function createMockStage2(): Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>> {
  return {
    applyColumn: vi.fn(),
    resetColumn: vi.fn().mockResolvedValue(undefined),
  } as Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;
}

function makeCol(
  data: CellData[],
  mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>,
): ImportStatementColumn {
  const name = new NativeMessage('test-col');
  const col = new ImportStatementColumn('col-id', name, name, null, null, data);
  col.associateWith(mockStage2 as unknown as ImportStatementStage2);
  return col;
}

/** Lightweight in-memory DAO for store-backing tests — mirrors engine-config.spec pattern. */
function makeMemoryDao(initial: Record<string, unknown> = {}): UserSettingsDAO {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    getSetting: <T>(key: string) => Promise.resolve(store.get(key) as T | undefined),
    setSetting: <T>(key: string, value: T) => {
      store.set(key, value);
      return Promise.resolve();
    },
    removeSetting: (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return Promise.resolve(had);
    },
    getAllSettings: () => Promise.resolve(Object.fromEntries(store)),
  };
}

/** Custom date params using a fixed format. */
const DATE_PARAMS: DateColumnParams = { format: { custom: 'yyyy-MM-dd' } };

// ── Suite 1: ColumnTransformRejection class ───────────────────────────────────

describe('ColumnTransformRejection', () => {
  it('is instanceof LocalizableException (subclass guarantee)', () => {
    const err = new ColumnTransformRejection(4, 5, 0.3, [], "engine.importStatement.can't-parse-as-date");
    expect(err).toBeInstanceOf(LocalizableException);
    expect(err).toBeInstanceOf(ColumnTransformRejection);
    expect(err.name).toBe('ColumnTransformRejection');
  });

  it('carries exact errorCount, totalCount, threshold', () => {
    const err = new ColumnTransformRejection(4, 5, 0.3, [], "engine.importStatement.can't-parse-as-date");
    expect(err.errorCount).toBe(4);
    expect(err.totalCount).toBe(5);
    expect(err.threshold).toBe(0.3);
  });

  it('carries the provided cellErrors array immutably', () => {
    const errors: Array<{ rowIndex: number; error: Message }> = [
      { rowIndex: 0, error: new NativeMessage('err at 0') },
      { rowIndex: 2, error: new NativeMessage('err at 2') },
    ];
    const err = new ColumnTransformRejection(2, 5, 0.3, errors, "engine.importStatement.can't-parse-as-date");
    expect(err.cellErrors).toBe(errors);
    expect(err.cellErrors).toHaveLength(2);
    expect(err.cellErrors[0].rowIndex).toBe(0);
    expect(err.cellErrors[1].rowIndex).toBe(2);
  });
});

// ── Suite 2: >30%-bad column → ColumnTransformRejection ──────────────────────

describe('parseGeneric gate: >30% errors → ColumnTransformRejection', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    resetEngineConfigForTests();
    mockStage2 = createMockStage2();
  });

  afterEach(() => {
    resetEngineConfigForTests();
  });

  it('throws ColumnTransformRejection with exact errorCount/totalCount/threshold when >30% cells are bad', async () => {
    // 4 bad cells + 1 good cell = 80% errors > 30% threshold
    const data = [
      cell('bad1'),
      cell('bad2'),
      cell('bad3'),
      cell('bad4'),
      cell('2025-01-01'),
    ];
    const col = makeCol(data, mockStage2);

    let caught: unknown;
    try {
      await col.parseAsDate(DATE_PARAMS);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ColumnTransformRejection);
    const rejection = caught as ColumnTransformRejection;
    expect(rejection.errorCount).toBe(4);
    expect(rejection.totalCount).toBe(5);
    expect(rejection.threshold).toBe(0.3);
    // applyColumn must NOT have been called (throw before commit)
    expect(mockStage2.applyColumn).not.toHaveBeenCalled();
  });

  it('cellErrors.length === errorCount (FEAT-022: ALL collected, not just first)', async () => {
    const data = [
      cell('bad1'),
      cell('bad2'),
      cell('bad3'),
      cell('bad4'),
      cell('2025-01-01'),
    ];
    const col = makeCol(data, mockStage2);

    let caught: ColumnTransformRejection | undefined;
    try {
      await col.parseAsDate(DATE_PARAMS);
    } catch (e) {
      caught = e as ColumnTransformRejection;
    }

    expect(caught).toBeInstanceOf(ColumnTransformRejection);
    expect(caught!.cellErrors).toHaveLength(caught!.errorCount);
    expect(caught!.cellErrors).toHaveLength(4);
  });

  it('cellErrors rowIndexes are correct (0-based position in column data)', async () => {
    // bad cells at positions 0, 1, 2, 3; good cell at position 4
    const data = [
      cell('bad1'),
      cell('bad2'),
      cell('bad3'),
      cell('bad4'),
      cell('2025-01-01'),
    ];
    const col = makeCol(data, mockStage2);

    let caught: ColumnTransformRejection | undefined;
    try {
      await col.parseAsDate(DATE_PARAMS);
    } catch (e) {
      caught = e as ColumnTransformRejection;
    }

    expect(caught).toBeInstanceOf(ColumnTransformRejection);
    const rowIndexes = caught!.cellErrors.map((ce) => ce.rowIndex);
    expect(rowIndexes).toEqual([0, 1, 2, 3]);
  });

  it('each cellError.error is the per-cell Message (non-null)', async () => {
    const data = [
      cell('bad1'),
      cell('bad2'),
      cell('bad3'),
      cell('bad4'),
      cell('2025-01-01'),
    ];
    const col = makeCol(data, mockStage2);

    let caught: ColumnTransformRejection | undefined;
    try {
      await col.parseAsDate(DATE_PARAMS);
    } catch (e) {
      caught = e as ColumnTransformRejection;
    }

    expect(caught).toBeInstanceOf(ColumnTransformRejection);
    for (const ce of caught!.cellErrors) {
      expect(ce.error).toBeDefined();
      expect(typeof ce.error.getText()).toBe('string');
    }
  });

  it('is instanceof LocalizableException (subclass — existing toThrow pins stay green)', async () => {
    const data = [
      cell('bad1'),
      cell('bad2'),
      cell('bad3'),
      cell('bad4'),
      cell('2025-01-01'),
    ];
    const col = makeCol(data, mockStage2);

    await expect(col.parseAsDate(DATE_PARAMS)).rejects.toBeInstanceOf(LocalizableException);
    await expect(col.parseAsDate(DATE_PARAMS)).rejects.toBeInstanceOf(ColumnTransformRejection);
  });

  it('bad column definition stays null (UNKNOWN) after rejection — state not mutated', async () => {
    const data = [
      cell('bad1'),
      cell('bad2'),
      cell('bad3'),
      cell('bad4'),
      cell('2025-01-01'),
    ];
    const col = makeCol(data, mockStage2);

    // Record original state
    const originalDefinition = col.definition;
    const originalData = col.data;

    try {
      await col.parseAsDate(DATE_PARAMS);
    } catch {
      // expected
    }

    // Column state is unchanged — definition still null, data untouched
    expect(col.definition).toBeNull();
    expect(col.definition).toBe(originalDefinition);
    expect(col.data).toBe(originalData);
  });
});

// ── Suite 3: <30% errors → applied with per-cell issues flagged ───────────────

describe('parseGeneric gate: <30% errors → column applied, cells flagged', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    resetEngineConfigForTests();
    mockStage2 = createMockStage2();
  });

  afterEach(() => {
    resetEngineConfigForTests();
  });

  it('applies the column when error rate is below threshold (1/5 = 20% < 30%)', async () => {
    const data = [
      cell('2025-01-01'),
      cell('2025-01-02'),
      cell('2025-01-03'),
      cell('2025-01-04'),
      cell('bad-date'),   // 1 error
    ];
    const col = makeCol(data, mockStage2);

    await expect(col.parseAsDate(DATE_PARAMS)).resolves.toBeUndefined();
    expect(mockStage2.applyColumn).toHaveBeenCalledOnce();
  });

  it('per-cell errors are flagged on the bad cells (error field set)', async () => {
    const data = [
      cell('2025-01-01'),
      cell('bad-date'),  // 1 error at index 1
      cell('2025-01-03'),
      cell('2025-01-04'),
      cell('2025-01-05'),
    ];
    const col = makeCol(data, mockStage2);

    await col.parseAsDate(DATE_PARAMS);

    const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ImportStatementColumn;
    expect(applied).toBeDefined();
    expect(applied.data[0].error).toBeUndefined(); // good cell
    expect(applied.data[1].error).toBeDefined();   // bad cell has error message
    expect(applied.data[2].error).toBeUndefined(); // good cell
    expect(applied.data[3].error).toBeUndefined(); // good cell
    expect(applied.data[4].error).toBeUndefined(); // good cell
  });
});

// ── Suite 4: Boundary pin (decision 2) ───────────────────────────────────────

describe('boundary pin: one >30%-bad column rejected, sibling applies, stage2 alive', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    resetEngineConfigForTests();
    mockStage2 = createMockStage2();
  });

  afterEach(() => {
    resetEngineConfigForTests();
  });

  it('per-column event: bad column throws with payload; sibling column applies; both share alive stage2', async () => {
    // Bad column: 4/5 = 80% errors > 30% threshold
    const badData = [
      cell('bad1'),
      cell('bad2'),
      cell('bad3'),
      cell('bad4'),
      cell('2025-01-01'),
    ];
    // Good column: 1/5 = 20% errors < 30% threshold
    const goodData = [
      cell('2025-01-01'),
      cell('2025-01-02'),
      cell('2025-01-03'),
      cell('2025-01-04'),
      cell('bad-sibling'),
    ];

    const name = new NativeMessage('col');
    const badCol = new ImportStatementColumn('bad-col', name, name, null, null, badData);
    const goodCol = new ImportStatementColumn('good-col', name, name, null, null, goodData);

    // Both columns share the same stage2 mock (simulates the real session)
    badCol.associateWith(mockStage2 as unknown as ImportStatementStage2);
    goodCol.associateWith(mockStage2 as unknown as ImportStatementStage2);

    // Bad column apply → throws ColumnTransformRejection with payload
    let caught: unknown;
    try {
      await badCol.parseAsDate(DATE_PARAMS);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ColumnTransformRejection);
    const rejection = caught as ColumnTransformRejection;
    expect(rejection.errorCount).toBe(4);
    expect(rejection.totalCount).toBe(5);
    expect(rejection.cellErrors).toHaveLength(4);

    // Bad column state stays UNKNOWN — definition null, data untouched
    expect(badCol.definition).toBeNull();
    expect(badCol.data).toBe(badData);

    // stage2.applyColumn was NOT called for the bad column
    expect(mockStage2.applyColumn).not.toHaveBeenCalled();

    // Sibling column applies fine — stage2 is still alive
    await expect(goodCol.parseAsDate(DATE_PARAMS)).resolves.toBeUndefined();
    expect(mockStage2.applyColumn).toHaveBeenCalledOnce();
    const appliedGood = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as ImportStatementColumn;
    expect(appliedGood.id).toBe('good-col');
    expect(appliedGood.definition).toBe(ColumnDefinition.DATE);
  });
});

// ── Suite 5: Store-backing proof ──────────────────────────────────────────────

describe('store-backing proof: threshold from config, not constant', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    resetEngineConfigForTests();
    mockStage2 = createMockStage2();
  });

  afterEach(() => {
    // Always restore pristine defaults so other suites are not affected
    resetEngineConfigForTests();
  });

  it('a ~10%-bad column is REJECTED after hydrating acceptableColumnErrorPercentage=0.05', async () => {
    // Hydrate with a strict threshold (5%)
    const dao = makeMemoryDao({
      [SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE]: 0.05,
    });
    await hydrateEngineConfig(dao);

    // 1/10 = 10% errors → now above the 5% threshold → REJECTED
    const data = [
      cell('bad1'),             // index 0 — error
      cell('2025-01-01'),
      cell('2025-01-02'),
      cell('2025-01-03'),
      cell('2025-01-04'),
      cell('2025-01-05'),
      cell('2025-01-06'),
      cell('2025-01-07'),
      cell('2025-01-08'),
      cell('2025-01-09'),
    ];
    const col = makeCol(data, mockStage2);

    let caught: unknown;
    try {
      await col.parseAsDate(DATE_PARAMS);
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ColumnTransformRejection);
    const rejection = caught as ColumnTransformRejection;
    expect(rejection.errorCount).toBe(1);
    expect(rejection.totalCount).toBe(10);
    expect(rejection.threshold).toBe(0.05);
    expect(mockStage2.applyColumn).not.toHaveBeenCalled();
  });

  it('same ~10%-bad column APPLIES after resetEngineConfigForTests() restores 30% default', async () => {
    // Ensure we are back to defaults (30%) — called via afterEach reset and explicit here
    resetEngineConfigForTests();

    // 1/10 = 10% errors → below the default 30% threshold → APPLIED
    const data = [
      cell('bad1'),             // index 0 — error
      cell('2025-01-01'),
      cell('2025-01-02'),
      cell('2025-01-03'),
      cell('2025-01-04'),
      cell('2025-01-05'),
      cell('2025-01-06'),
      cell('2025-01-07'),
      cell('2025-01-08'),
      cell('2025-01-09'),
    ];
    const col = makeCol(data, mockStage2);

    await expect(col.parseAsDate(DATE_PARAMS)).resolves.toBeUndefined();
    expect(mockStage2.applyColumn).toHaveBeenCalledOnce();
  });

  it('store-backed threshold cycle: hydrate(0.05) → rejected; reset → applied (single test, two asserts)', async () => {
    // ── Phase 1: hydrate with strict threshold ─────────────────────────────────
    const dao = makeMemoryDao({
      [SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE]: 0.05,
    });
    await hydrateEngineConfig(dao);

    const data = [
      cell('bad1'),
      cell('2025-01-01'),
      cell('2025-01-02'),
      cell('2025-01-03'),
      cell('2025-01-04'),
      cell('2025-01-05'),
      cell('2025-01-06'),
      cell('2025-01-07'),
      cell('2025-01-08'),
      cell('2025-01-09'),
    ];

    const col1 = makeCol(data, mockStage2);
    await expect(col1.parseAsDate(DATE_PARAMS)).rejects.toBeInstanceOf(ColumnTransformRejection);

    // ── Phase 2: reset → default threshold → applied ───────────────────────────
    resetEngineConfigForTests();
    mockStage2.applyColumn.mockClear();

    const col2 = makeCol(data, mockStage2);
    await expect(col2.parseAsDate(DATE_PARAMS)).resolves.toBeUndefined();
    expect(mockStage2.applyColumn).toHaveBeenCalledOnce();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Story 2.4 Task 3 — UnmappedColumnsError + getUnmappedColumns (Q-009 stop)
// ─────────────────────────────────────────────────────────────────────────────

// ── Stage2 test helpers ───────────────────────────────────────────────────────

function createMock<T>(overrides: Partial<T> = {}): Mocked<T> {
  return overrides as Mocked<T>;
}

function makeStage2(
  columns: ImportStatementColumn[]
): ImportStatementStage2Impl {
  const mockStage1 = createMock<ImportStatementStage1>({});
  const mockStage3 = createMock<ImportStatementStage3>({});
  const mockSvc = createMock<Pick<ImportStatementServiceInternal, 'startWith' | 'stage2' | 'stage3'>>({
    stage3: vi.fn().mockResolvedValue(mockStage3),
  });
  return new ImportStatementStage2Impl(
    mockStage1,
    mockSvc as unknown as ImportStatementServiceInternal,
    columns
  );
}

function makeUnmappedCol(id: string, name: string): ImportStatementColumn {
  const msg = new NativeMessage(name);
  return new ImportStatementColumn(id, msg, msg, null, null, [cell('v')]);
}

// ── Suite 6: UnmappedColumnsError class ──────────────────────────────────────

describe('UnmappedColumnsError', () => {
  it('is instanceof LocalizableException and instanceof UnmappedColumnsError', () => {
    const err = new UnmappedColumnsError([{ id: 'col1', name: 'Column 1' }]);
    expect(err).toBeInstanceOf(LocalizableException);
    expect(err).toBeInstanceOf(UnmappedColumnsError);
    expect(err.name).toBe('UnmappedColumnsError');
  });

  it('carries the unmappedColumns list exactly', () => {
    const list = [
      { id: 'col-a', name: 'Date' },
      { id: 'col-b', name: 'Amount' },
    ];
    const err = new UnmappedColumnsError(list);
    expect(err.unmappedColumns).toBe(list);
    expect(err.unmappedColumns).toHaveLength(2);
    expect(err.unmappedColumns[0]).toEqual({ id: 'col-a', name: 'Date' });
    expect(err.unmappedColumns[1]).toEqual({ id: 'col-b', name: 'Amount' });
  });

  it('message is localizable (getLocalizableMessage().getText() returns the catalog key)', () => {
    const err = new UnmappedColumnsError([{ id: 'x', name: 'X' }]);
    // $t-created messages return their key from getText() in the test environment
    const locMsg = err.getLocalizableMessage();
    expect(typeof locMsg.getText()).toBe('string');
    expect(locMsg.getText()).toContain('engine.importStatement.unmapped-columns-stop');
  });
});

// ── Suite 7: getUnmappedColumns() + next() with 2 unmapped columns ───────────

describe('getUnmappedColumns: stage2 with 2 unmapped columns', () => {
  it('returns both {id, name} for unmapped columns', () => {
    const colA = makeUnmappedCol('col-a', 'Date');
    const colB = makeUnmappedCol('col-b', 'Amount');
    const stage2 = makeStage2([colA, colB]);

    const list = stage2.getUnmappedColumns();
    expect(list).toHaveLength(2);
    expect(list[0]).toEqual({ id: 'col-a', name: 'Date' });
    expect(list[1]).toEqual({ id: 'col-b', name: 'Amount' });
  });

  it('next() throws UnmappedColumnsError when columns are unmapped', async () => {
    const colA = makeUnmappedCol('col-a', 'Date');
    const colB = makeUnmappedCol('col-b', 'Amount');
    const stage2 = makeStage2([colA, colB]);

    await expect(stage2.next()).rejects.toBeInstanceOf(UnmappedColumnsError);
    await expect(stage2.next()).rejects.toBeInstanceOf(LocalizableException);
  });

  it('error.unmappedColumns deep-equals getUnmappedColumns() list', async () => {
    const colA = makeUnmappedCol('col-a', 'Date');
    const colB = makeUnmappedCol('col-b', 'Amount');
    const stage2 = makeStage2([colA, colB]);

    const getterList = stage2.getUnmappedColumns();
    let caughtError: UnmappedColumnsError | undefined;
    try {
      await stage2.next();
    } catch (e) {
      caughtError = e as UnmappedColumnsError;
    }

    expect(caughtError).toBeInstanceOf(UnmappedColumnsError);
    expect(caughtError!.unmappedColumns).toEqual(getterList);
    expect(caughtError!.unmappedColumns).toHaveLength(2);
  });
});

// ── Suite 8: ⟺ pin (decision 3) — both directions ────────────────────────────

describe('⟺ pin (decision 3): getUnmappedColumns().length === 0 ⟺ next() does not throw', () => {
  it('direction A — all columns mapped: getter empty AND next() resolves', async () => {
    // Dynamically import ColumnDefinition for the mapped column helper
    const { ColumnDefinition } = await import('../types');
    const msg = (n: string) => new NativeMessage(n);
    const colDate = new ImportStatementColumn('col-date', msg('Date'), msg('Date'), ColumnDefinition.DATE, null, [cell('v')]);
    const colAmt = new ImportStatementColumn('col-amt', msg('Amount'), msg('Amount'), ColumnDefinition.AMOUNT, null, [cell('v')]);

    const stage2 = makeStage2([colDate, colAmt]);

    // getter must be empty
    expect(stage2.getUnmappedColumns()).toHaveLength(0);

    // next() must resolve (stage3 stub)
    await expect(stage2.next()).resolves.toBeDefined();
  });

  it('direction B — one unmapped: getter non-empty AND next() rejects with UnmappedColumnsError', async () => {
    const { ColumnDefinition } = await import('../types');
    const msg = (n: string) => new NativeMessage(n);
    const colDate = new ImportStatementColumn('col-date', msg('Date'), msg('Date'), ColumnDefinition.DATE, null, [cell('v')]);
    const colUnmapped = new ImportStatementColumn('col-u', msg('Notes'), msg('Notes'), null, null, [cell('v')]);

    const stage2 = makeStage2([colDate, colUnmapped]);

    // getter non-empty
    const list = stage2.getUnmappedColumns();
    expect(list.length).toBeGreaterThan(0);
    expect(list[0]).toEqual({ id: 'col-u', name: 'Notes' });

    // next() rejects with UnmappedColumnsError
    await expect(stage2.next()).rejects.toBeInstanceOf(UnmappedColumnsError);
  });
});

// ── Suite 9: Mixed — 3 columns, 1 unmapped → list has exactly that one ───────

describe('getUnmappedColumns: mixed — 3 columns, 1 unmapped', () => {
  it('returns exactly the one unmapped column', async () => {
    const { ColumnDefinition } = await import('../types');
    const msg = (n: string) => new NativeMessage(n);
    const colDate = new ImportStatementColumn('c1', msg('Date'), msg('Date'), ColumnDefinition.DATE, null, [cell('v')]);
    const colAmt = new ImportStatementColumn('c2', msg('Amount'), msg('Amount'), ColumnDefinition.AMOUNT, null, [cell('v')]);
    const colNotes = new ImportStatementColumn('c3', msg('Notes'), msg('Notes'), null, null, [cell('v')]);

    const stage2 = makeStage2([colDate, colAmt, colNotes]);

    const list = stage2.getUnmappedColumns();
    expect(list).toHaveLength(1);
    expect(list[0]).toEqual({ id: 'c3', name: 'Notes' });
  });
});
