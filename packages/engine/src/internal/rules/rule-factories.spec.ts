/**
 * Typed rule-factory spec (Story 4.1, Task 2) — the ENT-010 field×operator matrix.
 * @module internal/rules/rule-factories.spec
 * @internal
 *
 * Pins the PORTED factories + the ENT-010 adapts:
 *  - date × all 10 DateOperation variants (ported expectations).
 *  - amount via `createAmountCondition(op, currency)` (Fork B): the pair shape,
 *    the appended currency=equals rule, and the blank-currency guard. The bare
 *    amount factory is module-private — asserted NOT in the module's exports.
 *  - string fields (description/account/counterparty) × StringOperation incl.
 *    `matches` (Fork C): a SAFE pattern matches, input is CAPPED at
 *    MAX_MATCH_INPUT, and a BOMB pattern throws UnsafeRegexError at CONSTRUCTION.
 *  - bankCategory/currency/mcc × StringMatchOperation; mcc is categorical over
 *    `String(row.mcc)`.
 *  - boolean fields × isTrue/isFalse.
 *
 * The fixture mirrors rule.spec.ts: a minimal row cast built WITHOUT a `source`
 * key (the field was removed from the row in a sibling task).
 */

import { describe, it, expect } from 'vitest';
import * as factories from './rule-factories';
import {
  createDateRule,
  createAmountCondition,
  createDescriptionRule,
  createAccountRule,
  createCounterpartyRule,
  createBankCategoryRule,
  createCurrencyRule,
  createMccRule,
  createIsBankCommissionRule,
  createIsCashbackRule,
} from './rule-factories';
import { MAX_MATCH_INPUT, UnsafeRegexError } from './safe-regex';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal ImportStatementStage3Row, overriding only what a test cares
 * about. NOTE: no `source` key — the cast lets us omit it (sibling task removed
 * it from the row shape).
 */
function makeRow(
  overrides: Partial<ImportStatementStage3Row> = {}
): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    hash: 'h',
    date: new Date('2024-06-15T12:00:00.000Z'),
    amount: 10,
    currency: 'USD',
    description: null,
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: null,
    isBankCommission: false,
    isCashback: false,
    category: null,
    isManuallySetCategory: false,
    ...overrides,
  } as ImportStatementStage3Row;
}

/** A local Date at the given day-of-month in June 2024 (no UTC drift). */
function dayInJune(day: number): Date {
  return new Date(2024, 5, day, 12, 0, 0);
}

// ── date × all 10 DateOperation variants ─────────────────────────────────────

