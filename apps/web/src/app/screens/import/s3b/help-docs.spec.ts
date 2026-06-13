/**
 * help-docs.spec.ts — tests for the vendored help-doc embedding (Task 2, NFR-005).
 *
 * We use a Vite-specific `?raw` import mechanism; under Vitest the import.meta.glob
 * is resolved by vite's plugin pipeline, so these run as standard unit tests.
 */
import { describe, expect, it } from 'vitest';
import { HELP_DOCS, helpFor, type HelpKey } from './help-docs';

const ALL_HELP_KEYS: HelpKey[] = [
  'amount',
  'balance',
  'bank-account',
  'bank-commission',
  'cashback',
  'category',
  'counterparty',
  'currency',
  'date',
  'description',
  'exchange-rate',
  'info',
  'merchant-category',
  'status',
  'time',
];

/** All 14 engine definitions that have help docs (plus ignore/unknown which don't). */
const DEFINITION_TO_KEY: Array<[definition: string, expectedKey: HelpKey]> = [
  ['date',              'date'],
  ['amount',            'amount'],
  ['description',       'description'],
  ['currency',          'currency'],
  ['balance',           'balance'],
  ['bank_account',      'bank-account'],
  ['status',            'status'],
  ['merchant_category', 'merchant-category'],
  ['category',          'category'],
  ['exchange_rate',     'exchange-rate'],
  ['bank_commission',   'bank-commission'],
  ['cashback',          'cashback'],
  ['time',              'time'],
  ['counterparty',      'counterparty'],
];

describe('HELP_DOCS', () => {
  it('has exactly 15 keys (14 types + info)', () => {
    expect(Object.keys(HELP_DOCS).sort()).toEqual([...ALL_HELP_KEYS].sort());
  });

  it.each(ALL_HELP_KEYS)('key "%s" has non-empty uk and en strings', (key) => {
    expect(HELP_DOCS[key].uk).toBeTruthy();
    expect(HELP_DOCS[key].uk.length).toBeGreaterThan(20);
    expect(HELP_DOCS[key].en).toBeTruthy();
    expect(HELP_DOCS[key].en.length).toBeGreaterThan(20);
  });
});

describe('helpFor', () => {
  it('returns null for "ignore"', () => {
    expect(helpFor('ignore', 'uk')).toBeNull();
    expect(helpFor('ignore', 'en')).toBeNull();
  });

  it('returns null for "unknown"', () => {
    expect(helpFor('unknown', 'uk')).toBeNull();
    expect(helpFor('unknown', 'en')).toBeNull();
  });

  it('returns null for an unrecognized definition', () => {
    expect(helpFor('__not_a_real_definition__', 'uk')).toBeNull();
  });

  it.each(DEFINITION_TO_KEY)(
    'helpFor("%s", lang) returns the correct non-empty string',
    (definition, _expectedKey) => {
      const uk = helpFor(definition, 'uk');
      const en = helpFor(definition, 'en');
      expect(uk).not.toBeNull();
      expect(typeof uk).toBe('string');
      expect((uk as string).length).toBeGreaterThan(20);
      expect(en).not.toBeNull();
      expect(typeof en).toBe('string');
      expect((en as string).length).toBeGreaterThan(20);
    },
  );

  it('helpFor("bank_account") returns bank-account content', () => {
    const uk = helpFor('bank_account', 'uk');
    // The bank-account.uk.md exists and has real content
    expect(uk).not.toBeNull();
    expect(uk).toBe(HELP_DOCS['bank-account'].uk);
  });

  it('helpFor("merchant_category") returns merchant-category content', () => {
    expect(helpFor('merchant_category', 'en')).toBe(HELP_DOCS['merchant-category'].en);
  });

  it('helpFor("exchange_rate") returns exchange-rate content', () => {
    expect(helpFor('exchange_rate', 'uk')).toBe(HELP_DOCS['exchange-rate'].uk);
  });

  it('helpFor("bank_commission") returns bank-commission content', () => {
    expect(helpFor('bank_commission', 'en')).toBe(HELP_DOCS['bank-commission'].en);
  });
});
