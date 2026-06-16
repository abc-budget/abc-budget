/**
 * Row-generator spec — PORT+REBUILD per FEAT-022.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/row-generator.spec.ts` (423 lines).
 *
 * Adaptations (diff-audit):
 *   1. Jest → Vitest (`describe`, `it`, `expect`, `vi`, `beforeEach`, `afterEach`
 *      from 'vitest').
 *   2. `createMock<T>` helper removed — not needed; mock objects built inline.
 *   3. `UserSettingsService` + `CurrencyCache` parameters removed — `generateRows`
 *      accepts plain `baseCurrency: string`.
 *   4. `generateStage3Rows` → `generateRows`.
 *   5. `CurrencyData` / `UserSettingsService` imports removed.
 *   6. Import path: `./row-generator` (internal relative).
 *   7. verbatimModuleSyntax: `import type` for interfaces.
 *
 * SUPERSEDED ASSERTIONS (FEAT-022 collect-don't-throw):
 *   The following prior-art tests asserted that `generateStage3Rows` THROWS on bad rows.
 *   They are SUPERSEDED by the collect contract — the new behaviour is tested explicitly
 *   in the "FEAT-022" describe block below.  Each superseded test is listed here:
 *
 *   S1. "should throw an error if no DATE column is found"
 *       → Prior: `rejects.toBeInstanceOf(LocalizableException)`
 *       → 2.3:   row with no-DATE → `rowErrors` entry; `rows` empty; generation continues.
 *       → 2.7 (decision 2, DECLARED CHANGE): no-DATE is a STRUCTURAL condition of the
 *         column mapping, not a per-row condition — detected BEFORE the row loop;
 *         ONE `structuralErrors` message, ZERO row-error echoes.
 *
 *   S2. "should throw an error if multiple DATE columns are found"
 *       → Prior: `rejects.toBeInstanceOf(LocalizableException)`
 *       → 2.3:   row with multi-DATE → `rowErrors` entry; `rows` empty; generation continues.
 *       → 2.7 (decision 2, DECLARED CHANGE): same migration as S1 — ONE structural
 *         message, distinct key from the no-DATE one.
 *
 *   S3. Implicit throw-on-income (no explicit prior-art test — but the income-type
 *       single-amount-column path threw `income-only-column`).
 *       → Now:   income rows → `skipped` entry (VIS-011), NOT `rowErrors`.
 *
 * PRESERVED ASSERTIONS:
 *   All other prior-art assertions are preserved verbatim (field mapping, date/amount
 *   propagation, rowIndex sync, description join, account join, first-wins for
 *   bankCategory/mcc, default-nulls for optional fields).
 *
 * NEW TESTS (FEAT-022 + ENT-006 + no-TIME + determinism):
 *   N1. Bad row collected, rest generated (5-row input, 1 broken → 4 rows + 1 rowError).
 *   N2. Income rows → skipped entries (VIS-011 semantics end-to-end).
 *   N3. Counterparty distinct from description in output.
 *   N4. No `time` field in generated rows (stringify check).
 *   N5. Determinism (same input twice → deep-equal output).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ColumnInfo } from './row-generator';
import { generateRows } from './row-generator';
import type { ImportStatementRowData, CellData } from '../stage2/types';
import { SupportedDataType } from '../stage2/types';
import { ColumnDefinition } from '../types';
import type { AmountColumnParams, BankCommissionColumnParams, CashbackColumnParams } from '../types';
import { $t } from '../../utils/messages/index';

// ---------------------------------------------------------------------------
// Hash mock — avoid WebCrypto in unit tests
// discriminator-aware so pseudo-op hash pins work
// ---------------------------------------------------------------------------

vi.mock('./hash', () => ({
  calculateRowHash: vi.fn().mockImplementation(
    async (_row: unknown, _cols: unknown, discriminator: string = 'main') =>
      `dummy-hash-${discriminator}`,
  ),
  generateHashableObject: vi.fn().mockReturnValue({}),
  // 3.2: identity passthrough — this unit tests generateRows STRUCTURE with hash
  // stubbed; the dup-counter's real wrap→re-SHA behavior is covered with the REAL
  // hash in dup-counter.spec.ts, so here it must not alter the stubbed hashes.
  applyDupCounters: vi.fn().mockImplementation(async (hs: string[]) => hs),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockCellData(
  value: unknown,
  type: SupportedDataType = SupportedDataType.TEXT,
  opts?: { ignore?: ReturnType<typeof $t> | null; error?: ReturnType<typeof $t> | null }
): CellData {
  return {
    value,
    type,
    error: opts?.error ?? null,
    ignore: opts?.ignore ?? null,
  };
}

function createMockRow(
  rowIndex: number,
  cellData: Record<string, unknown> = {},
  ignoreColumns: Record<string, ReturnType<typeof $t>> = {},
  errorColumns: Record<string, ReturnType<typeof $t>> = {},
): ImportStatementRowData {
  return {
    rowIndex,
    get: vi.fn((columnId: string): CellData => {
      const value = cellData[columnId] ?? null;
      let type: SupportedDataType = SupportedDataType.UNKNOWN;
      if (typeof value === 'number') {
        type = SupportedDataType.NUMBER;
      } else if (typeof value === 'string') {
        type = SupportedDataType.TEXT;
      } else if (value instanceof Date) {
        type = SupportedDataType.DATE;
      }
      return createMockCellData(
        value,
        type,
        {
          ignore: ignoreColumns[columnId] ?? null,
          error: errorColumns[columnId] ?? null,
        }
      );
    }),
    errorMessageAt: vi.fn().mockReturnValue(null),
    ignoreMessageAt: vi.fn().mockReturnValue(null),
    get isIgnored() { return Object.keys(ignoreColumns).length > 0; },
    get hasErrors() { return Object.keys(errorColumns).length > 0; },
  } as ImportStatementRowData;
}

function createColumn(
  id: string,
  definition: ColumnDefinition,
  params: AmountColumnParams | null = null
): ColumnInfo {
  return { id, definition, params };
}

const BASE_CURRENCY = 'USD';

// ---------------------------------------------------------------------------
// PRESERVED assertions from prior art (ported)
// ---------------------------------------------------------------------------

describe('ImportStatementStage3 Row Generator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should generate stage3 rows from valid stage2 rows', async () => {
    const date = new Date('2023-01-15');
    const rows = [
      createMockRow(0, { col1: date, col2: 100.5, col3: 'USD', col4: 'Coffee shop' }),
      createMockRow(1, { col1: date, col2: 200.75, col3: 'USD', col4: 'Restaurant' }),
    ];

    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.DESCRIPTION),
    ];

    const result = await generateRows(rows, columns, BASE_CURRENCY);

    expect(result.rows.length).toBe(2);
    expect(result.rowErrors).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);

    expect(result.rows[0].rowIndex).toBe(0);
    expect(result.rows[0].date).toEqual(date);
    expect(result.rows[0].amount).toBe(100.5);
    expect(result.rows[0].currency).toBe('USD');
    expect(result.rows[0].description).toBe('Coffee shop');
    expect(result.rows[0].account).toBeNull();
    expect(result.rows[0].bankCategory).toBeNull();
    expect(result.rows[0].mcc).toBeNull();
    expect(result.rows[0].isBankCommission).toBe(false);
    expect(result.rows[0].isCashback).toBe(false);
    expect(result.rows[0].category).toBeNull();
    expect(result.rows[0].isManuallySetCategory).toBe(false);

    expect(result.rows[1].rowIndex).toBe(1);
    expect(result.rows[1].amount).toBe(200.75);
    expect(result.rows[1].description).toBe('Restaurant');
  });

  it('should handle multiple description columns by joining them', async () => {
    const date = new Date('2023-01-15');
    const rows = [
      createMockRow(0, { col1: date, col2: 100.5, col3: 'USD', col4: 'Coffee', col5: 'shop' }),
    ];

    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.DESCRIPTION),
      createColumn('col5', ColumnDefinition.DESCRIPTION),
    ];

    const result = await generateRows(rows, columns, BASE_CURRENCY);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].description).toBe('Coffee shop');
  });

  it('should handle multiple account columns by joining them', async () => {
    const date = new Date('2023-01-15');
    const rows = [
      createMockRow(0, { col1: date, col2: 100.5, col3: 'USD', col4: 'Checking', col5: '12345' }),
    ];

    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.BANK_ACCOUNT),
      createColumn('col5', ColumnDefinition.BANK_ACCOUNT),
    ];

    const result = await generateRows(rows, columns, BASE_CURRENCY);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].account).toBe('Checking 12345');
  });

  it('should use the first bank category if multiple are found', async () => {
    const date = new Date('2023-01-15');
    const rows = [
      createMockRow(0, { col1: date, col2: 100.5, col3: 'USD', col4: 'Food', col5: 'Dining' }),
    ];

    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.CATEGORY),
      createColumn('col5', ColumnDefinition.CATEGORY),
    ];

    const result = await generateRows(rows, columns, BASE_CURRENCY);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].bankCategory).toBe('Food');
  });

  it('should use the first MCC if multiple are found', async () => {
    const date = new Date('2023-01-15');
    const rows = [
      createMockRow(0, { col1: date, col2: 100.5, col3: 'USD', col4: 5812, col5: 5813 }),
    ];

    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.MERCHANT_CATEGORY),
      createColumn('col5', ColumnDefinition.MERCHANT_CATEGORY),
    ];

    const result = await generateRows(rows, columns, BASE_CURRENCY);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].mcc).toBe(5812);
  });

  it('should set default values for optional fields', async () => {
    const date = new Date('2023-01-15');
    const rows = [createMockRow(0, { col1: date, col2: 100.5 })];

    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
    ];

    const result = await generateRows(rows, columns, BASE_CURRENCY);

    expect(result.rows.length).toBe(1);
    expect(result.rows[0].description).toBeNull();
    expect(result.rows[0].account).toBeNull();
    expect(result.rows[0].bankCategory).toBeNull();
    expect(result.rows[0].mcc).toBeNull();
    expect(result.rows[0].isBankCommission).toBe(false);
    expect(result.rows[0].isCashback).toBe(false);
    expect(result.rows[0].category).toBeNull();
    expect(result.rows[0].isManuallySetCategory).toBe(false);
  });

  it('should ensure rowIndex equals array index regardless of input rowIndex', async () => {
    const date = new Date('2023-01-15');
    const rows = [
      createMockRow(10, { col1: date, col2: 100.5, col3: 'USD', col4: 'Coffee shop' }),
      createMockRow(5, { col1: date, col2: 200.75, col3: 'USD', col4: 'Restaurant' }),
      createMockRow(20, { col1: date, col2: 300.25, col3: 'USD', col4: 'Grocery store' }),
    ];

    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.DESCRIPTION),
    ];

    const result = await generateRows(rows, columns, BASE_CURRENCY);

    expect(result.rows.length).toBe(3);
    for (let i = 0; i < result.rows.length; i++) {
      expect(result.rows[i].rowIndex).toBe(i);
    }
    expect(result.rows[0].amount).toBe(100.5);
    expect(result.rows[0].description).toBe('Coffee shop');
    expect(result.rows[1].amount).toBe(200.75);
    expect(result.rows[1].description).toBe('Restaurant');
    expect(result.rows[2].amount).toBe(300.25);
    expect(result.rows[2].description).toBe('Grocery store');
  });

  // ---------------------------------------------------------------------------
  // FEAT-022: collect-don't-throw (SUPERSEDE S1, S2 from prior art)
  // ---------------------------------------------------------------------------

  describe('FEAT-022: collect-don\'t-throw contract', () => {
    // S1: no-DATE-column → STRUCTURAL message, NOT per-row errors.
    // DECLARED CHANGE (2.7 decision 2): was a rowErrors entry per row (the 2.3
    // collect-don't-throw honest behavior) — a missing DATE mapping is a property
    // of the COLUMN SET, so it now reports ONCE via structuralErrors.
    it('S1 (migrated, decision 2): no DATE column → ONE structuralErrors message, zero rowErrors', async () => {
      const rows = [
        createMockRow(0, { col2: 100.5, col3: 'USD', col4: 'Coffee shop' }),
      ];

      const columns = [
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
        createColumn('col4', ColumnDefinition.DESCRIPTION),
      ];

      // Must NOT throw
      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(0);
      expect(result.rowErrors).toHaveLength(0); // PIN (b): zero row-error echoes
      expect(result.skipped).toHaveLength(0);
      expect(result.structuralErrors).toHaveLength(1);
      expect(result.structuralErrors[0].getText()).toBe(
        'engine.importStatement.stage3.structural-no-date-column',
      );
    });

    // S2: multiple-DATE-columns → STRUCTURAL message, NOT per-row errors.
    // DECLARED CHANGE (2.7 decision 2): same migration as S1 — distinct key.
    it('S2 (migrated, decision 2): multiple DATE columns → ONE structuralErrors message, zero rowErrors', async () => {
      const date = new Date('2023-01-15');
      const rows = [
        createMockRow(0, { col1: date, col1b: date, col2: 100.5, col3: 'USD' }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col1b', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(0);
      expect(result.rowErrors).toHaveLength(0); // PIN (b): zero row-error echoes
      expect(result.skipped).toHaveLength(0);
      expect(result.structuralErrors).toHaveLength(1);
      expect(result.structuralErrors[0].getText()).toBe(
        'engine.importStatement.stage3.structural-multiple-date-columns',
      );
    });

    // N1 NEW: bad row collected, rest generated (5-row input, 1 broken → 4 rows + 1 rowError)
    //
    // Strategy: row 2 is a custom mock whose .get() always throws — simulating a corrupted
    // row that fails during cell access.  The collect contract must catch it and continue.
    it('N1: 5-row input with 1 broken row → 4 generated rows + 1 rowError', async () => {
      const date = new Date('2023-01-15');

      // Row 2: throws on any .get() call — simulates a corrupted/unreadable row
      const throwingRow2: ImportStatementRowData = {
        rowIndex: 2,
        get: vi.fn((_columnId: string): CellData => {
          throw new Error('Simulated cell access failure for row 2');
        }),
        errorMessageAt: vi.fn().mockReturnValue(null),
        ignoreMessageAt: vi.fn().mockReturnValue(null),
        get isIgnored() { return false; },
        get hasErrors() { return false; },
      };

      const rows5 = [
        createMockRow(0, { col1: date, col2: 10.0, col3: 'USD', col4: 'Row A' }),
        createMockRow(1, { col1: date, col2: 20.0, col3: 'USD', col4: 'Row B' }),
        throwingRow2,
        createMockRow(3, { col1: date, col2: 40.0, col3: 'USD', col4: 'Row D' }),
        createMockRow(4, { col1: date, col2: 50.0, col3: 'USD', col4: 'Row E' }),
      ];

      const columns5 = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
        createColumn('col4', ColumnDefinition.DESCRIPTION),
      ];

      const result = await generateRows(rows5, columns5, BASE_CURRENCY);

      // 4 good rows generated, 1 rowError collected, 0 skipped
      expect(result.rows).toHaveLength(4);
      expect(result.rowErrors).toHaveLength(1);
      expect(result.rowErrors[0].rowIndex).toBe(2);
      expect(result.rowErrors[0].errors).toHaveLength(1);
      expect(result.skipped).toHaveLength(0);

      // Good rows contain the expected descriptions
      const descriptions = result.rows.map((r) => r.description);
      expect(descriptions).toContain('Row A');
      expect(descriptions).toContain('Row B');
      expect(descriptions).toContain('Row D');
      expect(descriptions).toContain('Row E');
    });
  });

  // ---------------------------------------------------------------------------
  // Decision 2 (2.7): structural DATE errors — the structural channel
  // ---------------------------------------------------------------------------

  describe('decision 2 (2.7): structural DATE errors', () => {
    // PIN (a) TAXONOMY BOUNDARY: no-DATE and multiple-DATE are DISTINCT messages
    it('PIN (a): no-DATE and multiple-DATE produce DISTINCT structural message keys', async () => {
      const date = new Date('2023-01-15');

      const noDateResult = await generateRows(
        [createMockRow(0, { col2: 100.5 })],
        [createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams)],
        BASE_CURRENCY,
      );
      const multiDateResult = await generateRows(
        [createMockRow(0, { col1: date, col1b: date, col2: 100.5 })],
        [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col1b', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
        ],
        BASE_CURRENCY,
      );

      expect(noDateResult.structuralErrors).toHaveLength(1);
      expect(multiDateResult.structuralErrors).toHaveLength(1);
      const noDateKey = noDateResult.structuralErrors[0].getText();
      const multiDateKey = multiDateResult.structuralErrors[0].getText();
      expect(noDateKey).toBe('engine.importStatement.stage3.structural-no-date-column');
      expect(multiDateKey).toBe('engine.importStatement.stage3.structural-multiple-date-columns');
      expect(noDateKey).not.toBe(multiDateKey); // distinct ДІЯ hints: map one vs unmap one
    });

    it('happy path carries an EMPTY structuralErrors array (the channel is always present)', async () => {
      const date = new Date('2023-01-15');
      const result = await generateRows(
        [createMockRow(0, { col1: date, col2: 100.5, col3: 'USD' })],
        [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
          createColumn('col3', ColumnDefinition.CURRENCY),
        ],
        BASE_CURRENCY,
      );
      expect(result.rows).toHaveLength(1);
      expect(result.structuralErrors).toEqual([]);
    });

    // PIN: pseudo-ops do NOT spawn on structural failure — there are no reliable
    // dates to donate (the DATE mapping itself is broken).
    it('PIN: structural failure spawns ZERO pseudo-ops (commission + cashback cells present)', async () => {
      const rows = [
        createMockRow(0, { col2: 100.5, colComm: 5.0, colCb: 1.0 }),
        createMockRow(1, { col2: 200.0, colComm: 7.0, colCb: 2.0 }),
      ];
      const columns = [
        // NO DATE column mapped — structural failure
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
        { id: 'colComm', definition: ColumnDefinition.BANK_COMMISSION, params: { currency: 'use_base' } } as ColumnInfo,
        { id: 'colCb', definition: ColumnDefinition.CASHBACK, params: { currency: 'use_base' } } as ColumnInfo,
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.structuralErrors).toHaveLength(1);
      expect(result.rows).toHaveLength(0); // no mains AND no pseudo-ops
      expect(result.rowErrors).toHaveLength(0);
      expect(result.skipped).toHaveLength(0);
    });

    it('multi-row input still reports exactly ONE structural message (not one per row)', async () => {
      const rows = Array.from({ length: 12 }, (_, i) => createMockRow(i, { col2: 10 * (i + 1) }));
      const columns = [
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
      ];
      const result = await generateRows(rows, columns, BASE_CURRENCY);
      expect(result.structuralErrors).toHaveLength(1);
      expect(result.rowErrors).toHaveLength(0);
      expect(result.rows).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // N2: Income rows → skipped entries (VIS-011 semantics end-to-end)
  // ---------------------------------------------------------------------------

  describe('VIS-011: income rows → skipped (not errored)', () => {
    it('N2a: AMOUNT cell with ignore message → skipped entry with reason', async () => {
      const date = new Date('2023-05-01');
      const ignoreMsg = $t('engine.importStatement.income-value-ignored', { value: 50.0 });

      const rows = [
        createMockRow(
          0,
          { col1: date, col2: 50.0 },
          { col2: ignoreMsg }, // col2 has ignore message → income row
        ),
        createMockRow(1, { col1: date, col2: 100.0 }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(1);          // row 1 generated
      expect(result.skipped).toHaveLength(1);        // row 0 skipped
      expect(result.rowErrors).toHaveLength(0);      // no errors

      expect(result.skipped[0].rowIndex).toBe(0);
      // reason is the ignore message — must be non-null
      expect(result.skipped[0].reason).toBeTruthy();
    });

    it('N2b: multiple income rows → multiple skipped entries', async () => {
      const date = new Date('2023-05-01');
      const ignoreMsg = $t('engine.importStatement.positive-value-ignored', { value: 25.0 });

      const rows = [
        createMockRow(0, { col1: date, col2: 25.0 }, { col2: ignoreMsg }),
        createMockRow(1, { col1: date, col2: 75.0 }),
        createMockRow(2, { col1: date, col2: 30.0 }, { col2: ignoreMsg }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(1);
      expect(result.skipped).toHaveLength(2);
      expect(result.rowErrors).toHaveLength(0);

      expect(result.skipped[0].rowIndex).toBe(0);
      expect(result.skipped[1].rowIndex).toBe(2);
    });

    it('N2c: skipped entries are DISTINCT from rowErrors', async () => {
      const date = new Date('2023-05-01');
      const ignoreMsg = $t('engine.importStatement.income-value-ignored', { value: 10.0 });

      // Row 0: income → skipped
      // Row 1: no DATE col in data → but DATE col IS in columns[], so extractDate returns null
      //        — this doesn't throw. Use throwing mock for rowError.
      const throwingRow: ImportStatementRowData = {
        rowIndex: 1,
        get: vi.fn((_columnId: string): CellData => {
          throw new Error('Simulated error');
        }),
        errorMessageAt: vi.fn().mockReturnValue(null),
        ignoreMessageAt: vi.fn().mockReturnValue(null),
        get isIgnored() { return false; },
        get hasErrors() { return false; },
      };

      const rows = [
        createMockRow(0, { col1: date, col2: 10.0 }, { col2: ignoreMsg }),
        throwingRow,
        createMockRow(2, { col1: date, col2: 50.0 }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(1);          // row 2 generated
      expect(result.skipped).toHaveLength(1);        // row 0 skipped (income)
      expect(result.rowErrors).toHaveLength(1);      // row 1 error

      expect(result.skipped[0].rowIndex).toBe(0);
      expect(result.rowErrors[0].rowIndex).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // N3: COUNTERPARTY field is distinct from description (ENT-006)
  // ---------------------------------------------------------------------------

  describe('ENT-006: counterparty distinct from description', () => {
    it('N3a: counterparty populated when COUNTERPARTY column mapped', async () => {
      const date = new Date('2023-03-10');
      const rows = [
        createMockRow(0, {
          col1: date,
          col2: 42.0,
          col3: 'USD',
          col4: 'Payment note',
          col5: 'ACME Corp',
        }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
        createColumn('col4', ColumnDefinition.DESCRIPTION),
        createColumn('col5', ColumnDefinition.COUNTERPARTY),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].description).toBe('Payment note');
      expect(result.rows[0].counterparty).toBe('ACME Corp');
      // Distinct — different values
      expect(result.rows[0].counterparty).not.toBe(result.rows[0].description);
    });

    it('N3b: counterparty is null when no COUNTERPARTY column mapped', async () => {
      const date = new Date('2023-03-10');
      const rows = [
        createMockRow(0, { col1: date, col2: 42.0, col3: 'USD', col4: 'Payment note' }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
        createColumn('col4', ColumnDefinition.DESCRIPTION),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].counterparty).toBeNull();
      expect(result.rows[0].description).toBe('Payment note');
    });

    it('N3c: multiple COUNTERPARTY columns → joined by space', async () => {
      const date = new Date('2023-03-10');
      const rows = [
        createMockRow(0, {
          col1: date,
          col2: 42.0,
          col3: 'USD',
          col4: 'ACME',
          col5: 'Corp',
        }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
        createColumn('col4', ColumnDefinition.COUNTERPARTY),
        createColumn('col5', ColumnDefinition.COUNTERPARTY),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].counterparty).toBe('ACME Corp');
    });
  });

  // ---------------------------------------------------------------------------
  // N4: No `time` field in generated rows (ENT-001 end-to-end)
  // ---------------------------------------------------------------------------

  describe('ENT-001: no time field in generated rows', () => {
    it('N4: generated TransactionRow has no "time" key (stringify check)', async () => {
      const date = new Date('2023-07-04');
      const rows = [
        createMockRow(0, { col1: date, col2: 99.0, col3: 'USD' }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
      ];

      const result = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result.rows).toHaveLength(1);
      const rowJson = JSON.stringify(result.rows[0]);
      expect(rowJson).not.toContain('"time"');

      // Also verify via key enumeration
      const keys = Object.keys(result.rows[0]);
      expect(keys).not.toContain('time');
    });
  });

  // ---------------------------------------------------------------------------
  // N5: Determinism — same input twice → deep-equal output
  // ---------------------------------------------------------------------------

  describe('Determinism', () => {
    it('N5: same input twice produces deep-equal output', async () => {
      const date = new Date('2023-09-01');
      const rows = [
        createMockRow(0, { col1: date, col2: 55.0, col3: 'USD', col4: 'Groceries' }),
        createMockRow(1, { col1: date, col2: 88.0, col3: 'EUR', col4: 'Restaurant' }),
      ];

      const columns = [
        createColumn('col1', ColumnDefinition.DATE),
        createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
        createColumn('col3', ColumnDefinition.CURRENCY),
        createColumn('col4', ColumnDefinition.DESCRIPTION),
      ];

      const result1 = await generateRows(rows, columns, BASE_CURRENCY);
      const result2 = await generateRows(rows, columns, BASE_CURRENCY);

      expect(result1.rows).toHaveLength(result2.rows.length);
      expect(result1.rowErrors).toHaveLength(result2.rowErrors.length);
      expect(result1.skipped).toHaveLength(result2.skipped.length);

      // Deep-equal field by field for each row
      for (let i = 0; i < result1.rows.length; i++) {
        expect(result1.rows[i].amount).toBe(result2.rows[i].amount);
        expect(result1.rows[i].currency).toBe(result2.rows[i].currency);
        expect(result1.rows[i].description).toBe(result2.rows[i].description);
        expect(result1.rows[i].hash).toBe(result2.rows[i].hash);
        expect(result1.rows[i].date).toEqual(result2.rows[i].date);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // ENT-013: pseudo-op expansion wired into generateRows
  // ---------------------------------------------------------------------------

  describe('ENT-013: pseudo-op expansion', () => {
    // Helper to create a column with BankCommission / Cashback params
    function createCommissionColumn(id: string, params: BankCommissionColumnParams): ColumnInfo {
      return { id, definition: ColumnDefinition.BANK_COMMISSION, params };
    }

    function createCashbackColumn(id: string, params: CashbackColumnParams): ColumnInfo {
      return { id, definition: ColumnDefinition.CASHBACK, params };
    }

    // ── SPAWN-SCOPE PIN 1: income-skipped main + commission → skipped entry AND 1 commission op
    describe('SPAWN-SCOPE PIN 1 (decision 3): income-skipped main spawns pseudo-ops', () => {
      it('PIN1a: income-skipped main + commission cell → main in skipped WITH reason AND exactly 1 commission op in rows', async () => {
        const date = new Date('2024-01-10');
        const ignoreMsg = $t('engine.importStatement.income-value-ignored', { value: 5000 });

        // Row 0: income (AMOUNT cell has ignore) + commission cell
        const row0 = createMockRow(
          0,
          { col1: date, col2: 5000.0, colComm: 100.0 },
          { col2: ignoreMsg }, // income → skipped
        );

        const columns = [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
          createCommissionColumn('colComm', { currency: 'use_base' }),
        ];

        const result = await generateRows([row0], columns, BASE_CURRENCY);

        // Main op skipped (income)
        expect(result.skipped).toHaveLength(1);
        expect(result.skipped[0].rowIndex).toBe(0);
        expect(result.skipped[0].reason).toBeTruthy();

        // Commission pseudo-op spawned
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].isBankCommission).toBe(true);

        expect(result.rowErrors).toHaveLength(0);
      });

      it('PIN1b: income-skipped main + cashback cell → main in skipped AND exactly 1 cashback op in rows', async () => {
        const date = new Date('2024-01-10');
        const ignoreMsg = $t('engine.importStatement.income-value-ignored', { value: 5000 });

        const row0 = createMockRow(
          0,
          { col1: date, col2: 5000.0, colCb: 20.0 },
          { col2: ignoreMsg },
        );

        const columns = [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
          createCashbackColumn('colCb', { currency: 'use_base' }),
        ];

        const result = await generateRows([row0], columns, BASE_CURRENCY);

        expect(result.skipped).toHaveLength(1);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].isCashback).toBe(true);
        expect(result.rowErrors).toHaveLength(0);
      });

      it('PIN1c: income-skipped main + both commission + cashback → 2 pseudo-ops in rows + skipped main', async () => {
        const date = new Date('2024-01-10');
        const ignoreMsg = $t('engine.importStatement.income-value-ignored', { value: 5000 });

        const row0 = createMockRow(
          0,
          { col1: date, col2: 5000.0, colComm: 100.0, colCb: 20.0 },
          { col2: ignoreMsg },
        );

        const columns = [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
          createCommissionColumn('colComm', { currency: 'use_base' }),
          createCashbackColumn('colCb', { currency: 'use_base' }),
        ];

        const result = await generateRows([row0], columns, BASE_CURRENCY);

        expect(result.skipped).toHaveLength(1);
        expect(result.rows).toHaveLength(2);
        expect(result.rows[0].isBankCommission).toBe(true);
        expect(result.rows[1].isCashback).toBe(true);
        expect(result.rowErrors).toHaveLength(0);
      });
    });

    // ── SPAWN-SCOPE PIN 2: errored row → rowError only, ZERO pseudo-ops
    describe('SPAWN-SCOPE PIN 2: errored row never spawns pseudo-ops', () => {
      it('PIN2: errored row + non-empty commission cell → rowError only, ZERO pseudo-ops', async () => {
        // Use a throwing row to simulate an errored row (same pattern as N1)
        const throwingRow: ImportStatementRowData = {
          rowIndex: 0,
          get: vi.fn((_id: string): CellData => {
            throw new Error('Simulated row error');
          }),
          errorMessageAt: vi.fn().mockReturnValue(null),
          ignoreMessageAt: vi.fn().mockReturnValue(null),
          get isIgnored() { return false; },
          get hasErrors() { return false; },
        };

        const columns = [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'use_base' } as AmountColumnParams),
          createCommissionColumn('colComm', { currency: 'use_base' }),
        ];

        const result = await generateRows([throwingRow], columns, BASE_CURRENCY);

        expect(result.rows).toHaveLength(0);
        expect(result.rowErrors).toHaveLength(1);
        expect(result.skipped).toHaveLength(0);
        // No commission pseudo-op was spawned
      });
    });

    // ── ENT-013 acceptance: fixture row with commission+cashback → exactly 3 ops, 3 DISTINCT hashes
    describe('ENT-013 acceptance: 3 ops with distinct hashes', () => {
      it('ENT-013: row with commission+cashback → 3 ops (main, commission, cashback) with distinct hashes', async () => {
        const date = new Date('2024-03-01');
        const row = createMockRow(0, {
          col1: date,
          col2: 1000.0,
          col3: 'USD',
          colComm: 50.0,
          colCb: 10.0,
        });

        const columns = [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
          createColumn('col3', ColumnDefinition.CURRENCY),
          createCommissionColumn('colComm', { currency: 'use_base' }),
          createCashbackColumn('colCb', { currency: 'use_base' }),
        ];

        const result = await generateRows([row], columns, BASE_CURRENCY);

        expect(result.rowErrors).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
        expect(result.rows).toHaveLength(3);

        // Main op
        expect(result.rows[0].isBankCommission).toBe(false);
        expect(result.rows[0].isCashback).toBe(false);

        // Commission op
        expect(result.rows[1].isBankCommission).toBe(true);
        expect(result.rows[1].isCashback).toBe(false);

        // Cashback op
        expect(result.rows[2].isBankCommission).toBe(false);
        expect(result.rows[2].isCashback).toBe(true);

        // 3 DISTINCT hashes (Q-011 pin)
        const hashes = result.rows.map((r) => r.hash);
        const uniqueHashes = new Set(hashes);
        expect(uniqueHashes.size).toBe(3);
      });
    });

    // ── never-throw: bad commission cell on good main → main in rows + pseudo-error with columnId
    describe('never-throw contract holds for pseudo-ops', () => {
      it('bad commission cell on good main → main in rows + pseudo-error in rowErrors with columnId, generation continues', async () => {
        const date = new Date('2024-04-01');
        const errMsg = $t("engine.importStatement.can't-parse-as-bank-commission", {
          message: $t('engine.importStatement.bank-commission-parse-failed', { value: 'bad' }),
        });

        const row = createMockRow(
          2,
          { col1: date, col2: 200.0, col3: 'USD', colComm: 'bad' },
          {},
          { colComm: errMsg }, // error cell
        );

        const columns = [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
          createColumn('col3', ColumnDefinition.CURRENCY),
          createCommissionColumn('colComm', { currency: 'use_base' }),
        ];

        const result = await generateRows([row], columns, BASE_CURRENCY);

        // Main op generated
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].isBankCommission).toBe(false);

        // Pseudo-error collected with columnId
        expect(result.rowErrors).toHaveLength(1);
        expect(result.rowErrors[0].columnId).toBe('colComm');

        expect(result.skipped).toHaveLength(0);
      });
    });

    // ── existing tests: zero pseudo-op count changes when no commission/cashback columns mapped
    describe('suite integrity: no commission/cashback columns → zero pseudo-ops', () => {
      it('existing rows without commission/cashback columns produce same count (no extra pseudo-ops)', async () => {
        const date = new Date('2024-01-01');
        const rows = [
          createMockRow(0, { col1: date, col2: 100.0, col3: 'USD', col4: 'Buy' }),
          createMockRow(1, { col1: date, col2: 200.0, col3: 'EUR', col4: 'Sell' }),
        ];

        const columns = [
          createColumn('col1', ColumnDefinition.DATE),
          createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
          createColumn('col3', ColumnDefinition.CURRENCY),
          createColumn('col4', ColumnDefinition.DESCRIPTION),
          // No BANK_COMMISSION or CASHBACK columns
        ];

        const result = await generateRows(rows, columns, BASE_CURRENCY);

        // Still exactly 2 main ops — no extra pseudo-ops
        expect(result.rows).toHaveLength(2);
        expect(result.rowErrors).toHaveLength(0);
        expect(result.skipped).toHaveLength(0);
      });
    });
  });
});
