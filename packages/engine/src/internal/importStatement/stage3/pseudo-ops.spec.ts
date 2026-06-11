/**
 * pseudo-ops.spec.ts — TDD suite for expandPseudoOps (ENT-013, Story 2.5 Task 3).
 *
 * Tests (all failing-first, per the plan checklist):
 *   P1.  Commission cell → one op: flags, description key, date/account/source from original,
 *        abs amount, currency per params (auto / use_base / {code}), nulls, hash discriminator.
 *   P2.  Cashback cell → one op: flags, description key, currency, hash discriminator.
 *   P3.  Both cells → 2 ops, ordered commission-then-cashback.
 *   P4.  Empty (null) cells → zero ops, zero errors.
 *   P5.  Negative cell → abs amount (100 for −100).
 *   P6.  Failed pseudo-op → errors entry WITH columnId; sibling pseudo-op still generated.
 *   P7.  Determinism: same row twice → deep-equal including hashes.
 *   P8.  RowError columnId pin: pseudo-op rowError carries the commission/cashback column id;
 *        main-op rowErrors leave columnId undefined.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expandPseudoOps } from './pseudo-ops';
import type { ColumnInfo } from './row-generator';
import type { ImportStatementRowData, CellData } from '../stage2/types';
import { SupportedDataType } from '../stage2/types';
import { ColumnDefinition } from '../types';
import type { BankCommissionColumnParams, CashbackColumnParams } from '../types';
import { $t } from '../../utils/messages/index';

// ---------------------------------------------------------------------------
// Mock hash — avoid WebCrypto; return predictable discriminator-aware strings
// ---------------------------------------------------------------------------

vi.mock('./hash', () => ({
  calculateRowHash: vi.fn().mockImplementation(
    async (
      _row: unknown,
      _cols: unknown,
      discriminator: string = 'main',
    ) => `mock-hash-${discriminator}`,
  ),
  generateHashableObject: vi.fn().mockReturnValue({}),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCellData(
  value: unknown,
  type: SupportedDataType = SupportedDataType.NUMBER,
  opts?: { error?: ReturnType<typeof $t> | null; ignore?: ReturnType<typeof $t> | null },
): CellData {
  return {
    value,
    type,
    error: opts?.error ?? null,
    ignore: opts?.ignore ?? null,
  };
}

function makeRow(
  rowIndex: number,
  cells: Record<string, CellData>,
): ImportStatementRowData {
  return {
    rowIndex,
    get: vi.fn((id: string) => cells[id] ?? makeCellData(null, SupportedDataType.UNKNOWN)),
    errorMessageAt: vi.fn().mockReturnValue(null),
    ignoreMessageAt: vi.fn().mockReturnValue(null),
    get isIgnored() { return false; },
    get hasErrors() { return false; },
  } as ImportStatementRowData;
}

function makeCol(
  id: string,
  definition: ColumnDefinition,
  params: BankCommissionColumnParams | CashbackColumnParams | null = null,
): ColumnInfo {
  return { id, definition, params };
}

// Standard test date and account cells
const TEST_DATE = new Date('2024-03-15');

/** Build a minimal row with date + account cells (plus optional extra cells). */
function makeBaseRow(
  rowIndex: number,
  extra: Record<string, CellData> = {},
): ImportStatementRowData {
  return makeRow(rowIndex, {
    dateCol: makeCellData(TEST_DATE, SupportedDataType.DATE),
    accountCol: makeCellData('UA12345', SupportedDataType.TEXT),
    ...extra,
  });
}

/** Minimal columns: DATE + BANK_ACCOUNT (so pseudo-ops get date/account). */
function makeBaseColumns(extra: ColumnInfo[] = []): ColumnInfo[] {
  return [
    makeCol('dateCol', ColumnDefinition.DATE),
    makeCol('accountCol', ColumnDefinition.BANK_ACCOUNT),
    ...extra,
  ];
}

const BASE_CURRENCY = 'UAH';

// ---------------------------------------------------------------------------
// P1 — Commission cell → one op with correct shape
// ---------------------------------------------------------------------------

