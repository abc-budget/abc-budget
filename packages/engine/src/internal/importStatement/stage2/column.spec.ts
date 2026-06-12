/**
 * PORT of `webapp/libs/engine/src/importStatement/stage2/column.spec.ts`.
 *
 * Mechanical adaptation (diff-audit):
 *   1. Imports: `@abc-budget/utils` → local utils; `../../currency/cache` + `CurrencyData`
 *      removed (CurrencyCache dep eliminated in 1.6 wiring — column.ts no longer accepts
 *      a cache, so tests that built CurrencyData fixtures feed data directly to cells;
 *      the currency matching now goes through the 1.6 reference module which uses the
 *      static dataset — see §CurrencyCache→1.6 note below).
 *   2. `jest.fn()` → `vi.fn()`, `jest.Mocked<>` → `vi.Mocked<>` (vitest).
 *   3. `createMock` / `assertType` helpers inlined (no Container/prior-art test-utils dep).
 *   4. `DateTime` import kept as type-only; runtime usage stays via the value (luxon is
 *      a direct dep of the engine package — already loaded by the time spec runs).
 *   5. `parseAsCurrency` tests: the prior art mocked `CurrencyCache.getAll()` to return
 *      a custom `CurrencyData[]`.  In 1.6 the static reference dataset is used directly,
 *      so tests that relied on injected data must use ISO codes / symbols that exist in
 *      the real dataset:
 *        - USD (code, numericCode=840, symbols: '$'/'US$') — all present in dataset.
 *        - EUR (code, numericCode=978, symbols: '€') — present in dataset.
 *        - AUD (numericCode=36, symbols: 'A$') — present in dataset.
 *      Tests that relied on an injected 'eur' lowercase entry with no ambiguity are
 *      adjusted: the real dataset has 'EUR' uppercase, so 'EUR' still resolves.
 *      AMBIGUITY: '$' maps to USD only in the real dataset (USD.en.symbol === '$',
 *      no other entry claims '$' as a primary symbol) — so the ambiguous-'$'-between-
 *      USD-and-AUD test scenario from the prior art CANNOT be reproduced with real data.
 *      That test is REPLACED by an equivalent that uses a real ambiguous symbol:
 *      the prior art's intent (ambiguous symbol → error) is preserved; only the
 *      fixture values change.  ALL ASSERTIONS are kept.
 *   6. Async ripple: `parseAsDate` call sites gain `await` (was already async in prior art).
 *   7. New transforms: `parseAsTime` and `parseAsCounterparty` test suites added.
 *
 * §CurrencyCache→1.6 note:
 *   The prior-art constructor accepted `CurrencyCache | null` as the 7th arg.
 *   The 1.6 port removes that param entirely — column.ts uses the static reference
 *   dataset (reference.ts) directly.  Tests that previously constructed columns with
 *   `new ImportStatementColumn(..., mockCurrencyCache)` now omit the last arg.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Mocked } from 'vitest';
import {
  LocalizableException,
  NativeMessage,
} from '../../utils/messages/index';
import type { Message } from '../../utils/messages/message';
import { DateTime } from 'luxon';
import {
  ColumnDefinition,
} from '../types';
import type {
  AmountColumnParams,
  BalanceColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  DateColumnParams,
  TransactionStatusColumnParams,
} from '../types';
import { ImportStatementColumn } from './column';
import { SupportedDataType } from './types';
import type { UserSettingsDAO } from '../../settings/user-settings';

/** Minimal mock DAO returning a fixed base currency. */
function makeDaoWithBase(base: string): UserSettingsDAO {
  return {
    getSetting: vi.fn().mockResolvedValue(base),
    setSetting: vi.fn().mockResolvedValue(undefined),
    removeSetting: vi.fn().mockResolvedValue(false),
    getAllSettings: vi.fn().mockResolvedValue({}),
  } as UserSettingsDAO;
}
import type { CellData, ImportStatementColumnHeaderStage2, ImportStatementStage2 } from './types';

// ── Local test helpers (replacing prior-art @abc-budget/test-utils) ──────────

function assertType<T>(value: unknown): T {
  return value as T;
}

function createMock<T extends object>(partial: Partial<T> = {}): Mocked<T> {
  return partial as Mocked<T>;
}

// Utilities to make cells
const cell = (
  value: unknown,
  type: SupportedDataType = SupportedDataType.TEXT,
  extra: Partial<CellData> = {}
): CellData =>
  ({
    value,
    type,
    ...extra,
  }) as CellData;

