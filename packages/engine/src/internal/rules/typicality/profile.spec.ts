/**
 * profile spec (Story 4.8, Task 1 — ENT-021 typicality profiling, EP-4).
 * @module internal/rules/typicality/profile.spec
 * @internal
 *
 * Pins the profiling layer + per-field atypicality that `rankBucket` (Task 2)
 * consumes. The key proofs:
 *   - tokenize is DEFENSIVE: drops numbers / IDs / short fragments, keeps real
 *     words, lower-cases (ruling #6a).
 *   - categoricalAtypicality: mode → 0; minority → high; homogeneous → 0.
 *   - amountAtypicality: 10× → high ramp; in-spread → 0; mad=0 boundary.
 *   - textAtypicality: a unique real word → high but ≤ TEXT_CAP (the cap is
 *     asserted, ruling #6b); all-common → 0; numbers-only op → 0.
 *   - informativeFields: diverse-categorical / filtered / thin-currency /
 *     no-core-token gates.
 *
 * Rows are cast `as ImportStatementStage3Row` carrying only the fields under
 * test — everything else is irrelevant to the profile being built.
 */

import { describe, it, expect } from 'vitest';
import type { ImportStatementStage3Row } from '../../importStatement/stage3/types';
import { AMOUNT_CURRENCY_FLOOR, TEXT_CAP } from './constants';
import {
  amountAtypicality,
  buildAmountProfiles,
  buildBucketProfile,
  buildCategoricalProfile,
  buildTextProfile,
  categoricalAtypicality,
  textAtypicality,
  tokenize,
  type TypicalityField,
} from './profile';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_ROW = {
  rowIndex: 0,
  amount: 10,
  currency: 'UAH',
  description: null,
  counterparty: null,
  bankCategory: null,
  mcc: null,
} as const;

function rows(
  list: ReadonlyArray<Partial<ImportStatementStage3Row>>
): ImportStatementStage3Row[] {
  return list.map((o) => ({ ...BASE_ROW, ...o }) as ImportStatementStage3Row);
}

// ── tokenize ─────────────────────────────────────────────────────────────────

describe('tokenize', () => {
  it('keeps real words, lower-cased', () => {
    expect(tokenize('STOCK MARKET FEE')).toEqual(['stock', 'market', 'fee']);
  });

  it('drops bare numbers, keeps the word ("ATB 123" → ["atb"])', () => {
    expect(tokenize('ATB 123')).toEqual(['atb']);
  });

  it('drops digit-bearing tokens entirely ("ATB123" → [])', () => {
    expect(tokenize('ATB123')).toEqual([]);
  });

  it('drops punctuation+number fragments ("#456" → [])', () => {
    expect(tokenize('#456')).toEqual([]);
  });

  it('null → []', () => {
    expect(tokenize(null)).toEqual([]);
  });

  it('drops short (< 3) alphabetic fragments, keeps length-3', () => {
    expect(tokenize('a to fee')).toEqual(['fee']);
  });
});

// ── categoricalAtypicality ───────────────────────────────────────────────────

describe('categoricalAtypicality', () => {
  it('the mode → 0; a 1-of-8 minority → high; homogeneous → 0 for all', () => {
    // 7× mcc 5411 + 1× mcc 5999 (the minority).
    const list = rows([
      ...Array.from({ length: 7 }, () => ({ mcc: 5411 })),
      { mcc: 5999 },
    ]);
    const p = buildCategoricalProfile(list, 'mcc');

    // mode '5411' → 0
    expect(categoricalAtypicality('5411', p)).toBe(0);
    // singleton '5999': share = 1/8, pMode = 7/8 → 1 − (1/8)/(7/8) = 1 − 1/7 ≈ 0.857
    expect(categoricalAtypicality('5999', p)).toBeGreaterThan(0.8);

    // homogeneous bucket → every value is the mode → 0
    const homo = buildCategoricalProfile(
      rows(Array.from({ length: 8 }, () => ({ mcc: 5411 }))),
      'mcc'
    );
    expect(categoricalAtypicality('5411', homo)).toBe(0);
  });

  it('pMode === 0 (nothing present) → 0', () => {
    const p = buildCategoricalProfile(rows([{ mcc: null }, { mcc: null }]), 'mcc');
    expect(p.pMode).toBe(0);
    expect(categoricalAtypicality('5411', p)).toBe(0);
  });
});

// ── amountAtypicality ────────────────────────────────────────────────────────

describe('amountAtypicality', () => {
  it('a 10× amount ramps high; an in-spread amount → 0', () => {
    // amounts 8..12 (UAH), median 10, mad small but non-zero.
    const list = rows([
      { amount: 8 },
      { amount: 9 },
      { amount: 10 },
      { amount: 11 },
      { amount: 12 },
    ]);
    const c = buildAmountProfiles(list).get('UAH')!;
    expect(c.mad).toBeGreaterThan(0);

    // within the spread → 0
    expect(amountAtypicality(11, c)).toBe(0);
    // 10× the median → far outside → ramps high
    expect(amountAtypicality(100, c)).toBeGreaterThan(0.5);
  });

  it('mad === 0: different from median → 1, equal → 0', () => {
    const c = buildAmountProfiles(
      rows([{ amount: 10 }, { amount: 10 }, { amount: 10 }])
    ).get('UAH')!;
    expect(c.mad).toBe(0);
    expect(amountAtypicality(10, c)).toBe(0);
    expect(amountAtypicality(999, c)).toBe(1);
  });
});