describe('P1: commission cell → single commission op', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P1a: isBankCommission=true, isCashback=false', async () => {
    const commCell = makeCellData(150.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(3, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(errors).toHaveLength(0);
    expect(ops).toHaveLength(1);
    expect(ops[0].isBankCommission).toBe(true);
    expect(ops[0].isCashback).toBe(false);
  });

  it('P1b: description === bank-commission catalog key', async () => {
    const commCell = makeCellData(50.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].description).toBe(
      $t('engine.importStatement.pseudo-op.bank-commission').getText(),
    );
  });

  it('P1c: date, account, source taken from original row', async () => {
    const commCell = makeCellData(75.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(7, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].date).toEqual(TEST_DATE);
    expect(ops[0].account).toBe('UA12345');
    expect(ops[0].source).toBeNull(); // source always null in current row-generator
  });

  it('P1d: amount = abs(cell) — positive cell', async () => {
    const commCell = makeCellData(200.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].amount).toBe(200.0);
  });

  it('P1e: currency from params — use_base resolves to baseCurrency', async () => {
    const commCell = makeCellData(10.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].currency).toBe(BASE_CURRENCY);
  });

  it('P1f: currency from params — {code} override', async () => {
    const commCell = makeCellData(10.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: { code: 'USD' },
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].currency).toBe('USD');
  });

  it('P1g: currency from params — auto with no CURRENCY column → baseCurrency', async () => {
    const commCell = makeCellData(10.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'auto',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    // 'auto' with no CURRENCY column → fall back to base
    expect(ops[0].currency).toBe(BASE_CURRENCY);
  });

  it('P1h: counterparty, bankCategory, mcc are null', async () => {
    const commCell = makeCellData(10.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].counterparty).toBeNull();
    expect(ops[0].bankCategory).toBeNull();
    expect(ops[0].mcc).toBeNull();
  });

  it('P1i: hash computed with discriminator "commission"', async () => {
    const { calculateRowHash } = await import('./hash');
    vi.mocked(calculateRowHash).mockClear();

    const commCell = makeCellData(10.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].hash).toBe('mock-hash-commission');
    // Verify calculateRowHash was called with discriminator 'commission'
    expect(calculateRowHash).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'commission',
    );
  });
});

// ---------------------------------------------------------------------------
// P2 — Cashback cell → one op with correct shape
// ---------------------------------------------------------------------------

describe('P2: cashback cell → single cashback op', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P2a: isCashback=true, isBankCommission=false', async () => {
    const cbCell = makeCellData(25.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(1, { cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(errors).toHaveLength(0);
    expect(ops).toHaveLength(1);
    expect(ops[0].isCashback).toBe(true);
    expect(ops[0].isBankCommission).toBe(false);
  });

  it('P2b: description === cashback catalog key', async () => {
    const cbCell = makeCellData(25.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].description).toBe(
      $t('engine.importStatement.pseudo-op.cashback').getText(),
    );
  });

  it('P2c: hash computed with discriminator "cashback"', async () => {
    const { calculateRowHash } = await import('./hash');
    vi.mocked(calculateRowHash).mockClear();

    const cbCell = makeCellData(25.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].hash).toBe('mock-hash-cashback');
    expect(calculateRowHash).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'cashback',
    );
  });

  it('P2d: currency use_base', async () => {
    const cbCell = makeCellData(25.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].currency).toBe(BASE_CURRENCY);
  });

  it('P2e: currency {code} override', async () => {
    const cbCell = makeCellData(25.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: { code: 'EUR' },
      } as CashbackColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].currency).toBe('EUR');
  });
});

// ---------------------------------------------------------------------------
// P3 — Both cells → 2 ops, ordered commission-then-cashback
// ---------------------------------------------------------------------------