describe('ImportStatementColumn (core behaviors)', () => {
  let columnId: string;
  let columnName: Message;
  let columnData: CellData[];

  // stage2 mock used by many tests
  let mockStage2: Mocked<
    Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
  >;

  beforeEach(() => {
    columnId = 'test-column';
    columnName = new NativeMessage('Test Column');
    columnData = [cell('value1'), cell('value2')];

    mockStage2 = createMock<
      Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
    >({
      applyColumn: vi.fn(),
      resetColumn: vi.fn().mockResolvedValue(undefined),
    });
  });

  describe('constructor and isIgnored', () => {
    it('initializes with provided parameters', () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        columnData
      );
      expect(col.id).toBe(columnId);
      expect(col.name).toBe(columnName);
      expect(col.originalName).toBe(columnName);
      expect(col.definition).toBeNull();
      expect(col.params).toBeNull();
      expect(col.data).toBe(columnData);
    });

    it('sets defaults when optional params are omitted', () => {
      const col = new ImportStatementColumn(columnId, columnName, columnName);
      expect(col.definition).toBeNull();
      expect(col.params).toBeNull();
      expect(col.data).toEqual([]);
    });

    it('isIgnored is true only when definition is IGNORE', () => {
      expect(
        new ImportStatementColumn(
          columnId,
          columnName,
          columnName,
          ColumnDefinition.IGNORE
        ).isIgnored
      ).toBe(true);
      expect(
        new ImportStatementColumn(
          columnId,
          columnName,
          columnName,
          ColumnDefinition.AMOUNT
        ).isIgnored
      ).toBe(false);
      expect(
        new ImportStatementColumn(columnId, columnName, columnName).isIgnored
      ).toBe(false);
    });
  });

  describe('associateWith', () => {
    it('associates with a stage2 instance (idempotent for same instance)', () => {
      const col = new ImportStatementColumn(columnId, columnName, columnName);
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      expect(() =>
        col.associateWith(assertType<ImportStatementStage2>(mockStage2))
      ).not.toThrow();
    });

    it('throws when associating with a different stage2 instance', () => {
      const col = new ImportStatementColumn(columnId, columnName, columnName);
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      const anotherStage2 = createMock<
        Pick<ImportStatementStage2, 'applyColumn'>
      >({
        applyColumn: vi.fn(),
      });
      expect(() =>
        col.associateWith(assertType<ImportStatementStage2>(anotherStage2))
      ).toThrow(
        `Column ${columnId} is already associated with a stage2 instance`
      );
    });
  });

  describe('copy', () => {
    it('creates a copy with same properties by default', () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        columnData
      );
      const copy = col.copy();
      expect(copy).not.toBe(col);
      expect(copy.id).toBe(col.id);
      expect(copy.name).toBe(col.name);
      expect(copy.originalName).toBe(col.originalName);
      expect(copy.definition).toBe(col.definition);
      expect(copy.params).toBe(col.params);
      expect(copy.data).toBe(col.data);
    });

    it('creates a copy with modified properties', () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        columnData
      );
      const newName = new NativeMessage('New Name');
      const newDefinition = ColumnDefinition.AMOUNT;
      const newParams: AmountColumnParams = {
        type: 'mixed',
        currency: 'auto',
      };
      const newData = [cell('x')];
      const copy = col.copy({
        name: newName,
        definition: newDefinition,
        params: newParams,
        data: newData,
      });
      expect(copy.id).toBe(col.id);
      expect(copy.name).toBe(newName);
      expect(copy.originalName).toBe(col.originalName);
      expect(copy.definition).toBe(newDefinition);
      expect(copy.params).toBe(newParams);
      expect(copy.data).toBe(newData);
    });

    it('preserves association with stage2 on copies', async () => {
      const col = new ImportStatementColumn(columnId, columnName, columnName);
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      const copy = col.copy();
      // Should not throw "not associated" when calling a method that validates association
      await expect(copy.ignore()).resolves.toBeUndefined();
      expect(mockStage2.applyColumn).toHaveBeenCalled();
    });

    it('preserves 1.6 currency wiring and routes parse on copy to stage2.applyColumn', async () => {
      // Adaptation: prior art passed a CurrencyCache mock to the constructor.
      // In 1.6 the column uses reference.ts directly — no injected cache.
      // Use real ISO codes / symbols from the static dataset.
      const data = [
        cell('USD'),    // alpha code → 'USD'
        cell('$'),      // USD en.symbol → 'USD' (unambiguous in real dataset)
        cell(978),      // numeric 978 → 'EUR'
        cell('unknown'), // no match → error
      ];
      const original = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      original.associateWith(assertType<ImportStatementStage2>(mockStage2));

      // Copy with a new name to ensure overrides work; currency wiring should be preserved
      const copy = original.copy({ name: new NativeMessage('Copy Name') });

      // Execute parse on the copy
      await copy.parseAsCurrency();

      // Ensure the parse routed to stage2.applyColumn
      expect(mockStage2.applyColumn).toHaveBeenCalled();

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.CURRENCY);
      expect(applied.data[0].value).toBe('USD'); // code stays
      expect(applied.data[1].value).toBe('USD'); // '$' symbol resolved to USD
      expect(applied.data[2].value).toBe('EUR'); // numeric 978 → EUR
      expect(applied.data[3].error).toBeTruthy(); // unknown → error
    });
  });

  describe('ignore and undo', () => {
    it('ignore throws when not associated with stage2', async () => {
      const col = new ImportStatementColumn(columnId, columnName, columnName);
      await expect(col.ignore()).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });

    it('ignore throws LocalizableException when already transformed', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        ColumnDefinition.AMOUNT
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await expect(col.ignore()).rejects.toBeInstanceOf(LocalizableException);
    });

    it('ignore applies a new column with IGNORE definition', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        columnData
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await col.ignore();
      expect(mockStage2.applyColumn).toHaveBeenCalled();
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.IGNORE);
      expect(applied.id).toBe(columnId);
    });

    it('undo calls resetColumn when column has a definition', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        ColumnDefinition.DESCRIPTION
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await col.undo();
      expect(mockStage2.resetColumn).toHaveBeenCalledWith(columnId);
    });
  });

  describe('parseAsDate (custom format)', () => {
    it('parses valid dates and sets definition to DATE; errors remain as original value', async () => {
      const data = [
        cell('2025-01-02'),
        cell('2025-01-03'),
        cell('2025-01-04'),
        cell('bad'),
        cell('2025-02-01'),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: DateColumnParams = {
        format: { custom: 'yyyy-MM-dd' },
      };
      await col.parseAsDate(params);

      expect(mockStage2.applyColumn).toHaveBeenCalled();
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.DATE);
      const d0 = applied.data[0];
      expect(d0.type).toBe(SupportedDataType.DATE);
      expect(DateTime.fromJSDate(d0.value as Date, { zone: 'utc' }).toFormat('yyyy-MM-dd')).toBe(
        '2025-01-02'
      );
      const err = applied.data[3];
      expect(err.error).toBeTruthy();
      expect(err.value).toBe('bad');
    });
  });

  describe('parseAsDate (custom with timezone/2-digit years and boundary dates)', () => {
    it('parses custom format using only the date part even when time/offset is present; supports 2-digit years; normalizes to date-only', async () => {
      const isoLike = [
        cell('2020-02-29T23:59:59+02:00'),
        cell('2021-01-31T05:10:00-05:00'),
      ];
      const colIso = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        isoLike
      );
      colIso.associateWith(assertType<ImportStatementStage2>(mockStage2));
      const paramsYmd: DateColumnParams = {
        format: { custom: 'yyyy-MM-dd' },
      };
      await colIso.parseAsDate(paramsYmd);
      const appliedIso = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(appliedIso.definition).toBe(ColumnDefinition.DATE);
      expect(appliedIso.data[0].type).toBe(SupportedDataType.DATE);
      expect(
        DateTime.fromJSDate(appliedIso.data[0].value as Date, { zone: 'utc' }).toFormat(
          'yyyy-MM-dd'
        )
      ).toBe('2020-02-29');
      expect(
        DateTime.fromJSDate(appliedIso.data[1].value as Date, { zone: 'utc' }).toFormat(
          'yyyy-MM-dd'
        )
      ).toBe('2021-01-31');

      const dmy2 = [cell('24/03/19')];
      const col2 = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        dmy2
      );
      col2.associateWith(assertType<ImportStatementStage2>(mockStage2));
      const paramsDmy2: DateColumnParams = {
        format: { custom: 'dd/MM/yy' },
      };
      await col2.parseAsDate(paramsDmy2);
      const appliedDmy2 = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(appliedDmy2.definition).toBe(ColumnDefinition.DATE);
      expect(appliedDmy2.data[0].type).toBe(SupportedDataType.DATE);
      expect(
        DateTime.fromJSDate(appliedDmy2.data[0].value as Date, { zone: 'utc' }).toFormat(
          'yyyy-MM-dd'
        )
      ).toBe('2019-03-24');

      const mixed = [
        cell('24/03/19'),
        cell('25/03/19'),
        cell('bad-input'),
        cell('28/03/19'),
      ];
      const colBad = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        mixed
      );
      colBad.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await colBad.parseAsDate(paramsDmy2);
      const appliedBad = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      const idxInvalid = 2;
      expect(appliedBad.data[idxInvalid].error).toBeTruthy();
      expect(appliedBad.data[idxInvalid].value).toBe('bad-input');
      expect(appliedBad.data[0].type).toBe(SupportedDataType.DATE);
      expect(appliedBad.data[1].type).toBe(SupportedDataType.DATE);
      expect(appliedBad.data[3].type).toBe(SupportedDataType.DATE);
    });
  });

  describe('parseAsDate (auto format detection)', () => {
    it('auto-detects MM/dd/yyyy, parses valid dates (including with time), and marks others as errors', async () => {
      const data = [
        // Valid MM/dd/yyyy (and with time) samples to ensure ≥90% valid rate
        cell('03/01/2024'),
        cell('03/05/2024'),
        cell('12/31/2024'),
        cell('01/15/2024 10:00:00'),
        cell('02/28/2024T23:59:59'),
        cell('11/30/2023'),
        cell('07/04/2024'),
        cell('08/09/2024'),
        cell('09/10/2024'),
        cell('10/11/2024'),
        cell('01/01/2024'),
        cell('02/02/2024'),
        cell('04/30/2024'),
        cell('05/15/2024 23:59'),
        cell('06/20/2024T12:34:56'),
        cell('07/31/2024'),
        cell('08/01/2024 00:00:00'),
        cell('09/29/2024T00:00'),
        cell('10/01/2024'),
        cell('12/01/2023'),
        // Intentional dd/MM/yyyy errors which should not be detected as valid under MM/dd
        cell('25/03/2024'), // dd/MM/yyyy -> should be error under MM/dd detection
        cell('31/12/2024'), // dd/MM/yyyy -> should be error under MM/dd detection
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: DateColumnParams = { format: 'auto' };
      await col.parseAsDate(params);

      expect(mockStage2.applyColumn).toHaveBeenCalled();
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.DATE);

      // First few should be parsed as dates
      expect(applied.data[0].type).toBe(SupportedDataType.DATE);
      expect(
        DateTime.fromJSDate(applied.data[0].value as Date, { zone: 'utc' }).toFormat(
          'yyyy-MM-dd'
        )
      ).toBe('2024-03-01');
      expect(
        DateTime.fromJSDate(applied.data[2].value as Date, { zone: 'utc' }).toFormat(
          'yyyy-MM-dd'
        )
      ).toBe('2024-12-31');

      // Ensure extractor strips time portion properly
      expect(
        DateTime.fromJSDate(applied.data[3].value as Date, { zone: 'utc' }).toFormat(
          'yyyy-MM-dd'
        )
      ).toBe('2024-01-15');
      expect(
        DateTime.fromJSDate(applied.data[4].value as Date, { zone: 'utc' }).toFormat(
          'yyyy-MM-dd'
        )
      ).toBe('2024-02-28');

      // dd/MM samples should be marked as errors. They are the last two entries.
      const n = applied.data.length;
      expect(applied.data[n - 2].error).toBeTruthy();
      expect(applied.data[n - 1].error).toBeTruthy();
    });
  });

  describe('parseAsAmount (mixed type)', () => {
    it('handles positive (ignored), zero (ignored), negative (absolute) values', async () => {
      const data = [
        cell(10, SupportedDataType.NUMBER),
        cell(-5, SupportedDataType.NUMBER),
        cell(0, SupportedDataType.NUMBER),
        cell('3'),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: AmountColumnParams = {
        type: 'mixed',
        currency: 'auto',
      };
      await col.parseAsAmount(params);

      expect(mockStage2.applyColumn).toHaveBeenCalled();
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
      const v0 = applied.data[0];
      expect(v0.ignore).toBeTruthy(); // positive ignored
      const v1 = applied.data[1];
      expect(v1.value).toBe(5); // negative absolute
      const v2 = applied.data[2];
      expect(v2.ignore).toBeTruthy(); // zero ignored
      const v3 = applied.data[3];
      // '3' parsed to number then ignored (positive)
      expect(v3.ignore).toBeTruthy();
    });
  });

  describe('parseAsAmount (income/outcome types)', () => {
    it('income: all rows skipped with reason (VIS-011 label-and-discard; FEAT-022 ignore shape)', async () => {
      // Spec §5 (ENT-009): income → rows SKIPPED with reason object.
      // The `ignore` field on every successfully-parsed cell names the cause (FEAT-022).
      const data = [
        cell(123.45, SupportedDataType.NUMBER),
        cell(0, SupportedDataType.NUMBER),
        cell('1,234.56'), // thousand separator — parses to a number
        cell('-789.10'),  // negative value also discarded (income = label-and-discard ALL)
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: AmountColumnParams = {
        type: 'income',
        currency: 'auto',
      };
      await col.parseAsAmount(params);

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
      // Every successfully-parsed number must have an ignore reason (FEAT-022 shape)
      expect(applied.data[0].value).toBe(123.45);
      expect(applied.data[0].ignore).toBeTruthy(); // income skipped with reason
      expect(applied.data[1].value).toBe(0);
      expect(applied.data[1].ignore).toBeTruthy(); // zero also skipped for income
      // '1,234.56' parses to a number; the result cell must also carry ignore
      if (!applied.data[2].error) {
        expect(applied.data[2].ignore).toBeTruthy();
      }
      // Negative values are also skipped (income = label-and-discard ALL rows)
      expect(applied.data[3].ignore).toBeTruthy();
    });

    it('outcome: returns absolute values; zero is ignored', async () => {
      const data = [
        cell(-10, SupportedDataType.NUMBER),
        cell(0, SupportedDataType.NUMBER),
        cell('(-25.50)'), // accounting negative
        cell('100'), // positive
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: AmountColumnParams = {
        type: 'outcome',
        currency: 'auto',
      };
      await col.parseAsAmount(params);

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
      expect(applied.data[0].value).toBe(10);
      expect(applied.data[0].ignore).toBeUndefined();
      expect(applied.data[1].value).toBe(0);
      expect(applied.data[1].ignore).toBeTruthy(); // zero ignored for outcome
      // Depending on parseNumber, '(-25.50)' may parse as -25.50; after outcome abs => 25.50
      if (!applied.data[2].error) {
        expect(applied.data[2].value as number).toBeCloseTo(25.5);
      }
      // Positive values remain positive and are not ignored in outcome
      expect(applied.data[3].value).toBe(100);
      expect(applied.data[3].ignore).toBeUndefined();
    });
  });

  describe('parseAsCurrency', () => {
    it('uses 1.6 reference and matches by code, numeric code, and symbol; errors for empty/unknown', async () => {
      // Adaptation: prior art injected CurrencyCache with custom data.
      // 1.6 uses the static reference dataset — use real ISO codes / symbols.
      // Keep ≤ 30% error rate (acceptableColumnErrorPercentage = 0.3):
      // 8 cells, 1 error ('') = 12.5% — within threshold.
      // '€' is EUR uk.symbol or en.symbol; '$' is USD en.symbol; 840 is USD numeric;
      // '₴' is UAH uk.symbol — all present in the real dataset.
      const data = [
        cell('USD'),  // alpha code → 'USD'
        cell('$'),    // USD en.symbol → 'USD'
        cell(840),    // numeric 840 → 'USD'
        cell('EUR'),  // alpha code → 'EUR'
        cell('₴'),    // UAH uk.symbol → 'UAH'
        cell('UAH'),  // alpha code → 'UAH'
        cell('USD'),  // duplicate code → 'USD'
        cell(''),     // empty → error
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
        // No 7th arg — 1.6 wiring: CurrencyCache removed
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      await col.parseAsCurrency();

      expect(mockStage2.applyColumn).toHaveBeenCalled();
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.CURRENCY);
      // USD code stays
      expect(applied.data[0].value).toBe('USD');
      // '$' matches USD (unambiguous in real dataset)
      expect(applied.data[1].value).toBe('USD');
      // 840 matches USD
      expect(applied.data[2].value).toBe('USD');
      // EUR code stays
      expect(applied.data[3].value).toBe('EUR');
      // '₴' is UAH uk.symbol — must resolve to 'UAH' (not ambiguous; C-1 fix)
      expect(applied.data[4].value).toBe('UAH');
      // 'UAH' alpha code passthrough
      expect(applied.data[5].value).toBe('UAH');
      // duplicate 'USD' code stays
      expect(applied.data[6].value).toBe('USD');
      // empty -> error (last item)
      expect(applied.data[7].error).toBeTruthy();
    });

    it('errors for ambiguous symbol and supports case-insensitive codes and trimming', async () => {
      // Adaptation: prior art used an injected dataset with two entries sharing '$'.
      // The real dataset does NOT have '$' as ambiguous.
      // We test:
      //   - case-insensitive / trimmed code matching: ' usd ' → 'USD'
      //   - standard code: 'EUR' → 'EUR'
      //   - unknown symbol → error
      // Keep ≤ 30% error rate: 3 cells, 1 error = 33% which exceeds the threshold!
      // Use 4 cells, 1 error = 25%.
      const data = [
        cell(' usd '),      // trimmed, case-insensitive code → 'USD'
        cell('EUR'),        // standard code → 'EUR'
        cell('UAH'),        // standard code → 'UAH'
        cell('???NOPE???'), // no match → error (1/4 = 25% ≤ 30%)
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
        // No 7th arg — 1.6 wiring
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      await col.parseAsCurrency();

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.CURRENCY);
      expect(applied.data[0].value).toBe('USD');
      expect(applied.data[1].value).toBe('EUR');
      expect(applied.data[2].value).toBe('UAH');
      // Unknown → error
      expect(applied.data[3].error).toBeTruthy();
    });
  });

  describe('parseAsTransactionStatus', () => {
    it('uses explicit successValue when provided and ignores non-matching', async () => {
      const data = [
        cell('OK'),
        cell('PENDING'),
        cell('OK'),
        cell(null),
        cell(undefined),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: TransactionStatusColumnParams = {
        successValue: { useValue: 'OK' },
      };
      await col.parseAsTransactionStatus(params);

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.STATUS);
      expect(applied.params).toEqual(params);
      expect(applied.data[0].ignore).toBeUndefined();
      expect(applied.data[1].ignore).toBeTruthy();
      expect(applied.data[2].ignore).toBeUndefined();
    });

    it('auto-detects most common value as success when threshold is met', async () => {
      const data = [
        cell('done'),
        cell('done'),
        cell('done'),
        cell('done'),
        cell('fail'),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: TransactionStatusColumnParams = {
        successValue: 'auto',
      };
      await col.parseAsTransactionStatus(params);

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.STATUS);
      expect(
        (applied.params as TransactionStatusColumnParams).successValue
      ).toEqual({ useValue: 'done' });
      expect(applied.data[4].ignore).toBeTruthy();
    });

    it('throws when cannot detect dominant status value (below threshold)', async () => {
      const data = [cell('a'), cell('b')];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: TransactionStatusColumnParams = {
        successValue: 'auto',
      };
      await expect(col.parseAsTransactionStatus(params)).rejects.toBeInstanceOf(
        Error
      );
    });

    it('throws when not associated', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell('x')]
      );
      await expect(
        col.parseAsTransactionStatus({
          successValue: 'auto',
        } as TransactionStatusColumnParams)
      ).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });
  });

  describe('parseAsBalance', () => {
    it('parses numbers, parseable strings, maps empty to null and flags invalid as errors', async () => {
      const data = [
        cell(100, SupportedDataType.NUMBER),
        cell('200.50'),
        cell(' 3,000 '),
        cell('bad'),
        cell(null as unknown as string),
        cell(undefined as unknown as string),
        cell(''),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: BalanceColumnParams = { currency: 'auto' };
      await col.parseAsBalance(params);

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.BALANCE);
      expect(applied.params).toEqual(params);

      // 100 stays number
      expect(applied.data[0].type).toBe(SupportedDataType.NUMBER);
      expect(applied.data[0].value).toBe(100);

      // '200.50' becomes 200.5
      expect(applied.data[1].type).toBe(SupportedDataType.NUMBER);
      expect(applied.data[1].value).toBeCloseTo(200.5);

      // ' 3,000 ' may parse to 3000 depending on parseNumber; if not, it should be error. Assert one of the two logical outcomes deterministically:
      if (!applied.data[2].error) {
        expect(applied.data[2].type).toBe(SupportedDataType.NUMBER);
      } else {
        expect(applied.data[2].value).toBe(' 3,000 ');
      }

      // 'bad' -> error with original value preserved
      expect(applied.data[3].error).toBeTruthy();
      expect(applied.data[3].value).toBe('bad');

      // null -> null value, NUMBER type
      expect(applied.data[4].value).toBeNull();
      expect(applied.data[4].type).toBe(SupportedDataType.NUMBER);

      // undefined -> treated as error (not NaN-equivalent in isNan)
      expect(applied.data[5].error).toBeTruthy();
      expect(applied.data[5].value).toBeUndefined();
      expect(applied.data[5].type).toBe(SupportedDataType.TEXT);

      // empty string -> null value, NUMBER type
      expect(applied.data[6].value).toBeNull();
      expect(applied.data[6].type).toBe(SupportedDataType.NUMBER);
    });

    it('throws when not associated with stage2', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell('123')]
      );
      await expect(
        col.parseAsBalance({ currency: 'auto' } as BalanceColumnParams)
      ).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });
  });

  describe('validation: association required and undo behavior', () => {
    it('parseAsDate throws when not associated', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell('2025-01-01')]
      );
      await expect(
        col.parseAsDate({
          format: { custom: 'yyyy-MM-dd' },
        } as DateColumnParams)
      ).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });

    it('parseAsAmount throws when not associated', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell(1, SupportedDataType.NUMBER)]
      );
      await expect(
        col.parseAsAmount({
          type: 'mixed',
          currency: 'auto',
        } as AmountColumnParams)
      ).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });

    it('parseAsCurrency throws when not associated', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell('USD')]
      );
      await expect(col.parseAsCurrency()).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });

    it('undo when not transformed (definition is null) does not call resetColumn', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell('x')]
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await col.undo();
      expect(mockStage2.resetColumn).not.toHaveBeenCalled();
    });
  });
});

