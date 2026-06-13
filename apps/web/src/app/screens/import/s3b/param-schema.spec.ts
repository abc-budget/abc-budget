/**
 * param-schema.spec.ts — tests for PARAM_SCHEMA, paramDefaults, and
 * buildEngineParams (Task 2, 2.8).
 *
 * Shape assertions are structural (no engine import — NFR-003 fence).
 * Comments reference the engine types in packages/engine/src/internal/
 * importStatement/types.ts.
 */
import { describe, expect, it } from 'vitest';
import { PARAM_SCHEMA, buildEngineParams, paramDefaults, paramSchema } from './param-schema';

/* ── PARAM_SCHEMA presence ──────────────────────────────────────────────── */

describe('PARAM_SCHEMA', () => {
  it('has entries for the six configurable types', () => {
    expect(Object.keys(PARAM_SCHEMA).sort()).toEqual(
      ['amount', 'balance', 'bank_commission', 'cashback', 'date', 'status'].sort(),
    );
  });

  it('date schema has one field: format with options auto + custom', () => {
    const [fmt] = PARAM_SCHEMA.date;
    expect(fmt.key).toBe('format');
    expect(fmt.def).toBe('auto');
    expect(fmt.options.map((o) => o.val)).toEqual(['auto', 'custom']);
    expect(fmt.custom?.when).toBe('custom');
    expect(fmt.custom?.kind).toBe('text');
  });

  it('amount schema has two fields: currency (first) and type (second)', () => {
    const [cur, typ] = PARAM_SCHEMA.amount;
    expect(cur.key).toBe('currency');
    expect(cur.options.map((o) => o.val)).toEqual(['auto', 'use_base', 'code']);
    expect(cur.custom?.when).toBe('code');
    expect(typ.key).toBe('type');
    expect(typ.def).toBe('auto');
    expect(typ.options.map((o) => o.val)).toEqual(['income', 'outcome', 'mixed', 'auto']);
  });

  it('balance / bank_commission / cashback each have one field: currency', () => {
    for (const key of ['balance', 'bank_commission', 'cashback'] as const) {
      const [cur] = PARAM_SCHEMA[key];
      expect(cur.key, `${key}.currency`).toBe('currency');
      expect(cur.def, `${key}.currency.def`).toBe('auto');
    }
  });

  it('status schema has one field: successValue with options auto + useValue', () => {
    const [sv] = PARAM_SCHEMA.status;
    expect(sv.key).toBe('successValue');
    expect(sv.def).toBe('auto');
    expect(sv.options.map((o) => o.val)).toEqual(['auto', 'useValue']);
    expect(sv.custom?.when).toBe('useValue');
    expect(sv.custom?.kind).toBe('select');
  });
});

/* ── paramSchema() / paramDefaults() ───────────────────────────────────── */

describe('paramSchema', () => {
  it('returns [] for types with no params', () => {
    for (const t of ['description', 'currency', 'bank_account', 'merchant_category',
      'exchange_rate', 'category', 'time', 'counterparty', 'ignore', 'unknown', 'xyz']) {
      expect(paramSchema(t), t).toEqual([]);
    }
  });

  it('returns the fields for the six param types', () => {
    expect(paramSchema('date')).toHaveLength(1);
    expect(paramSchema('amount')).toHaveLength(2);
    expect(paramSchema('balance')).toHaveLength(1);
    expect(paramSchema('bank_commission')).toHaveLength(1);
    expect(paramSchema('cashback')).toHaveLength(1);
    expect(paramSchema('status')).toHaveLength(1);
  });
});

describe('paramDefaults', () => {
  it('date → { format: "auto" }', () => {
    expect(paramDefaults('date')).toEqual({ format: 'auto' });
  });

  it('amount → { currency: "auto", type: "auto" }', () => {
    expect(paramDefaults('amount')).toEqual({ currency: 'auto', type: 'auto' });
  });

  it('balance → { currency: "auto" }', () => {
    expect(paramDefaults('balance')).toEqual({ currency: 'auto' });
  });

  it('bank_commission → { currency: "auto" }', () => {
    expect(paramDefaults('bank_commission')).toEqual({ currency: 'auto' });
  });

  it('cashback → { currency: "auto" }', () => {
    expect(paramDefaults('cashback')).toEqual({ currency: 'auto' });
  });

  it('status → { successValue: "auto" }', () => {
    expect(paramDefaults('status')).toEqual({ successValue: 'auto' });
  });

  it('non-param types return {}', () => {
    expect(paramDefaults('description')).toEqual({});
    expect(paramDefaults('ignore')).toEqual({});
    expect(paramDefaults('unknown')).toEqual({});
  });
});

/* ── buildEngineParams ──────────────────────────────────────────────────── */

describe('buildEngineParams — date', () => {
  // Engine shape: DateColumnParams { format: 'auto' | { custom: string } }

  it('default (auto) → { format: "auto" }', () => {
    const result = buildEngineParams('date', { format: 'auto' });
    expect(result).toEqual({ format: 'auto' });
  });

  it('format=custom + pattern → { format: { custom: pattern } }', () => {
    const result = buildEngineParams('date', { format: 'custom', formatCustom: 'dd/MM/yyyy' });
    expect(result).toEqual({ format: { custom: 'dd/MM/yyyy' } });
  });

  it('format=custom with empty custom → falls back to default pattern', () => {
    const result = buildEngineParams('date', { format: 'custom', formatCustom: '' });
    expect(result).toEqual({ format: { custom: 'yyyy-MM-dd' } });
  });

  it('omitted format → auto', () => {
    const result = buildEngineParams('date', {});
    expect(result).toEqual({ format: 'auto' });
  });
});