describe('createDateRule — date × all 10 DateOperation variants', () => {
  // June 2024: 1st = Saturday, 30th = Sunday. First Monday = 3rd, first Sunday =
  // 2nd, last Saturday = 29th, last Sunday = 30th, last Monday = 24th.
  it('firstDayOfMonth matches the 1st, not the 2nd', () => {
    const rule = createDateRule({ type: 'firstDayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(1) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(2) }))).toBe(false);
  });

  it('firstMondayOfMonth matches the 3rd (Mon, within first 7), not the 10th', () => {
    const rule = createDateRule({ type: 'firstMondayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(3) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(10) }))).toBe(false);
  });

  it('firstSaturdayOfMonth matches the 1st (Sat, within first 7), not the 8th', () => {
    const rule = createDateRule({ type: 'firstSaturdayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(1) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(8) }))).toBe(false);
  });

  it('firstSundayOfMonth matches the 2nd (Sun, within first 7), not the 9th', () => {
    const rule = createDateRule({ type: 'firstSundayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(2) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(9) }))).toBe(false);
  });

  it('lastDayOfMonth matches the 30th (June has 30 days), not the 29th', () => {
    const rule = createDateRule({ type: 'lastDayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(30) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(29) }))).toBe(false);
  });

  it('lastMondayOfMonth matches the 24th (Mon in last 7), not the 17th', () => {
    const rule = createDateRule({ type: 'lastMondayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(24) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(17) }))).toBe(false);
  });

  it('lastSaturdayOfMonth matches the 29th (Sat in last 7), not the 22nd', () => {
    const rule = createDateRule({ type: 'lastSaturdayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(29) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(22) }))).toBe(false);
  });

  it('lastSundayOfMonth matches the 30th (Sun in last 7), not the 23rd', () => {
    const rule = createDateRule({ type: 'lastSundayOfMonth' });
    expect(rule.evaluate(makeRow({ date: dayInJune(30) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(23) }))).toBe(false);
  });

  it('specificDay matches the configured day, not another', () => {
    const rule = createDateRule({ type: 'specificDay', value: 15 });
    expect(rule.evaluate(makeRow({ date: dayInJune(15) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(16) }))).toBe(false);
  });

  it('dayRange matches inside [start,end], not outside', () => {
    const rule = createDateRule({ type: 'dayRange', start: 10, end: 20 });
    expect(rule.evaluate(makeRow({ date: dayInJune(10) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(20) }))).toBe(true);
    expect(rule.evaluate(makeRow({ date: dayInJune(9) }))).toBe(false);
    expect(rule.evaluate(makeRow({ date: dayInJune(21) }))).toBe(false);
  });
});

// ── amount × all 7 NumberOperation variants via createAmountCondition ─────────

describe('createAmountCondition — Fork B amount↔currency pair', () => {
  it('returns a 2-rule pair: the amount rule + currency=equals', () => {
    const pair = createAmountCondition({ type: 'equals', value: 10 }, 'UAH');
    expect(pair).toHaveLength(2);
    expect(pair[0].field).toBe('amount');
    expect(pair[1].field).toBe('currency');
    expect(pair[1].operation).toEqual({ type: 'equals', value: 'UAH' });
  });

  it('the appended currency rule matches on currency equality', () => {
    const pair = createAmountCondition({ type: 'equals', value: 10 }, 'UAH');
    expect(pair[1].evaluate(makeRow({ currency: 'UAH' }))).toBe(true);
    expect(pair[1].evaluate(makeRow({ currency: 'USD' }))).toBe(false);
  });

  const numberCases: Array<{
    label: string;
    op: Parameters<typeof createAmountCondition>[0];
    match: number;
    noMatch: number;
  }> = [
    { label: 'equals', op: { type: 'equals', value: 10 }, match: 10, noMatch: 11 },
    { label: 'notEquals', op: { type: 'notEquals', value: 10 }, match: 11, noMatch: 10 },
    { label: 'greaterThan', op: { type: 'greaterThan', value: 10 }, match: 11, noMatch: 10 },
    { label: 'lessThan', op: { type: 'lessThan', value: 10 }, match: 9, noMatch: 10 },
    { label: 'greaterThanOrEqual', op: { type: 'greaterThanOrEqual', value: 10 }, match: 10, noMatch: 9 },
    { label: 'lessThanOrEqual', op: { type: 'lessThanOrEqual', value: 10 }, match: 10, noMatch: 11 },
    { label: 'between', op: { type: 'between', min: 5, max: 15 }, match: 10, noMatch: 20 },
  ];

  for (const { label, op, match, noMatch } of numberCases) {
    it(`amount rule honors ${label} (match/no-match)`, () => {
      const amountRule = createAmountCondition(op, 'UAH')[0];
      expect(amountRule.evaluate(makeRow({ amount: match }))).toBe(true);
      expect(amountRule.evaluate(makeRow({ amount: noMatch }))).toBe(false);
    });
  }

  it('throws when currency is empty', () => {
    expect(() => createAmountCondition({ type: 'equals', value: 10 }, '')).toThrow();
  });

  it('throws when currency is blank (whitespace only)', () => {
    expect(() => createAmountCondition({ type: 'equals', value: 10 }, '   ')).toThrow();
  });

  it('does NOT export a bare amount factory (amount unconstructable without currency)', () => {
    const exportNames = Object.keys(factories);
    expect(exportNames).not.toContain('createAmountRule');
    const noBareAmount = exportNames.every(
      (name) =>
        !(name.toLowerCase().includes('amount') && name !== 'createAmountCondition')
    );
    expect(noBareAmount).toBe(true);
  });
});

// ── string fields × StringOperation (incl. Fork C matches) ───────────────────

describe('string fields × StringOperation', () => {
  const stringFields: Array<{
    label: string;
    make: (op: Parameters<typeof createDescriptionRule>[0]) => ReturnType<typeof createDescriptionRule>;
    field: 'description' | 'account' | 'counterparty';
  }> = [
    { label: 'description', make: createDescriptionRule, field: 'description' },
    { label: 'account', make: createAccountRule, field: 'account' },
    { label: 'counterparty', make: createCounterpartyRule, field: 'counterparty' },
  ];

  for (const { label, make, field } of stringFields) {
    describe(`${label}`, () => {
      it('equals', () => {
        const rule = make({ type: 'equals', value: 'ATB' });
        expect(rule.evaluate(makeRow({ [field]: 'ATB' }))).toBe(true);
        expect(rule.evaluate(makeRow({ [field]: 'Other' }))).toBe(false);
      });

      it('notEquals', () => {
        const rule = make({ type: 'notEquals', value: 'ATB' });
        expect(rule.evaluate(makeRow({ [field]: 'Other' }))).toBe(true);
        expect(rule.evaluate(makeRow({ [field]: 'ATB' }))).toBe(false);
      });

      it('contains', () => {
        const rule = make({ type: 'contains', value: 'coffee' });
        expect(rule.evaluate(makeRow({ [field]: 'morning coffee shop' }))).toBe(true);
        expect(rule.evaluate(makeRow({ [field]: 'tea' }))).toBe(false);
      });

      it('notContains', () => {
        const rule = make({ type: 'notContains', value: 'coffee' });
        expect(rule.evaluate(makeRow({ [field]: 'tea' }))).toBe(true);
        expect(rule.evaluate(makeRow({ [field]: 'coffee' }))).toBe(false);
      });

      it('startsWith', () => {
        const rule = make({ type: 'startsWith', value: 'ATB' });
        expect(rule.evaluate(makeRow({ [field]: 'ATB market' }))).toBe(true);
        expect(rule.evaluate(makeRow({ [field]: 'market ATB' }))).toBe(false);
      });

      it('endsWith', () => {
        const rule = make({ type: 'endsWith', value: 'market' });
        expect(rule.evaluate(makeRow({ [field]: 'ATB market' }))).toBe(true);
        expect(rule.evaluate(makeRow({ [field]: 'market ATB' }))).toBe(false);
      });

      it('matches a SAFE pattern', () => {
        const rule = make({ type: 'matches', pattern: /coffee/i });
        expect(rule.evaluate(makeRow({ [field]: 'Morning COFFEE' }))).toBe(true);
        expect(rule.evaluate(makeRow({ [field]: 'tea' }))).toBe(false);
      });
    });
  }

  it('matches caps input at MAX_MATCH_INPUT (a match beyond the cap does not match)', () => {
    // Pattern anchored to require a marker AFTER MAX_MATCH_INPUT chars. The
    // marker sits past the cap, so the capped slice never contains it → no match.
    const rule = createDescriptionRule({ type: 'matches', pattern: /MARKER/ });
    const beyondCap = 'a'.repeat(MAX_MATCH_INPUT) + 'MARKER';
    expect(rule.evaluate(makeRow({ description: beyondCap }))).toBe(false);

    // The same marker WITHIN the cap does match — proves the slice, not a typo.
    const withinCap = 'a'.repeat(MAX_MATCH_INPUT - 10) + 'MARKER';
    expect(rule.evaluate(makeRow({ description: withinCap }))).toBe(true);
  });

  it('throws UnsafeRegexError at CONSTRUCTION for a bomb pattern', () => {
    expect(() =>
      createDescriptionRule({ type: 'matches', pattern: /(a+)+$/ })
    ).toThrow(UnsafeRegexError);
  });
});

// ── bankCategory / currency / mcc × StringMatchOperation ─────────────────────

describe('StringMatchOperation fields', () => {
  it('bankCategory equals/notEquals/oneOf', () => {
    expect(
      createBankCategoryRule({ type: 'equals', value: 'Food' }).evaluate(
        makeRow({ bankCategory: 'Food' })
      )
    ).toBe(true);
    expect(
      createBankCategoryRule({ type: 'notEquals', value: 'Food' }).evaluate(
        makeRow({ bankCategory: 'Transport' })
      )
    ).toBe(true);
    expect(
      createBankCategoryRule({ type: 'oneOf', values: ['Food', 'Transport'] }).evaluate(
        makeRow({ bankCategory: 'Transport' })
      )
    ).toBe(true);
  });

  it('currency equals/notEquals/oneOf', () => {
    expect(
      createCurrencyRule({ type: 'equals', value: 'UAH' }).evaluate(
        makeRow({ currency: 'UAH' })
      )
    ).toBe(true);
    expect(
      createCurrencyRule({ type: 'notEquals', value: 'UAH' }).evaluate(
        makeRow({ currency: 'USD' })
      )
    ).toBe(true);
    expect(
      createCurrencyRule({ type: 'oneOf', values: ['UAH', 'EUR'] }).evaluate(
        makeRow({ currency: 'EUR' })
      )
    ).toBe(true);
  });

  describe('mcc — categorical over String(row.mcc)', () => {
    it('oneOf matches a row with numeric mcc 5411 via its String() form', () => {
      const rule = createMccRule({ type: 'oneOf', values: ['5411', '5812'] });
      expect(rule.evaluate(makeRow({ mcc: 5411 }))).toBe(true);
      expect(rule.evaluate(makeRow({ mcc: 5999 }))).toBe(false);
    });

    it('equals matches String(mcc)', () => {
      const rule = createMccRule({ type: 'equals', value: '5411' });
      expect(rule.evaluate(makeRow({ mcc: 5411 }))).toBe(true);
      expect(rule.evaluate(makeRow({ mcc: 5412 }))).toBe(false);
    });

    it('notEquals matches String(mcc)', () => {
      const rule = createMccRule({ type: 'notEquals', value: '5411' });
      expect(rule.evaluate(makeRow({ mcc: 5412 }))).toBe(true);
      expect(rule.evaluate(makeRow({ mcc: 5411 }))).toBe(false);
    });

    it('the mcc rule field is "mcc"', () => {
      expect(createMccRule({ type: 'equals', value: '5411' }).field).toBe('mcc');
    });
  });
});

// ── boolean fields × isTrue/isFalse ──────────────────────────────────────────

describe('boolean fields × isTrue/isFalse', () => {
  it('isBankCommission isTrue/isFalse', () => {
    expect(
      createIsBankCommissionRule({ type: 'isTrue' }).evaluate(
        makeRow({ isBankCommission: true })
      )
    ).toBe(true);
    expect(
      createIsBankCommissionRule({ type: 'isFalse' }).evaluate(
        makeRow({ isBankCommission: false })
      )
    ).toBe(true);
    expect(
      createIsBankCommissionRule({ type: 'isTrue' }).evaluate(
        makeRow({ isBankCommission: false })
      )
    ).toBe(false);
  });

  it('isCashback isTrue/isFalse', () => {
    expect(
      createIsCashbackRule({ type: 'isTrue' }).evaluate(
        makeRow({ isCashback: true })
      )
    ).toBe(true);
    expect(
      createIsCashbackRule({ type: 'isFalse' }).evaluate(
        makeRow({ isCashback: false })
      )
    ).toBe(true);
  });
});
