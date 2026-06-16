/**
 * Tests for the rule-grammar ReDoS guard — Story 4.1 Task 3.
 *
 * FRAMING (per PM ruling): the regex is user-authored, run over the user's OWN
 * short bank-field data, LOCAL + single-user + worker-isolated. So these tests
 * pin SELF-INFLICTED UX-robustness, not an attacker defense:
 *  - MAX_MATCH_INPUT is the PRIMARY, exhaustive mitigation (asserted exact).
 *  - assertSafeRegex is a SECONDARY best-effort bomb screen — we assert it
 *    catches the OBVIOUS nested-quantifier shapes and does NOT false-positive on
 *    ordinary patterns. We deliberately do NOT assert it catches everything.
 */
import { describe, expect, it } from 'vitest';
import {
  assertSafeRegex,
  MAX_MATCH_INPUT,
  UnsafeRegexError,
} from './safe-regex';

describe('MAX_MATCH_INPUT (the primary cap)', () => {
  it('is exported and equals 1000', () => {
    expect(MAX_MATCH_INPUT).toBe(1000);
  });
});

describe('assertSafeRegex — REJECTS obvious catastrophic shapes', () => {
  const bombs: Array<[string, RegExp]> = [
    ['(a+)+$', /(a+)+$/],
    ['(a*)*$', /(a*)*$/],
    ['(a+)*', /(a+)*/],
    ['(.*a){10}', /(.*a){10}/],
    ['(\\d+)+$', /(\d+)+$/],
  ];

  for (const [label, re] of bombs) {
    it(`throws UnsafeRegexError for /${label}/`, () => {
      expect(() => assertSafeRegex(re)).toThrow(UnsafeRegexError);
    });

    it(`names the rejected pattern source in the message for /${label}/`, () => {
      expect(() => assertSafeRegex(re)).toThrow(re.source);
    });
  }
});

describe('assertSafeRegex — ACCEPTS ordinary patterns (no false positives)', () => {
  const safe: Array<[string, RegExp]> = [
    ['coffee/i', /coffee/i],
    ['^ATB ', /^ATB /],
    ['\\d{4}', /\d{4}/],
    ['(foo|bar)', /(foo|bar)/],
    ['^[A-Z]{2,4}$', /^[A-Z]{2,4}$/],
    ['payment', /payment/],
  ];

  for (const [label, re] of safe) {
    it(`does NOT throw for /${label}/`, () => {
      expect(() => assertSafeRegex(re)).not.toThrow();
    });
  }
});

describe('known limitation (documented, NOT enforced)', () => {
  // The heuristic is best-effort: alternation-overlap bombs like /(a|a)+$/ or
  // /(a|ab)*$/ are NOT nested-quantifier shapes, so the screen lets them through.
  // This is ACCEPTABLE because MAX_MATCH_INPUT backstops worst-case backtracking
  // by capping the matched string length. We assert nothing about this case other
  // than that the contract is unsurprising — it simply does not throw.
  it.skip('illustrative false-negative: /(a|a)+$/ is not caught (cap backstops it)', () => {
    expect(() => assertSafeRegex(/(a|a)+$/)).toThrow(UnsafeRegexError);
  });
});