// ── textAtypicality ──────────────────────────────────────────────────────────

describe('textAtypicality', () => {
  it('a unique real word → high but ≤ TEXT_CAP (the cap is asserted)', () => {
    // 10 ops all say "coffee"; one also has the unique word "zzzrare".
    const list = rows([
      ...Array.from({ length: 9 }, () => ({ description: 'coffee' })),
      { description: 'coffee zzzrare' },
    ]);
    const profile = buildTextProfile(list, new Set());

    const a = textAtypicality(new Set(tokenize('coffee zzzrare')), profile);
    expect(a).toBeGreaterThan(0); // the rare token pushes it up
    expect(a).toBeLessThanOrEqual(TEXT_CAP); // ...but never past the cap
    expect(a).toBe(TEXT_CAP); // df('zzzrare') = 1/10 → rarity 0.9 → capped to 0.5
  });

  it('an all-common op → 0', () => {
    const list = rows(Array.from({ length: 5 }, () => ({ description: 'coffee' })));
    const profile = buildTextProfile(list, new Set());
    // 'coffee' df = 1 → rarity 0 → 0
    expect(textAtypicality(new Set(['coffee']), profile)).toBe(0);
  });

  it('a numbers-only op (no kept tokens) → 0', () => {
    const list = rows([{ description: 'coffee' }, { description: 'coffee' }]);
    const profile = buildTextProfile(list, new Set());
    expect(textAtypicality(new Set(tokenize('#456 123')), profile)).toBe(0);
  });
});

// ── informativeFields ────────────────────────────────────────────────────────

describe('informativeFields', () => {
  const none: ReadonlySet<TypicalityField> = new Set();

  it('a uniform-diverse categorical (pMode < 0.5) is NOT informative', () => {
    // 8 distinct bankCategories → coverage 1 but pMode = 1/8 < 0.5.
    const list = rows(
      Array.from({ length: 8 }, (_, i) => ({ bankCategory: `cat-${i}` }))
    );
    const { informative } = buildBucketProfile(list, none);
    expect(informative.categorical.has('bankCategory')).toBe(false);
  });

  it('a constant categorical IS informative (but its a_f is 0 for every op)', () => {
    const list = rows(
      Array.from({ length: 8 }, () => ({ bankCategory: 'groceries' }))
    );
    const profile = buildBucketProfile(list, none);
    expect(profile.informative.categorical.has('bankCategory')).toBe(true);

    // constant → pMode 1, every present value is the mode → a_f 0 for all.
    const p = profile.categorical.get('bankCategory')!;
    expect(categoricalAtypicality('groceries', p)).toBe(0);
  });

  it('a filtered categorical field is EXCLUDED even when it qualifies', () => {
    const list = rows(
      Array.from({ length: 8 }, () => ({ bankCategory: 'groceries' }))
    );
    const filtered: ReadonlySet<TypicalityField> = new Set(['bankCategory']);
    const { informative } = buildBucketProfile(list, filtered);
    expect(informative.categorical.has('bankCategory')).toBe(false);
  });

  it('an amount currency with < AMOUNT_CURRENCY_FLOOR ops is NOT informative', () => {
    // AMOUNT_CURRENCY_FLOOR = 5 → 4 USD ops fall short, 5 UAH qualify.
    const list = rows([
      ...Array.from({ length: 4 }, () => ({ currency: 'USD', amount: 1 })),
      ...Array.from({ length: 5 }, () => ({ currency: 'UAH', amount: 1 })),
    ]);
    const { informative } = buildBucketProfile(list, none);
    expect(AMOUNT_CURRENCY_FLOOR).toBe(5);
    expect(informative.amountCurrencies.has('USD')).toBe(false);
    expect(informative.amountCurrencies.has('UAH')).toBe(true);
  });

  it('text with no token at df ≥ TEXT_CORE_DF is NOT informative', () => {
    // 4 ops, each a distinct word → every df = 1/4 < 0.5 → no core vocabulary.
    const list = rows([
      { description: 'alpha' },
      { description: 'bravo' },
      { description: 'charlie' },
      { description: 'delta' },
    ]);
    const { informative } = buildBucketProfile(list, none);
    expect(informative.text).toBe(false);

    // ...but a shared core word flips it on.
    const shared = rows([
      { description: 'coffee alpha' },
      { description: 'coffee bravo' },
      { description: 'coffee charlie' },
      { description: 'coffee delta' },
    ]);
    expect(buildBucketProfile(shared, none).informative.text).toBe(true);
  });
});