describe('buildEngineParams — amount', () => {
  // Engine shape: AmountColumnParams { currency: 'auto'|'use_base'|{code}, type: ... }

  it('defaults → { currency: "auto", type: "auto" }', () => {
    const result = buildEngineParams('amount', { currency: 'auto', type: 'auto' });
    expect(result).toEqual({ currency: 'auto', type: 'auto' });
  });

  it('currency=use_base → { currency: "use_base", type: "auto" }', () => {
    expect(buildEngineParams('amount', { currency: 'use_base', type: 'auto' }))
      .toEqual({ currency: 'use_base', type: 'auto' });
  });

  it('currency=code + currencyCustom=EUR → { currency: { code: "EUR" }, type: ... }', () => {
    const result = buildEngineParams('amount', { currency: 'code', currencyCustom: 'EUR', type: 'mixed' });
    expect(result).toEqual({ currency: { code: 'EUR' }, type: 'mixed' });
  });

  it('currency=code + lowercaseCustom → uppercased code', () => {
    const result = buildEngineParams('amount', { currency: 'code', currencyCustom: 'uah', type: 'outcome' });
    expect(result).toEqual({ currency: { code: 'UAH' }, type: 'outcome' });
  });

  it('currency=code + empty custom → defaults to USD', () => {
    const result = buildEngineParams('amount', { currency: 'code', currencyCustom: '', type: 'auto' });
    expect(result).toEqual({ currency: { code: 'USD' }, type: 'auto' });
  });

  it('type=income → income in output', () => {
    expect(buildEngineParams('amount', { currency: 'auto', type: 'income' }))
      .toEqual({ currency: 'auto', type: 'income' });
  });

  it('type=outcome', () => {
    expect(buildEngineParams('amount', { currency: 'auto', type: 'outcome' }))
      .toEqual({ currency: 'auto', type: 'outcome' });
  });
});

describe('buildEngineParams — balance', () => {
  // Engine shape: BalanceColumnParams { currency: 'auto'|'use_base'|{code} }

  it('defaults → { currency: "auto" }', () => {
    expect(buildEngineParams('balance', { currency: 'auto' })).toEqual({ currency: 'auto' });
  });

  it('currency=code + USD', () => {
    expect(buildEngineParams('balance', { currency: 'code', currencyCustom: 'USD' }))
      .toEqual({ currency: { code: 'USD' } });
  });

  it('currency=use_base', () => {
    expect(buildEngineParams('balance', { currency: 'use_base' }))
      .toEqual({ currency: 'use_base' });
  });
});

describe('buildEngineParams — bank_commission', () => {
  // Engine shape: BankCommissionColumnParams { currency: 'auto'|'use_base'|{code} }

  it('defaults → { currency: "auto" }', () => {
    expect(buildEngineParams('bank_commission', { currency: 'auto' })).toEqual({ currency: 'auto' });
  });

  it('currency=code + EUR → { currency: { code: "EUR" } }', () => {
    expect(buildEngineParams('bank_commission', { currency: 'code', currencyCustom: 'EUR' }))
      .toEqual({ currency: { code: 'EUR' } });
  });
});

describe('buildEngineParams — cashback', () => {
  // Engine shape: CashbackColumnParams { currency: 'auto'|'use_base'|{code} }

  it('defaults → { currency: "auto" }', () => {
    expect(buildEngineParams('cashback', { currency: 'auto' })).toEqual({ currency: 'auto' });
  });

  it('currency=code + GBP', () => {
    expect(buildEngineParams('cashback', { currency: 'code', currencyCustom: 'GBP' }))
      .toEqual({ currency: { code: 'GBP' } });
  });
});

describe('buildEngineParams — status', () => {
  // Engine shape: TransactionStatusColumnParams { successValue: 'auto' | { useValue: string } }
  // (2.8 QA MAJOR-2: the explicit choice MUST be the WRAPPED { useValue } — a bare string
  //  is silently dropped to auto-detect by the engine's `.useValue` guard, column.ts:1261.)

  it('defaults → { successValue: "auto" }', () => {
    expect(buildEngineParams('status', { successValue: 'auto' })).toEqual({ successValue: 'auto' });
  });

  it('successValue=useValue + custom → { successValue: { useValue: "completed" } }', () => {
    expect(buildEngineParams('status', { successValue: 'useValue', successValueCustom: 'completed' }))
      .toEqual({ successValue: { useValue: 'completed' } });
  });

  it('successValue=useValue + empty custom → falls back to auto', () => {
    expect(buildEngineParams('status', { successValue: 'useValue', successValueCustom: '' }))
      .toEqual({ successValue: 'auto' });
  });

  it('omitted successValue → auto', () => {
    expect(buildEngineParams('status', {})).toEqual({ successValue: 'auto' });
  });
});

describe('buildEngineParams — no-param types → null', () => {
  const NO_PARAM_TYPES = [
    'description', 'currency', 'bank_account', 'merchant_category',
    'exchange_rate', 'category', 'time', 'counterparty', 'ignore',
    'unknown', 'xyz',
  ];

  it.each(NO_PARAM_TYPES)('type "%s" → null', (type) => {
    expect(buildEngineParams(type, {})).toBeNull();
  });
});
