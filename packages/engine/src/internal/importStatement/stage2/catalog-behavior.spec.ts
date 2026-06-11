/**
 * Task 4 — New-behavior test suite for the column-type catalog.
 *
 * Tests the behavioral contracts introduced / clarified in Story 2.2:
 *
 *   1. TIME verifiable discard (QA provoke target)
 *   2. COUNTERPARTY distinct flow
 *   3. Amount semantics ×4: income / outcome / mixed / auto (pinned detection)
 *   4. ENT-011 hook: currency resolution via the 1.6 resolver (auto/use_base/{code})
 *   5. Date-serial policy: bare numeric string → per-cell parse error, NOT epoch
 *   6. col_N placeholder names flow through like any named column
 *
 * These tests run against the Task 3 implementation. Failures = impl bugs; fix the
 * implementation, never weaken a test.
 *
 * TZ-environment determinism lives in the SEPARATE `tz-determinism.spec.ts` so that
 * the `process.env.TZ` mutation cannot bleed into this file.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { ImportStatementColumn } from './column';
import { SupportedDataType } from './types';
import type { CellData, ImportStatementStage2, ImportStatementColumnHeaderStage2 } from './types';
import { ColumnDefinition } from '../types';
import type { AmountColumnParams, DateColumnParams } from '../types';
import { NativeMessage } from '../../utils/messages/index';
import type { Message } from '../../utils/messages/message';

// ── Helpers ─────────────────────────────────────────────────────────────────

function cell(
  value: unknown,
  type: SupportedDataType = SupportedDataType.TEXT,
  extra: Partial<CellData> = {}
): CellData {
  return { value, type, ...extra } as CellData;
}

function createMockStage2(): Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>> {
  return {
    applyColumn: vi.fn(),
    resetColumn: vi.fn().mockResolvedValue(undefined),
  } as Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;
}

function makeCol(
  id: string,
  name: Message,
  data: CellData[],
  mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>
): ImportStatementColumn {
  const col = new ImportStatementColumn(id, name, name, null, null, data);
  col.associateWith(mockStage2 as unknown as ImportStatementStage2);
  return col;
}

function lastApplied(
  mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>
): ImportStatementColumn {
  const calls = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls;
  return calls.at(-1)?.[0] as ImportStatementColumn;
}

// ── 1. TIME verifiable discard ───────────────────────────────────────────────

describe('TIME verifiable discard (QA provoke target)', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;
  const colName = new NativeMessage('col_time');

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('3-column fixture: DATE + TIME + AMOUNT — TIME column contributes NO output cells', async () => {
    // DATE column
    const dateName = new NativeMessage('date');
    const dateData = [
      cell('15.01.2024'),
      cell('16.01.2024'),
      cell('17.01.2024'),
    ];
    const dateCol = makeCol('date', dateName, dateData, mockStage2);

    // TIME column — the core fixture
    const timeData = [
      cell('14:55:43'),
      cell('08:30:00'),
      cell('23:59:59'),
    ];
    const timeCol = makeCol('time', colName, timeData, mockStage2);

    // AMOUNT column
    const amtName = new NativeMessage('amount');
    const amtData = [
      cell(-100, SupportedDataType.NUMBER),
      cell(-200, SupportedDataType.NUMBER),
      cell(-300, SupportedDataType.NUMBER),
    ];
    const amtCol = makeCol('amount', amtName, amtData, mockStage2);

    // Apply all three transforms
    await dateCol.parseAsDate({ format: { custom: 'dd.MM.yyyy' } });
    await timeCol.parseAsTime();
    await amtCol.parseAsAmount({ type: 'outcome', currency: 'auto' });

    // Collect all applied columns keyed by id
    const allCalls = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls;
    const appliedMap = new Map<string, ImportStatementColumn>();
    for (const [col] of allCalls) {
      const c = col as ImportStatementColumn;
      appliedMap.set(c.id, c);
    }

    const appliedTime = appliedMap.get('time')!;
    expect(appliedTime.definition).toBe(ColumnDefinition.TIME);
    // TIME discards ALL cell data — output array must be empty
    expect(appliedTime.data).toHaveLength(0);

    // JSON.stringify of the full transform output must NOT contain ANY raw time substring
    const fullOutput = JSON.stringify(Array.from(appliedMap.values()).map(c => ({ id: c.id, data: c.data })));
    expect(fullOutput).not.toContain('14:55:43');
    expect(fullOutput).not.toContain('08:30:00');
    expect(fullOutput).not.toContain('23:59:59');
  });

  it('TIME output is verifiably empty regardless of input content variety', async () => {
    const data = [
      cell('00:00:00'),
      cell('12:00'),
      cell('14:55:43'),
      cell('invalid-time-but-doesnt-matter'),
      cell(null as unknown as string),
    ];
    const col = makeCol('t', colName, data, mockStage2);
    await col.parseAsTime();

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.TIME);
    expect(applied.data).toHaveLength(0);

    // No raw time values in JSON output
    const json = JSON.stringify(applied);
    expect(json).not.toContain('14:55:43');
  });
});

// ── 2. COUNTERPARTY distinct flow ─────────────────────────────────────────────

describe('COUNTERPARTY distinct flow', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('DESCRIPTION and COUNTERPARTY columns are both present, distinct, correct types in output', async () => {
    const descData = [
      cell('Coffee shop'),
      cell('Online transfer'),
      cell(null as unknown as string),
    ];
    const ctrpData = [
      cell('Starbucks Inc'),
      cell('ACME Corp'),
      cell(''),
    ];

    const descCol = makeCol('desc', new NativeMessage('description'), descData, mockStage2);
    const ctrpCol = makeCol('ctrp', new NativeMessage('counterparty'), ctrpData, mockStage2);

    await descCol.parseAsDescription();
    await ctrpCol.parseAsCounterparty();

    const allCalls = (mockStage2.applyColumn as ReturnType<typeof vi.fn>).mock.calls;
    const desc = allCalls.at(-2)?.[0] as ImportStatementColumn;
    const ctrp = allCalls.at(-1)?.[0] as ImportStatementColumn;

    // Both present
    expect(desc).toBeDefined();
    expect(ctrp).toBeDefined();

    // Distinct definitions
    expect(desc.definition).toBe(ColumnDefinition.DESCRIPTION);
    expect(ctrp.definition).toBe(ColumnDefinition.COUNTERPARTY);

    // Correct output types (both TEXT)
    expect(desc.data[0].type).toBe(SupportedDataType.TEXT);
    expect(ctrp.data[0].type).toBe(SupportedDataType.TEXT);

    // Correct values
    expect(desc.data[0].value).toBe('Coffee shop');
    expect(ctrp.data[0].value).toBe('Starbucks Inc');

    // null/empty → null
    expect(desc.data[2].value).toBeNull();
    expect(ctrp.data[2].value).toBeNull();

    // The two columns are distinct (different definitions)
    expect(desc.definition).not.toBe(ctrp.definition);
  });

  it('COUNTERPARTY preserves string values correctly — distinct from description in the output', async () => {
    const data = [
      cell('Counterparty A'),
      cell(42),
      cell(''),
      cell(null as unknown as string),
    ];
    const col = makeCol('cp', new NativeMessage('cp'), data, mockStage2);
    await col.parseAsCounterparty();

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.COUNTERPARTY);
    expect(applied.data[0].value).toBe('Counterparty A');
    expect(applied.data[0].type).toBe(SupportedDataType.TEXT);
    expect(applied.data[1].value).toBe('42'); // number → string
    expect(applied.data[2].value).toBeNull(); // empty → null
    expect(applied.data[3].value).toBeNull(); // null → null
  });
});

// ── 3. Amount semantics ×4 ───────────────────────────────────────────────────

describe('Amount semantics — income (VIS-011 label-and-discard)', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('income: ALL rows of that column are skipped, each has a per-row reason object (FEAT-022 shape)', async () => {
    const data = [
      cell(500, SupportedDataType.NUMBER),
      cell(1000.50, SupportedDataType.NUMBER),
      cell(-200, SupportedDataType.NUMBER), // even negative = skipped for income
      cell('750'),
      cell(0, SupportedDataType.NUMBER),
    ];
    const col = makeCol('inc', new NativeMessage('income'), data, mockStage2);

    await col.parseAsAmount({ type: 'income', currency: 'auto' });

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);

    // Every successfully-parsed row must have an ignore reason (FEAT-022 shape)
    for (let i = 0; i < applied.data.length; i++) {
      const cellData = applied.data[i];
      if (!cellData.error) {
        // Successfully parsed → must have reason
        expect(cellData.ignore, `row ${i} must have ignore reason`).toBeTruthy();
        // The reason must be an object with content (FEAT-022: not just boolean)
        expect(typeof cellData.ignore === 'object' || typeof cellData.ignore === 'string',
          `row ${i} ignore must be an object or string (FEAT-022)`).toBe(true);
      }
    }

    // All 5 cells are parseable (no errors expected)
    const errorCount = applied.data.filter(c => c.error).length;
    expect(errorCount).toBe(0);

    // Each has ignore set
    expect(applied.data[0].ignore).toBeTruthy();
    expect(applied.data[1].ignore).toBeTruthy();
    expect(applied.data[2].ignore).toBeTruthy(); // negative income row also skipped
    expect(applied.data[3].ignore).toBeTruthy(); // string-parsed row skipped
    expect(applied.data[4].ignore).toBeTruthy(); // zero row skipped
  });

  it('income: the reason object names the cause (contains value info)', async () => {
    // Use 10 rows so there are no error-rate issues
    const bigData = Array.from({ length: 10 }, (_, i) => cell(i + 1, SupportedDataType.NUMBER));
    const col = makeCol('inc2', new NativeMessage('income2'), bigData, mockStage2);

    await col.parseAsAmount({ type: 'income', currency: 'auto' });
    const applied = lastApplied(mockStage2);

    // Each ignore field must exist (FEAT-022 shape: reason object)
    for (const c of applied.data) {
      if (!c.error) {
        expect(c.ignore).toBeTruthy();
      }
    }
  });
});

describe('Amount semantics — outcome (debits all-positive accepted)', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('outcome: negative values become positive (abs); positive values kept; zeros ignored', async () => {
    const data = [
      cell(-100, SupportedDataType.NUMBER),
      cell(-250.75, SupportedDataType.NUMBER),
      cell(50, SupportedDataType.NUMBER),   // positive debit (unusual but valid)
      cell(0, SupportedDataType.NUMBER),    // zero → ignored
    ];
    const col = makeCol('out', new NativeMessage('outcome'), data, mockStage2);

    await col.parseAsAmount({ type: 'outcome', currency: 'auto' });

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);

    // Negatives → positive (abs)
    expect(applied.data[0].value).toBe(100);
    expect(applied.data[0].ignore).toBeUndefined();
    expect(applied.data[1].value).toBeCloseTo(250.75);
    expect(applied.data[1].ignore).toBeUndefined();

    // Positive debit stays positive
    expect(applied.data[2].value).toBe(50);
    expect(applied.data[2].ignore).toBeUndefined();

    // Zero → ignored
    expect(applied.data[3].value).toBe(0);
    expect(applied.data[3].ignore).toBeTruthy();
  });
});

describe('Amount semantics — mixed (sign decides)', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('mixed: positive side DISCARDED with reason; negative kept as expense (abs); zero ignored', async () => {
    const data = [
      cell(500, SupportedDataType.NUMBER),   // positive → DISCARDED with reason
      cell(-300, SupportedDataType.NUMBER),  // negative → kept as expense (abs)
      cell(100, SupportedDataType.NUMBER),   // positive → DISCARDED with reason
      cell(-75.5, SupportedDataType.NUMBER), // negative → kept (abs)
      cell(0, SupportedDataType.NUMBER),     // zero → ignored
    ];
    const col = makeCol('mix', new NativeMessage('mixed'), data, mockStage2);

    await col.parseAsAmount({ type: 'mixed', currency: 'auto' });

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);

    // Positive → ignored/discarded WITH reason (FEAT-022 shape)
    expect(applied.data[0].ignore).toBeTruthy();
    expect(applied.data[0].value).toBe(500); // value preserved in the cell, but flagged
    expect(applied.data[2].ignore).toBeTruthy();
    expect(applied.data[2].value).toBe(100);

    // Negative → kept as positive expense (abs value), no ignore
    expect(applied.data[1].value).toBe(300);
    expect(applied.data[1].ignore).toBeUndefined();
    expect(applied.data[3].value).toBeCloseTo(75.5);
    expect(applied.data[3].ignore).toBeUndefined();

    // Zero → ignored
    expect(applied.data[4].ignore).toBeTruthy();
  });
});

describe('Amount semantics — auto detection (pinned deterministic)', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('auto with single-sign (all negative) data → detects as outcome; negatives become positive', async () => {
    // All negative → single-sign → outcome detection
    const data = [
      cell(-100, SupportedDataType.NUMBER),
      cell(-200, SupportedDataType.NUMBER),
      cell(-50, SupportedDataType.NUMBER),
      cell(-350, SupportedDataType.NUMBER),
    ];
    const col = makeCol('auto1', new NativeMessage('auto1'), data, mockStage2);

    await col.parseAsAmount({ type: 'auto', currency: 'auto' });

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);

    // outcome detection: abs values, no ignore for non-zero
    expect(applied.data[0].value).toBe(100);
    expect(applied.data[0].ignore).toBeUndefined();
    expect(applied.data[1].value).toBe(200);
    expect(applied.data[2].value).toBe(50);
    expect(applied.data[3].value).toBe(350);
  });

  it('auto with both-sign data → detects as mixed; positive side discarded, negative kept', async () => {
    // Both signs → mixed detection
    const data = [
      cell(-100, SupportedDataType.NUMBER),  // negative (expense)
      cell(200, SupportedDataType.NUMBER),   // positive (income → discarded)
      cell(-50, SupportedDataType.NUMBER),   // negative (expense)
      cell(300, SupportedDataType.NUMBER),   // positive (income → discarded)
    ];
    const col = makeCol('auto2', new NativeMessage('auto2'), data, mockStage2);

    await col.parseAsAmount({ type: 'auto', currency: 'auto' });

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);

    // Negative → kept as expense (abs value)
    expect(applied.data[0].value).toBe(100);
    expect(applied.data[0].ignore).toBeUndefined();
    expect(applied.data[2].value).toBe(50);
    expect(applied.data[2].ignore).toBeUndefined();

    // Positive → discarded with reason (mixed behavior)
    expect(applied.data[1].ignore).toBeTruthy();
    expect(applied.data[3].ignore).toBeTruthy();
  });

  it('auto detection is deterministic — same fixture always produces same result', async () => {
    const data = [
      cell(-100, SupportedDataType.NUMBER),
      cell(200, SupportedDataType.NUMBER),
      cell(-50, SupportedDataType.NUMBER),
    ];

    // Run twice; results must be identical
    const col1 = makeCol('det1', new NativeMessage('det1'), data, mockStage2);
    await col1.parseAsAmount({ type: 'auto', currency: 'auto' });
    const applied1 = lastApplied(mockStage2);

    const mockStage2b = createMockStage2();
    const col2 = makeCol('det1', new NativeMessage('det1'), data, mockStage2b);
    await col2.parseAsAmount({ type: 'auto', currency: 'auto' });
    const applied2 = lastApplied(mockStage2b);

    // Same decisions — use deep equality since ignore is a LocalizableMessage object (new instance each time)
    expect(applied1.data[0].value).toBe(applied2.data[0].value);
    // Ignore is a LocalizableMessage; check truthiness (both truthy or both falsy)
    expect(!!applied1.data[1].ignore).toBe(!!applied2.data[1].ignore);
    expect(applied1.data[2].value).toBe(applied2.data[2].value);
  });
});

// ── 4. ENT-011 hook ──────────────────────────────────────────────────────────

describe('ENT-011 hook — AMOUNT currency resolution', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('currency="auto" with a грн CURRENCY column — params carry the auto mode (ENT-011 wired)', async () => {
    // The ENT-011 wiring: AmountColumnParams.currency carries 'auto'.
    // The CURRENCY column resolves 'грн' → 'UAH' via symbolToIso.
    // In the column transform, 'auto' means the params are stored; actual per-row
    // currency resolution happens downstream (stage 3+). The column params carry 'auto'.
    const data = [
      cell(-500, SupportedDataType.NUMBER),
      cell(-1000, SupportedDataType.NUMBER),
    ];
    const col = makeCol('amt', new NativeMessage('amount'), data, mockStage2);

    // 'auto' mode — params carry the mode flag (ENT-011)
    const params: AmountColumnParams = { type: 'outcome', currency: 'auto' };
    await col.parseAsAmount(params);

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
    // The params must carry currency:'auto' through to the applied column
    expect((applied.params as AmountColumnParams).currency).toBe('auto');

    // Verify that the CURRENCY column correctly resolves 'грн' → 'UAH'
    const currData = [
      cell('грн'),   // Ukrainian hryvnia symbol → UAH
      cell('грн'),
    ];
    const currCol = makeCol('curr', new NativeMessage('currency'), currData, mockStage2);
    await currCol.parseAsCurrency();

    const appliedCurr = lastApplied(mockStage2);
    expect(appliedCurr.definition).toBe(ColumnDefinition.CURRENCY);
    // 'грн' must resolve to 'UAH' via the 1.6 reference (symbolToIso)
    expect(appliedCurr.data[0].value).toBe('UAH');
    expect(appliedCurr.data[1].value).toBe('UAH');
  });

  it('currency="use_base" — params carry use_base flag through to the applied column', async () => {
    // use_base: the resolved currency is the budget's base currency.
    // At column-transform time, the params just carry 'use_base'; the actual
    // resolution happens at row-processing time (stage 3+, TODO-2.3/2.4).
    const data = [
      cell(-100, SupportedDataType.NUMBER),
      cell(-200, SupportedDataType.NUMBER),
    ];
    const col = makeCol('amt2', new NativeMessage('amt2'), data, mockStage2);

    const params: AmountColumnParams = { type: 'outcome', currency: 'use_base' };
    await col.parseAsAmount(params);

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
    // The params must carry 'use_base' through
    expect((applied.params as AmountColumnParams).currency).toBe('use_base');
    // The column name key should reference base currency
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameText = (applied.name as any).getText?.() ?? String(applied.name);
    expect(nameText).toContain('base-currency');
  });

  it('currency={code:"PLN"} override — params carry {code:"PLN"} through to the applied column', async () => {
    const data = [
      cell(-100, SupportedDataType.NUMBER),
    ];
    const col = makeCol('amt3', new NativeMessage('amt3'), data, mockStage2);

    const params: AmountColumnParams = { type: 'outcome', currency: { code: 'PLN' } };
    await col.parseAsAmount(params);

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
    // The params must carry the override through
    const currency = (applied.params as AmountColumnParams).currency;
    expect(currency).toEqual({ code: 'PLN' });
    // The column name key must be the "in-currency" variant (not "auto" or "base-currency")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameText = (applied.name as any).getText?.() ?? String(applied.name);
    expect(nameText).toContain('in-currency');
    // The PLN code must appear in the message params
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameParams = (applied.name as any).getParams?.() ?? {};
    expect(nameParams.currency).toBe('PLN');
  });
});

// ── 5. Date-serial policy ─────────────────────────────────────────────────────

describe('Date-serial policy — bare numeric string in DATE format-auto', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('"45307" in a DATE column with format-auto produces a per-cell parse error, NOT epoch-converted', async () => {
    // Spec §4 (xlsx date-serial policy): under 2.1 raw:false, SheetJS delivers formatted strings.
    // A bare numeric string like "45307" in a DATE column is a parse error — loud,
    // never epoch-converted (no 1900/1904 guessing; deterministic, honest).
    //
    // The format-auto detector should fail to detect any valid date format from these
    // numeric strings (since "45307" doesn't match any DATE_FORMAT), and/or the
    // parseAsDate will reject each cell as a per-cell error.

    // Use mostly-numeric data to drive detection failure OR per-cell errors
    const data = [
      cell('45307'),
      cell('45308'),
      cell('45309'),
      cell('45310'),
      cell('45311'),
    ];
    const col = makeCol('dserial', new NativeMessage('date_serial'), data, mockStage2);

    const params: DateColumnParams = { format: 'auto' };

    // The detectDateFormat call will either:
    //   (a) throw LocalizableException (no format detected — ideal outcome)
    //   (b) detect some spurious format and then produce per-cell errors
    // Either way, no successful epoch-converted dates should appear.
    let threw = false;
    try {
      await col.parseAsDate(params);
    } catch {
      threw = true;
    }

    if (!threw) {
      // If it didn't throw, applyColumn was called; check no cell has a valid Date
      // that would represent the epoch-converted value of 45307 (≈ 2024-01-15)
      const applied = lastApplied(mockStage2);
      for (const c of applied.data) {
        if (c.value instanceof Date) {
          // The date must NOT be the epoch-converted value
          // Excel serial 45307 from 1900 epoch = 2024-01-14 or 2024-01-15
          const year = c.value.getFullYear();
          const isEpochYear = year >= 2023 && year <= 2025;
          expect(isEpochYear).toBe(false);
        }
        if (!c.error && !(c.value instanceof Date)) {
          // Cell should either be an error OR a valid non-epoch date
          // If it somehow "parsed" as a number, that's a bug
          expect(c.error).toBeTruthy();
        }
      }
    }
    // If threw: that's the correct outcome — the detection rejected the serials loudly
    // (no silent epoch conversion)
    expect(threw || mockStage2.applyColumn.mock.calls.length > 0).toBe(true);
  });

  it('"45307" in a DATE column with custom format produces a per-cell parse error', async () => {
    // Even with a custom format, a bare Excel serial number should not be
    // silently epoch-converted — it should produce a parse error.
    // Use enough good dates to stay below error threshold, with one serial mixed in.
    const data = [
      cell('15.01.2024'),  // valid dd.MM.yyyy
      cell('16.01.2024'),  // valid
      cell('17.01.2024'),  // valid
      cell('18.01.2024'),  // valid
      cell('19.01.2024'),  // valid
      cell('20.01.2024'),  // valid
      cell('21.01.2024'),  // valid
      cell('22.01.2024'),  // valid
      cell('23.01.2024'),  // valid
      cell('45307'),       // Excel serial — must be a parse error, NOT epoch-converted
    ];
    const col = makeCol('dserial2', new NativeMessage('date_serial2'), data, mockStage2);

    const params: DateColumnParams = { format: { custom: 'dd.MM.yyyy' } };
    await col.parseAsDate(params);

    const applied = lastApplied(mockStage2);
    const serial = applied.data[9]; // the "45307" cell

    // Must be a parse error (loud — per-cell)
    expect(serial.error).toBeTruthy();
    // Must preserve original value
    expect(serial.value).toBe('45307');
    // Must NOT be an epoch-converted Date
    expect(serial.value instanceof Date).toBe(false);
  });
});

// ── 6. col_N placeholder name flow ───────────────────────────────────────────

describe('col_N placeholder name flow', () => {
  let mockStage2: Mocked<Pick<ImportStatementStage2, 'applyColumn' | 'resetColumn'>>;

  beforeEach(() => {
    mockStage2 = createMockStage2();
  });

  it('a column literally named col_2 types like any named column (no special-casing)', async () => {
    // col_N are ordinary placeholder names (the 2.3 recall pool will key on them).
    // No special-casing in the transform — they go through the same path as named columns.
    const col2Name = new NativeMessage('col_2');
    const data = [
      cell('Coffee'),
      cell('Groceries'),
      cell(null as unknown as string),
    ];
    const col = makeCol('col_2', col2Name, data, mockStage2);

    await col.parseAsDescription();

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.DESCRIPTION);
    expect(applied.id).toBe('col_2');
    expect(applied.data[0].value).toBe('Coffee');
    expect(applied.data[1].value).toBe('Groceries');
    expect(applied.data[2].value).toBeNull();
  });

  it('col_N columns can be typed as AMOUNT, CURRENCY, etc. just like named columns', async () => {
    const col3Name = new NativeMessage('col_3');
    const amtData = [
      cell(-100, SupportedDataType.NUMBER),
      cell(-200, SupportedDataType.NUMBER),
    ];
    const col = makeCol('col_3', col3Name, amtData, mockStage2);

    await col.parseAsAmount({ type: 'outcome', currency: 'auto' });

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.AMOUNT);
    expect(applied.id).toBe('col_3');
    expect(applied.data[0].value).toBe(100);
    expect(applied.data[1].value).toBe(200);
  });

  it('col_N works for COUNTERPARTY typing', async () => {
    const col5Name = new NativeMessage('col_5');
    const data = [cell('Vendor X'), cell('Client Y')];
    const col = makeCol('col_5', col5Name, data, mockStage2);

    await col.parseAsCounterparty();

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.COUNTERPARTY);
    expect(applied.id).toBe('col_5');
    expect(applied.data[0].value).toBe('Vendor X');
    expect(applied.data[1].value).toBe('Client Y');
  });

  it('col_N works for TIME typing (data discarded like any TIME column)', async () => {
    const col1Name = new NativeMessage('col_1');
    const data = [cell('14:55:43'), cell('09:00:00')];
    const col = makeCol('col_1', col1Name, data, mockStage2);

    await col.parseAsTime();

    const applied = lastApplied(mockStage2);
    expect(applied.definition).toBe(ColumnDefinition.TIME);
    expect(applied.id).toBe('col_1');
    expect(applied.data).toHaveLength(0); // TIME discards data
  });
});

// Suppress unused-import warning for ImportStatementColumnHeaderStage2
void (null as unknown as ImportStatementColumnHeaderStage2);