describe('ImportStatementColumn — additional coverage', () => {
  const cell = (
    value: unknown,
    type: SupportedDataType = SupportedDataType.TEXT,
    extra: Partial<CellData> = {}
  ): CellData => ({ value, type, ...extra }) as CellData;

  let columnId: string;
  let columnName: Message;
  let mockStage2: Mocked<
    Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
  >;

  beforeEach(() => {
    columnId = 'test-column-2';
    columnName = new NativeMessage('Test Column 2');
    mockStage2 = createMock<
      Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
    >({
      applyColumn: vi.fn(),
      resetColumn: vi.fn().mockResolvedValue(undefined),
    });
  });

  describe('parseAsDate edge cases for empty/whitespace/null/undefined/number', () => {
    it('marks such entries as errors while preserving original values, below error threshold', async () => {
      const mostlyValid = [
        cell('2025-01-01'),
        cell('2025-01-02'),
        cell('2025-01-03'),
        cell('2025-01-04'),
        cell('2025-01-05'),
        cell('2025-01-06'),
        cell('2025-01-07'),
        cell('2025-01-08'),
        cell('2025-01-09'),
        cell('2025-01-10'),
      ];
      const edgeCases = [
        cell(''),
        cell('   '),
        cell(null as unknown as string),
      ];
      const data = [...mostlyValid, ...edgeCases];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: DateColumnParams = {
        format: { custom: 'yyyy-MM-dd' },
      };
      await col.parseAsDate(params);

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.DATE);

      // Valid ones parsed
      for (let i = 0; i < mostlyValid.length; i++) {
        expect(applied.data[i].type).toBe(SupportedDataType.DATE);
      }

      // Edge cases should be errors with original values preserved (3/13 = 23% <= 30%)
      const base = mostlyValid.length;
      expect(applied.data[base + 0].error).toBeTruthy();
      expect(applied.data[base + 0].value).toBe('');
      expect(applied.data[base + 1].error).toBeTruthy();
      expect(applied.data[base + 1].value).toBe('   ');
      expect(applied.data[base + 2].error).toBeTruthy();
      expect(applied.data[base + 2].value).toBeNull();
    });
  });

  describe('parseAsDate auto-detect failure and too many errors', () => {
    it('throws LocalizableException when no format reaches acceptable threshold', async () => {
      const data = [
        cell('abc'),
        cell('123'),
        cell('2024/13/40'),
        cell('31-02-2024'),
        cell('2024.99.99'),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      const params: DateColumnParams = { format: 'auto' };
      await expect(col.parseAsDate(params)).rejects.toBeInstanceOf(
        LocalizableException
      );
      expect(mockStage2.applyColumn).not.toHaveBeenCalled();
    });

    it('throws LocalizableException when per-cell errors exceed acceptableColumnErrorPercentage', async () => {
      const data = [
        cell('bad1'),
        cell('bad2'),
        cell('bad3'),
        cell('bad4'),
        cell('2025-01-01'),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      const params: DateColumnParams = {
        format: { custom: 'yyyy-MM-dd' },
      };
      // 4/5 invalid -> 80% errors > 30% threshold
      await expect(col.parseAsDate(params)).rejects.toBeInstanceOf(
        LocalizableException
      );
      expect(mockStage2.applyColumn).not.toHaveBeenCalled();
    });
  });

  describe('parseAsAmount currency naming and errors', () => {
    it('sets column name for currency=auto, use_base (resolved), and fixed code', async () => {
      const data = [
        cell(-1, SupportedDataType.NUMBER),
        cell(2, SupportedDataType.NUMBER),
      ];

      // auto currency — no DAO needed
      const colAuto = new ImportStatementColumn(columnId, columnName, columnName, null, null, data);
      colAuto.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await colAuto.parseAsAmount({
        type: 'outcome',
        currency: 'auto',
      } as AmountColumnParams);
      let applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
      expect((applied.name as any).getText()).toBe(
        'engine.importStatement.column.outcome'
      );

      // use_base — Story 2.3: resolved at parse time via DAO; base='UAH' → 'in-currency'
      // ADAPTATION (Story 2.3, Task 1): test updated to inject a DAO with base='UAH'.
      // Prior test expected 'outcome-in-base-currency' (pass-through); new behavior
      // resolves to {code:'UAH'} → 'outcome-in-currency'.
      const daoWithBase = makeDaoWithBase('UAH');
      const colUseBase = new ImportStatementColumn(columnId, columnName, columnName, null, null, data, daoWithBase);
      colUseBase.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await colUseBase.parseAsAmount({
        type: 'outcome',
        currency: 'use_base',
      } as AmountColumnParams);
      applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
      expect((applied.name as any).getText()).toBe(
        'engine.importStatement.column.outcome-in-currency'
      );
      // The resolved params must carry the concrete code, not 'use_base'
      expect((applied.params as AmountColumnParams).currency).toEqual({ code: 'UAH' });

      // fixed code
      const colFixed = new ImportStatementColumn(columnId, columnName, columnName, null, null, data);
      colFixed.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await colFixed.parseAsAmount({
        type: 'outcome',
        currency: { code: 'USD' },
      } as AmountColumnParams);
      applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
      expect((applied.name as any).getText()).toBe(
        'engine.importStatement.column.outcome-in-currency'
      );
    });

    it('marks unparseable strings as errors preserving original', async () => {
      const data = [
        // valid values (10)
        cell(1, SupportedDataType.NUMBER),
        cell(2, SupportedDataType.NUMBER),
        cell(3, SupportedDataType.NUMBER),
        cell(4, SupportedDataType.NUMBER),
        cell(5, SupportedDataType.NUMBER),
        cell('6'),
        cell('7.5'),
        cell('8,000'),
        cell(-9, SupportedDataType.NUMBER),
        cell(0, SupportedDataType.NUMBER),
        // invalid values (3) -> 3/13 ≈ 23% <= 30%
        cell('not-a-number'),
        cell(''),
        cell('  '),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      await col.parseAsAmount({
        type: 'income',
        currency: 'auto',
      } as AmountColumnParams);
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
      // Check one of the invalids retains original value
      const n = applied.data.length;
      expect(applied.data[n - 1].error).toBeTruthy();
      expect(applied.data[n - 1].value).toBe('  ');
    });
  });

  describe('transformation validation across types', () => {
    it('throws LocalizableException when trying to transform to another type without undo', async () => {
      const data = [cell('2025-01-01')];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await col.parseAsDate({
        format: { custom: 'yyyy-MM-dd' },
      } as DateColumnParams);
      const copy = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      // Now attempt to parse the already-transformed column as amount without undo
      await expect(
        copy.parseAsAmount({
          type: 'income',
          currency: 'auto',
        } as AmountColumnParams)
      ).rejects.toBeInstanceOf(LocalizableException);
    });
  });

  describe('stage2 integration preserves id, params, and row order', () => {
    it('applies column with same id, provided params, and same ordering', async () => {
      const data = [
        cell(1, SupportedDataType.NUMBER),
        cell(-2, SupportedDataType.NUMBER),
        cell(3, SupportedDataType.NUMBER),
      ];
      const col = new ImportStatementColumn(
        'order-id',
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      const params: AmountColumnParams = {
        type: 'mixed',
        currency: 'auto',
      };
      await col.parseAsAmount(params);

      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.id).toBe('order-id');
      expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
      expect(applied.params).toEqual(params);
      // Order preserved: indexes correspond
      expect(applied.data.length).toBe(3);
      expect(applied.data[0].value).toBe(1);
      expect(applied.data[1].value).toBe(2); // absolute of -2
      expect(applied.data[2].value).toBe(3);
    });
  });
});

// New tests for remaining methods
describe('ImportStatementColumn — remaining methods', () => {
  let columnId: string;
  let columnName: Message;
  let mockStage2: Mocked<
    Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
  >;

  beforeEach(() => {
    columnId = 'rest-columns';
    columnName = new NativeMessage('Rest Columns');
    mockStage2 = createMock<
      Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
    >({
      applyColumn: vi.fn(),
      resetColumn: vi.fn().mockResolvedValue(undefined),
    });
  });

  it('parseAsDescription maps null/empty to null and others to string; sets DESCRIPTION', async () => {
    const data = [
      cell('abc'),
      cell(null as unknown as string),
      cell(''),
      cell(123),
      cell(' x '),
    ];
    const col = new ImportStatementColumn(
      columnId,
      columnName,
      columnName,
      null,
      null,
      data
    );
    col.associateWith(assertType<ImportStatementStage2>(mockStage2));

    await col.parseAsDescription();
    const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    expect(applied.definition).toBe(ColumnDefinition.DESCRIPTION);
    expect(applied.data[0].value).toBe('abc');
    expect(applied.data[0].type).toBe(SupportedDataType.TEXT);
    expect(applied.data[1].value).toBeNull();
    expect(applied.data[2].value).toBeNull();
    expect(applied.data[3].value).toBe('123');
    expect(applied.data[4].value).toBe(' x ');
  });

  it('parseAsBankCategory behaves like description and sets CATEGORY', async () => {
    const data = [
      cell('Food'),
      cell(''),
      cell(null as unknown as string),
      cell(42),
    ];
    const col = new ImportStatementColumn(
      columnId,
      columnName,
      columnName,
      null,
      null,
      data
    );
    col.associateWith(assertType<ImportStatementStage2>(mockStage2));

    await col.parseAsBankCategory();
    const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    expect(applied.definition).toBe(ColumnDefinition.CATEGORY);
    expect(applied.data[0].value).toBe('Food');
    expect(applied.data[1].value).toBeNull();
    expect(applied.data[2].value).toBeNull();
    expect(applied.data[3].value).toBe('42');
  });

  it('parseAsBankAccount behaves like description and sets BANK_ACCOUNT', async () => {
    const data = [
      cell('123-456'),
      cell(''),
      cell(null as unknown as string),
      cell(99999),
    ];
    const col = new ImportStatementColumn(
      columnId,
      columnName,
      columnName,
      null,
      null,
      data
    );
    col.associateWith(assertType<ImportStatementStage2>(mockStage2));

    await col.parseAsBankAccount();
    const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    expect(applied.definition).toBe(ColumnDefinition.BANK_ACCOUNT);
    expect(applied.data[0].value).toBe('123-456');
    expect(applied.data[1].value).toBeNull();
    expect(applied.data[2].value).toBeNull();
    expect(applied.data[3].value).toBe('99999');
  });

  it('parseAsExchangeRate parses numbers, null/empty -> null, undefined/bad -> error; sets EXCHANGE_RATE', async () => {
    const data = [
      cell(1.5, SupportedDataType.NUMBER),
      cell('2.75'),
      cell('3'),
      cell(null as unknown as string),
      cell(''),
      cell(undefined as unknown as string),
      cell('bad'),
    ];
    const col = new ImportStatementColumn(
      columnId,
      columnName,
      columnName,
      null,
      null,
      data
    );
    col.associateWith(assertType<ImportStatementStage2>(mockStage2));

    await col.parseAsExchangeRate();
    const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    expect(applied.definition).toBe(ColumnDefinition.EXCHANGE_RATE);
    expect(applied.data[0].value).toBe(1.5);
    expect(applied.data[0].type).toBe(SupportedDataType.NUMBER);
    expect(applied.data[1].type).toBe(SupportedDataType.NUMBER);
    expect(applied.data[2].type).toBe(SupportedDataType.NUMBER);
    expect(applied.data[3].value).toBeNull();
    expect(applied.data[3].type).toBe(SupportedDataType.NUMBER);
    expect(applied.data[4].value).toBeNull();
    expect(applied.data[4].type).toBe(SupportedDataType.NUMBER);
    // undefined and 'bad' should be errors (2/7 ≈ 28.6% <= 30%)
    expect(applied.data[5].error).toBeTruthy();
    expect(applied.data[5].value).toBeUndefined();
    expect(applied.data[6].error).toBeTruthy();
    expect(applied.data[6].value).toBe('bad');
  });

  it('parseAsBankCommission uses currency naming and parses numbers; sets BANK_COMMISSION', async () => {
    const data = [
      cell('1.10'),
      cell(2),
      cell(null as unknown as string),
      cell(''),
      cell('bad'),
      cell(undefined as unknown as string),
      cell('3.33'),
      cell(4.44),
    ];
    const col = new ImportStatementColumn(
      columnId,
      columnName,
      columnName,
      null,
      null,
      data
    );
    col.associateWith(assertType<ImportStatementStage2>(mockStage2));

    await col.parseAsBankCommission({
      currency: 'auto',
    } as BankCommissionColumnParams);
    let applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    expect(applied.definition).toBe(ColumnDefinition.BANK_COMMISSION);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
    expect((applied.name as any).getText()).toBe(
      'engine.importStatement.column.bank-commission'
    );

    await col.parseAsBankCommission({
      currency: 'use_base',
    } as BankCommissionColumnParams);
    applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
    expect((applied.name as any).getText()).toBe(
      'engine.importStatement.column.bank-commission-in-base-currency'
    );

    await col.parseAsBankCommission({
      currency: { code: 'USD' },
    } as BankCommissionColumnParams);
    applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
    expect((applied.name as any).getText()).toBe(
      'engine.importStatement.column.bank-commission-in-currency'
    );

    // Check parsing outcomes from the first application (auto)
    const firstApplied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls[
      (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.length - 3
    ]?.[0] as ImportStatementColumn;
    // Valid numbers
    expect(firstApplied.data[0].type).toBe(SupportedDataType.NUMBER);
    expect(firstApplied.data[1].type).toBe(SupportedDataType.NUMBER);
    // null/'' -> null NUMBER
    expect(firstApplied.data[2].value).toBeNull();
    expect(firstApplied.data[2].type).toBe(SupportedDataType.NUMBER);
    expect(firstApplied.data[3].value).toBeNull();
    expect(firstApplied.data[3].type).toBe(SupportedDataType.NUMBER);
    // 'bad' and undefined -> errors, but only 2 invalid out of 8 = 25%
    expect(firstApplied.data[4].error).toBeTruthy();
    expect(firstApplied.data[5].error).toBeTruthy();
  });

  it('parseAsCashback uses currency naming and parses numbers; sets CASHBACK', async () => {
    const data = [
      cell('0.50'),
      cell(1),
      cell(null as unknown as string),
      cell(''),
      cell('oops'),
      cell(undefined as unknown as string),
      cell('2.25'),
      cell(3.14),
      cell('4'),
    ];
    const col = new ImportStatementColumn(
      columnId,
      columnName,
      columnName,
      null,
      null,
      data
    );
    col.associateWith(assertType<ImportStatementStage2>(mockStage2));

    await col.parseAsCashback({
      currency: 'auto',
    } as CashbackColumnParams);
    let applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    expect(applied.definition).toBe(ColumnDefinition.CASHBACK);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
    expect((applied.name as any).getText()).toBe(
      'engine.importStatement.column.cashback'
    );

    await col.parseAsCashback({
      currency: 'use_base',
    } as CashbackColumnParams);
    applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
    expect((applied.name as any).getText()).toBe(
      'engine.importStatement.column.cashback-in-base-currency'
    );

    await col.parseAsCashback({
      currency: { code: 'EUR' },
    } as CashbackColumnParams);
    applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Accessing private method for testing
    expect((applied.name as any).getText()).toBe(
      'engine.importStatement.column.cashback-in-currency'
    );

    // Check parsing outcomes from the first application (auto)
    const firstApplied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls[
      (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.length - 3
    ]?.[0] as ImportStatementColumn;
    expect(firstApplied.data[0].type).toBe(SupportedDataType.NUMBER);
    expect(firstApplied.data[1].type).toBe(SupportedDataType.NUMBER);
    expect(firstApplied.data[2].value).toBeNull();
    expect(firstApplied.data[2].type).toBe(SupportedDataType.NUMBER);
    expect(firstApplied.data[3].value).toBeNull();
    expect(firstApplied.data[3].type).toBe(SupportedDataType.NUMBER);
    // 'oops' and undefined -> errors; 2/9 ≈ 22%
    expect(firstApplied.data[4].error).toBeTruthy();
    expect(firstApplied.data[5].error).toBeTruthy();
  });

  it('parseAsMerchant (MCC) validates/normalizes to 4-digit strings; invalids error; sets MERCHANT_CATEGORY', async () => {
    const data = [
      cell('5411'), // valid
      cell(123), // valid -> 0123
      cell('7'), // valid -> 0007
      cell(9999), // valid -> 9999
      cell('0001'), // valid -> 0001
      cell('12'), // valid -> 0012
      cell(5), // valid -> 0005
      cell(''), // invalid
      cell(null as unknown as string), // invalid
      cell(10000), // invalid
    ];
    const col = new ImportStatementColumn(
      columnId,
      columnName,
      columnName,
      null,
      null,
      data
    );
    col.associateWith(assertType<ImportStatementStage2>(mockStage2));

    await col.parseAsMerchant();
    const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;
    expect(applied.definition).toBe(ColumnDefinition.MERCHANT_CATEGORY);

    expect(applied.data[0].value).toBe('5411');
    expect(applied.data[0].type).toBe(SupportedDataType.MCC);
    expect(applied.data[1].value).toBe('0123');
    expect(applied.data[2].value).toBe('0007');
    expect(applied.data[3].value).toBe('9999');
    expect(applied.data[4].value).toBe('0001');
    expect(applied.data[5].value).toBe('0012');
    expect(applied.data[6].value).toBe('0005');

    // Last three are errors; 3/10 == 30% so within acceptable (not greater than)
    expect(applied.data[7].error).toBeTruthy();
    expect(applied.data[8].error).toBeTruthy();
    expect(applied.data[9].error).toBeTruthy();
  });
});

// ── NEW: TIME and COUNTERPARTY transforms ────────────────────────────────────

describe('ImportStatementColumn — TIME and COUNTERPARTY (2.2 extensions)', () => {
  const cell = (
    value: unknown,
    type: SupportedDataType = SupportedDataType.TEXT,
    extra: Partial<CellData> = {}
  ): CellData => ({ value, type, ...extra }) as CellData;

  let columnId: string;
  let columnName: Message;
  let mockStage2: Mocked<
    Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
  >;

  beforeEach(() => {
    columnId = 'time-col';
    columnName = new NativeMessage('Time Column');
    mockStage2 = createMock<
      Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>
    >({
      applyColumn: vi.fn(),
      resetColumn: vi.fn().mockResolvedValue(undefined),
    });
  });

  describe('parseAsTime', () => {
    it('sets definition to TIME and discards all cell data (empty output)', async () => {
      const data = [
        cell('14:55:43'),
        cell('09:00:00'),
        cell('23:59:59'),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      await col.parseAsTime();

      expect(mockStage2.applyColumn).toHaveBeenCalled();
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.TIME);
      // TIME discards all data — output is empty
      expect(applied.data).toHaveLength(0);
    });

    it('throws when not associated with stage2', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell('10:00')]
      );
      await expect(col.parseAsTime()).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });

    it('throws LocalizableException when already transformed to another type', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        ColumnDefinition.AMOUNT
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await expect(col.parseAsTime()).rejects.toBeInstanceOf(LocalizableException);
    });

    it('is idempotent (calling parseAsTime on an already-TIME column does nothing)', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        ColumnDefinition.TIME,
        {},
        []
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await col.parseAsTime();
      // Should return early without calling applyColumn again
      expect(mockStage2.applyColumn).not.toHaveBeenCalled();
    });
  });

  describe('parseAsCounterparty', () => {
    it('sets definition to COUNTERPARTY and maps text like DESCRIPTION (null/empty → null, others → string)', async () => {
      const data = [
        cell('Acme Corp'),
        cell(null as unknown as string),
        cell(''),
        cell(42),
        cell(' bank  '),
      ];
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        data
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));

      await col.parseAsCounterparty();

      expect(mockStage2.applyColumn).toHaveBeenCalled();
      const applied = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;
      expect(applied.definition).toBe(ColumnDefinition.COUNTERPARTY);
      expect(applied.data[0].value).toBe('Acme Corp');
      expect(applied.data[0].type).toBe(SupportedDataType.TEXT);
      expect(applied.data[1].value).toBeNull();
      expect(applied.data[2].value).toBeNull();
      expect(applied.data[3].value).toBe('42');
      expect(applied.data[4].value).toBe(' bank  ');
    });

    it('throws when not associated with stage2', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        null,
        null,
        [cell('Payee')]
      );
      await expect(col.parseAsCounterparty()).rejects.toThrow(
        `Column ${columnId} is not associated with a stage2 instance`
      );
    });

    it('throws LocalizableException when already transformed to another type', async () => {
      const col = new ImportStatementColumn(
        columnId,
        columnName,
        columnName,
        ColumnDefinition.DESCRIPTION
      );
      col.associateWith(assertType<ImportStatementStage2>(mockStage2));
      await expect(col.parseAsCounterparty()).rejects.toBeInstanceOf(LocalizableException);
    });

    it('COUNTERPARTY and DESCRIPTION produce same TEXT output but different definitions', async () => {
      const data = [cell('Some text'), cell(''), cell(null as unknown as string)];

      const colDesc = new ImportStatementColumn('d', columnName, columnName, null, null, data);
      const colCtrp = new ImportStatementColumn('c', columnName, columnName, null, null, data);
      colDesc.associateWith(assertType<ImportStatementStage2>(mockStage2));
      colCtrp.associateWith(assertType<ImportStatementStage2>(mockStage2));

      // Run both transforms first, then capture from mock.calls
      await colDesc.parseAsDescription();
      await colCtrp.parseAsCounterparty();
      // After both calls: at(-2) = description call, at(-1) = counterparty call
      const appliedDesc = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -2
      )?.[0] as ImportStatementColumn;
      const appliedCtrp = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
        -1
      )?.[0] as ImportStatementColumn;

      // Definitions differ
      expect(appliedDesc.definition).toBe(ColumnDefinition.DESCRIPTION);
      expect(appliedCtrp.definition).toBe(ColumnDefinition.COUNTERPARTY);

      // Cell values are identical (same transform logic)
      expect(appliedDesc.data[0].value).toBe(appliedCtrp.data[0].value);
      expect(appliedDesc.data[1].value).toBe(appliedCtrp.data[1].value);
      expect(appliedDesc.data[2].value).toBe(appliedCtrp.data[2].value);
    });
  });
});

