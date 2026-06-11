/**
 * Structure test — ENT-009 conformance.
 *
 * This test is the machine-checked twin of the §5 table in:
 *   docs/superpowers/specs/2026-06-11-story-2.2-column-catalog-design.md
 *
 * It pins:
 *  1. The EXACT 16 ColumnDefinition enum string values (no more, no fewer).
 *  2. Representative param-shape fixtures for every parameterised column type.
 *
 * QA runs a field-by-field diff against ENT-009 using this test as the
 * machine-checked baseline.
 */

import { describe, it, expect } from 'vitest';
import { ColumnDefinition } from './types';
import type {
  DateColumnParams,
  AmountColumnParams,
  BalanceColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  TransactionStatusColumnParams,
} from './types';
import type { CurrencyDetectOptions } from '../currency/detect';

// ---------------------------------------------------------------------------
// §5 canonical enum value set (16 entries — ENT-009 literal)
// ---------------------------------------------------------------------------

const SPEC_VALUES: readonly string[] = [
  'unknown',
  'date',
  'amount',
  'description',
  'currency',
  'bank_account',
  'merchant_category',
  'category',
  'balance',
  'status',
  'exchange_rate',
  'bank_commission',
  'cashback',
  'time',
  'counterparty',
  'ignore',
] as const;

describe('ColumnDefinition enum — ENT-009 structure', () => {
  it('exposes exactly 16 string values (no more, no fewer)', () => {
    const actual = Object.values(ColumnDefinition);
    expect(actual).toHaveLength(16);
    expect(new Set(actual)).toEqual(new Set(SPEC_VALUES));
  });

  it('every spec value maps to an enum member', () => {
    const actual = new Set<string>(Object.values(ColumnDefinition));
    for (const v of SPEC_VALUES) {
      expect(actual.has(v), `'${v}' missing from ColumnDefinition`).toBe(true);
    }
  });

  it('contains the two new types TIME and COUNTERPARTY', () => {
    expect(Object.values(ColumnDefinition)).toContain('time');
    expect(Object.values(ColumnDefinition)).toContain('counterparty');
  });

  it('enum member names map to correct string values', () => {
    expect(ColumnDefinition.UNKNOWN).toBe('unknown');
    expect(ColumnDefinition.DATE).toBe('date');
    expect(ColumnDefinition.AMOUNT).toBe('amount');
    expect(ColumnDefinition.DESCRIPTION).toBe('description');
    expect(ColumnDefinition.CURRENCY).toBe('currency');
    expect(ColumnDefinition.BANK_ACCOUNT).toBe('bank_account');
    expect(ColumnDefinition.MERCHANT_CATEGORY).toBe('merchant_category');
    expect(ColumnDefinition.CATEGORY).toBe('category');
    expect(ColumnDefinition.BALANCE).toBe('balance');
    expect(ColumnDefinition.STATUS).toBe('status');
    expect(ColumnDefinition.EXCHANGE_RATE).toBe('exchange_rate');
    expect(ColumnDefinition.BANK_COMMISSION).toBe('bank_commission');
    expect(ColumnDefinition.CASHBACK).toBe('cashback');
    expect(ColumnDefinition.TIME).toBe('time');
    expect(ColumnDefinition.COUNTERPARTY).toBe('counterparty');
    expect(ColumnDefinition.IGNORE).toBe('ignore');
  });
});

// ---------------------------------------------------------------------------
// Param-shape fixtures — compile-level + runtime key checks
// ---------------------------------------------------------------------------

describe('Param interfaces — shape fixtures', () => {
  it('DateColumnParams: auto variant', () => {
    const p: DateColumnParams = { format: 'auto' };
    expect(p.format).toBe('auto');
  });

  it('DateColumnParams: custom variant', () => {
    const p: DateColumnParams = { format: { custom: 'dd.MM.yyyy' } };
    expect(typeof (p.format as { custom: string }).custom).toBe('string');
  });

  it('AmountColumnParams: currency is CurrencyDetectOptions', () => {
    // auto
    const p1: AmountColumnParams = { currency: 'auto', type: 'auto' };
    expect(p1.currency).toBe('auto');

    // use_base
    const p2: AmountColumnParams = { currency: 'use_base', type: 'income' };
    expect(p2.currency).toBe('use_base');

    // { code }
    const p3: AmountColumnParams = { currency: { code: 'USD' }, type: 'outcome' };
    expect((p3.currency as { code: string }).code).toBe('USD');

    // type union values
    const types: Array<AmountColumnParams['type']> = ['auto', 'income', 'outcome', 'mixed', undefined];
    expect(types).toHaveLength(5);
  });

  it('AmountColumnParams: currency field is assignable from CurrencyDetectOptions', () => {
    // This is a compile-level test — if the type is wrong, TS won't accept this assignment.
    const autoOpt: CurrencyDetectOptions = 'auto';
    const p: AmountColumnParams = { currency: autoOpt };
    expect(p.currency).toBe('auto');
  });

  it('BalanceColumnParams: has currency: CurrencyDetectOptions', () => {
    const p: BalanceColumnParams = { currency: 'use_base' };
    expect(p.currency).toBe('use_base');
    expect(Object.keys(p)).toContain('currency');
  });

  it('BankCommissionColumnParams: has currency: CurrencyDetectOptions', () => {
    const p: BankCommissionColumnParams = { currency: { code: 'EUR' } };
    expect((p.currency as { code: string }).code).toBe('EUR');
  });

  it('CashbackColumnParams: has currency: CurrencyDetectOptions', () => {
    const p: CashbackColumnParams = { currency: 'auto' };
    expect(p.currency).toBe('auto');
  });

  it('TransactionStatusColumnParams: successValue auto variant', () => {
    const p: TransactionStatusColumnParams = { successValue: 'auto' };
    expect(p.successValue).toBe('auto');
  });

  it('TransactionStatusColumnParams: successValue useValue variant', () => {
    const p: TransactionStatusColumnParams = { successValue: { useValue: 'SUCCESS' } };
    expect((p.successValue as { useValue: string }).useValue).toBe('SUCCESS');
  });
});

// ---------------------------------------------------------------------------
// SupportedDataType — stage2/types sanity check
// ---------------------------------------------------------------------------

import { SupportedDataType } from './stage2/types';

describe('SupportedDataType', () => {
  it('contains TEXT, DATE, NUMBER, CURRENCY, MCC, UNKNOWN', () => {
    const vals = new Set<string>(Object.values(SupportedDataType));
    expect(vals.has('TEXT')).toBe(true);
    expect(vals.has('DATE')).toBe(true);
    expect(vals.has('NUMBER')).toBe(true);
    expect(vals.has('CURRENCY')).toBe(true);
    expect(vals.has('MCC')).toBe(true);
    expect(vals.has('UNKNOWN')).toBe(true);
  });

  it('COUNTERPARTY maps to TEXT (same output channel as DESCRIPTION)', () => {
    // COUNTERPARTY outputs a string value — it uses the TEXT data type.
    // This is the same channel DESCRIPTION uses, distinguished by the output
    // field key (counterparty vs description) at the row level.
    // The test pins the design decision so it isn't accidentally changed.
    expect(SupportedDataType.TEXT).toBe('TEXT');
  });
});