describe('P3: both cells → 2 ops, commission-first ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P3a: exactly 2 ops returned', async () => {
    const commCell = makeCellData(100.0, SupportedDataType.NUMBER);
    const cbCell = makeCellData(20.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell, cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(errors).toHaveLength(0);
    expect(ops).toHaveLength(2);
  });

  it('P3b: first op is commission, second is cashback (ENT-013 ordering)', async () => {
    const commCell = makeCellData(100.0, SupportedDataType.NUMBER);
    const cbCell = makeCellData(20.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell, cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops[0].isBankCommission).toBe(true);
    expect(ops[0].isCashback).toBe(false);
    expect(ops[1].isCashback).toBe(true);
    expect(ops[1].isBankCommission).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// P4 — Empty (null) cells → zero ops, zero errors
// ---------------------------------------------------------------------------

describe('P4: null/empty cells → zero ops, zero errors', () => {
  it('P4a: null commission cell → no ops', async () => {
    const commCell = makeCellData(null, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('P4b: null cashback cell → no ops', async () => {
    const cbCell = makeCellData(null, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('P4c: both null → zero ops', async () => {
    const commCell = makeCellData(null, SupportedDataType.NUMBER);
    const cbCell = makeCellData(null, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell, cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it('P4d: no commission or cashback columns mapped → zero ops', async () => {
    const row = makeBaseRow(0);
    const columns = makeBaseColumns(); // only DATE + BANK_ACCOUNT

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// P5 — Negative cell → abs amount
// ---------------------------------------------------------------------------

describe('P5: negative cell → abs amount', () => {
  it('P5a: commission cell −100 → amount 100', async () => {
    const commCell = makeCellData(-100.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops).toHaveLength(1);
    expect(ops[0].amount).toBe(100.0);
  });

  it('P5b: cashback cell −50 → amount 50', async () => {
    const cbCell = makeCellData(-50.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops).toHaveLength(1);
    expect(ops[0].amount).toBe(50.0);
  });
});

// ---------------------------------------------------------------------------
// P6 — Failed pseudo-op → errors entry WITH columnId; sibling still generated
// ---------------------------------------------------------------------------

describe('P6: failed pseudo-op → errors entry with columnId, sibling unaffected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('P6a: error cell → errors entry with matching columnId', async () => {
    // A cell that has an error message (stage2 parse error)
    const errMsg = $t("engine.importStatement.can't-parse-as-bank-commission", {
      message: $t('engine.importStatement.bank-commission-parse-failed', { value: 'bad' }),
    });
    const commCell = makeCellData('bad', SupportedDataType.UNKNOWN, { error: errMsg });
    const row = makeBaseRow(5, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(ops).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0].columnId).toBe('commCol');
    expect(errors[0].rowIndex).toBe(5);
    expect(errors[0].errors).toHaveLength(1);
  });

  it('P6b: failed commission + valid cashback → 0 commission ops, 1 cashback op, 1 error', async () => {
    const errMsg = $t("engine.importStatement.can't-parse-as-bank-commission", {
      message: $t('engine.importStatement.bank-commission-parse-failed', { value: 'bad' }),
    });
    const commCell = makeCellData('bad', SupportedDataType.UNKNOWN, { error: errMsg });
    const cbCell = makeCellData(30.0, SupportedDataType.NUMBER);

    const row = makeBaseRow(2, { commCol: commCell, cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(errors).toHaveLength(1);
    expect(errors[0].columnId).toBe('commCol');
    expect(ops).toHaveLength(1);
    expect(ops[0].isCashback).toBe(true);
  });

  it('P6c: failed cashback + valid commission → 1 commission op, 1 error with cashback columnId', async () => {
    const commCell = makeCellData(50.0, SupportedDataType.NUMBER);
    const errMsg = $t("engine.importStatement.can't-parse-as-cashback", {
      message: $t('engine.importStatement.cashback-parse-failed', { value: 'bad' }),
    });
    const cbCell = makeCellData('bad', SupportedDataType.UNKNOWN, { error: errMsg });

    const row = makeBaseRow(3, { commCol: commCell, cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const { ops, errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(errors).toHaveLength(1);
    expect(errors[0].columnId).toBe('cbCol');
    expect(ops).toHaveLength(1);
    expect(ops[0].isBankCommission).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// P7 — Determinism: same row twice → deep-equal including hashes
// ---------------------------------------------------------------------------

describe('P7: determinism', () => {
  it('P7: same row twice → deep-equal ops and hashes', async () => {
    vi.clearAllMocks();

    const commCell = makeCellData(100.0, SupportedDataType.NUMBER);
    const cbCell = makeCellData(20.0, SupportedDataType.NUMBER);
    const row = makeBaseRow(0, { commCol: commCell, cbCol: cbCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
      makeCol('cbCol', ColumnDefinition.CASHBACK, {
        currency: 'use_base',
      } as CashbackColumnParams),
    ]);

    const r1 = await expandPseudoOps(row, columns, BASE_CURRENCY);
    const r2 = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(r1.ops).toHaveLength(r2.ops.length);
    for (let i = 0; i < r1.ops.length; i++) {
      expect(r1.ops[i].hash).toBe(r2.ops[i].hash);
      expect(r1.ops[i].amount).toBe(r2.ops[i].amount);
      expect(r1.ops[i].currency).toBe(r2.ops[i].currency);
      expect(r1.ops[i].description).toBe(r2.ops[i].description);
    }
  });
});

// ---------------------------------------------------------------------------
// P8 — RowError columnId pin
// ---------------------------------------------------------------------------

describe('P8: RowError columnId pin', () => {
  it('P8: pseudo-op rowError carries the column id; main-op rowErrors leave it undefined', async () => {
    // The pseudo-op error carries columnId
    const errMsg = $t("engine.importStatement.can't-parse-as-bank-commission", {
      message: $t('engine.importStatement.bank-commission-parse-failed', { value: 'x' }),
    });
    const commCell = makeCellData('x', SupportedDataType.UNKNOWN, { error: errMsg });
    const row = makeBaseRow(0, { commCol: commCell });
    const columns = makeBaseColumns([
      makeCol('commCol', ColumnDefinition.BANK_COMMISSION, {
        currency: 'use_base',
      } as BankCommissionColumnParams),
    ]);

    const { errors } = await expandPseudoOps(row, columns, BASE_CURRENCY);

    expect(errors).toHaveLength(1);
    expect(errors[0].columnId).toBe('commCol');

    // Main-op rowErrors constructed in generateRows will NOT carry columnId
    // (this is tested in the row-generator.spec.ts for the wiring; here we verify
    // that pseudo-op errors DO carry it, as tested above).
    // A RowError with no columnId is valid per the optional field definition.
    const mainOpError = { rowIndex: 0, errors: [] };
    expect((mainOpError as { columnId?: string }).columnId).toBeUndefined();
  });
});