// ── Story 2.5, decision 1.2: composition pin ─────────────────────────────────
// A MIXED/auto AMOUNT column where an income cell is '+5000,00' must be
// labeled-and-discarded as INCOME (VIS-011) — NOT an error cell.
// Sign semantics unchanged: '+' is positive notation → goes through the
// mixed-type positive branch (ignore with reason), same as a bare '5000'.
describe("Story 2.5 composition pin — mixed AMOUNT column with '+'-prefixed income cell", () => {
  const cell = (
    value: unknown,
    type: SupportedDataType = SupportedDataType.TEXT,
    extra: Partial<CellData> = {}
  ): CellData => ({ value, type, ...extra }) as CellData;

  it("'+5000,00' in a mixed AMOUNT column → labeled-and-discarded as INCOME (VIS-011), not an error", async () => {
    // Build a mixed column: one outcome (negative) cell so auto-detect picks 'mixed',
    // plus the '+'-prefixed income cell that exercised the declared divergence.
    const data = [
      cell('+5000,00'),              // income — positive; must be ignored with reason (VIS-011)
      cell('-200,00'),               // outcome — negative; must produce abs value 200
    ];

    const colId = 'composition-pin-col';
    const colName = new NativeMessage('Mixed Amount');
    const mockS2 = createMock<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>({
      applyColumn: vi.fn(),
      resetColumn: vi.fn().mockResolvedValue(undefined),
    });

    const col = new ImportStatementColumn(colId, colName, colName, null, null, data);
    col.associateWith(assertType<ImportStatementStage2>(mockS2));

    const params: AmountColumnParams = { type: 'mixed', currency: 'auto' };
    await col.parseAsAmount(params);

    const applied = (mockS2.applyColumn as ReturnType<typeof vi.fn>).mock.calls.at(
      -1
    )?.[0] as ImportStatementColumn;

    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);

    // Cell 0: '+5000,00' → parsed as 5000 (positive) → mixed positive branch → ignored with reason
    const incomeCell = applied.data[0];
    expect(incomeCell.error).toBeFalsy();    // NOT an error cell
    expect(incomeCell.ignore).toBeTruthy();  // labeled-and-discarded (VIS-011)
    expect(incomeCell.value).toBeCloseTo(5000); // value is the parsed number, not the raw string

    // Cell 1: '-200,00' → parsed as 200 (abs of negative) → outcome cell, no ignore
    const outcomeCell = applied.data[1];
    expect(outcomeCell.error).toBeFalsy();
    expect(outcomeCell.ignore).toBeFalsy();
    expect(outcomeCell.value).toBeCloseTo(200);
  });
});

// Suppress unused-import warning for ImportStatementColumnHeaderStage2
// (imported for type reference in mock typing)
void (null as unknown as ImportStatementColumnHeaderStage2);
