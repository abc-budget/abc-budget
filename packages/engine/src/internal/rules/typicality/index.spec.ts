/**
 * rankBucket spec (Story 4.8, Task 2 — ENT-021 typicality pipeline entry, EP-4).
 * @module internal/rules/typicality/index.spec
 * @internal
 *
 * The headline proofs that the assembled pipeline (N-gate → informative fields →
 * per-op NOISY-OR → ABSOLUTE tail → structured attribution) behaves to spec:
 *   - STOCK-MARKET-FEE: an op flags on MCC ALONE (its amount/text a_f ≈ 0).
 *   - HOMOGENEOUS → EMPTY tail: every a_f 0 → atypicality 0 < T_ABS.
 *   - #6c HARDENED: homogeneous category, VARIED merchant strings → text a_f is
 *     capped at TEXT_CAP < T_ABS → still EMPTY (containment on realistic noise).
 *   - N-gate, field-availability, per-currency amount, determinism, O(N).
 *
 * Rows are cast `as ImportStatementStage3Row` carrying only the fields under
 * test; everything else is irrelevant to the ranking being proven.
 */

import { describe, it, expect } from 'vitest';
import type { ImportStatementStage3Row } from '../../importStatement/stage3/types';
import type { TypicalityField } from './profile';
import { T_ABS, TEXT_CAP } from './constants';
import { rankBucket } from './index';

// ── Helpers ──────────────────────────────────────────────────────────────────

const BASE_ROW = {
  rowIndex: 0,
  amount: 100,
  currency: 'UAH',
  description: 'grocery store',
  counterparty: null,
  bankCategory: null,
  mcc: 5411,
} as const;

/** Build rows from partials, auto-assigning a stable ascending `rowIndex`. */
function rows(
  list: ReadonlyArray<Partial<ImportStatementStage3Row>>
): ImportStatementStage3Row[] {
  return list.map(
    (o, i) =>
      ({ ...BASE_ROW, rowIndex: o.rowIndex ?? i, ...o }) as ImportStatementStage3Row
  );
}

const NO_FILTER: ReadonlySet<TypicalityField> = new Set();

// ── N-gate ───────────────────────────────────────────────────────────────────

describe('rankBucket — N-gate', () => {
  it('a 5-op bucket (< N_MIN) → { skipped:true, flagged:[] }', () => {
    const result = rankBucket(rows(Array.from({ length: 5 }, () => ({}))), NO_FILTER);
    expect(result.skipped).toBe(true);
    expect(result.bucketSize).toBe(5);
    expect(result.flagged).toEqual([]);
  });
});

// ── STOCK-MARKET-FEE: flags on MCC ALONE ─────────────────────────────────────

describe('rankBucket — STOCK-MARKET-FEE (flags on MCC alone)', () => {
  it('one MCC 6051 op in a grocery bucket flags via MCC, amount/text a_f ≈ 0', () => {
    // 9 typical grocery ops (mcc 5411, ~100 UAH, plain "grocery store")
    // + 1 op identical EXCEPT mcc 6051 (stock-market fee).
    const list = rows([
      ...Array.from({ length: 9 }, () => ({})),
      { rowIndex: 9, mcc: 6051 },
    ]);
    const result = rankBucket(list, NO_FILTER);

    expect(result.skipped).toBe(false);
    expect(result.bucketSize).toBe(10);
    expect(result.flagged).toHaveLength(1);

    const flagged = result.flagged[0];
    expect(flagged.row.mcc).toBe(6051);
    expect(flagged.atypicality).toBeGreaterThanOrEqual(T_ABS);

    // The flag is driven by MCC ALONE: reasons[0] is the categorical-minority
    // on mcc with the numeric value 6051.
    expect(flagged.reasons[0]).toEqual({
      field: 'mcc',
      kind: 'categorical-minority',
      value: 6051,
    });

    // Prove MCC-alone: amount + text a_f are ~0 (same amount, same description),
    // so there is no amount-outlier nor rare-tokens reason.
    const kinds = flagged.reasons.map((r) => r.kind);
    expect(kinds).not.toContain('amount-outlier');
    expect(kinds).not.toContain('rare-tokens');
  });
});

// ── HOMOGENEOUS → EMPTY tail ─────────────────────────────────────────────────

describe('rankBucket — HOMOGENEOUS → EMPTY tail', () => {
  it('identical ops → flagged === [] (every a_f 0 → atypicality 0 < T_ABS)', () => {
    const list = rows(Array.from({ length: 10 }, () => ({})));
    const result = rankBucket(list, NO_FILTER);
    expect(result.skipped).toBe(false);
    expect(result.flagged).toEqual([]);
  });
});

// ── #6c HARDENED: varied merchant strings → EMPTY tail ───────────────────────

describe('rankBucket — #6c varied descriptions → EMPTY tail', () => {
  it('same MCC, varied real-ish merchant strings → text capped < T_ABS → empty', () => {
    const merchants = [
      'ATB 123',
      'SILPO 456',
      'NOVUS 789',
      'FORA 12',
      'METRO 34',
      'AUCHAN 56',
      'VARUS 78',
      'EKO 90',
      'TAVRIA 11',
      'KOLO 22',
    ];
    // All mcc 5411, all UAH ~100, but each a different alphabetic merchant name.
    const list = rows(
      merchants.map((m, i) => ({ rowIndex: i, description: m, amount: 100 + i }))
    );
    const result = rankBucket(list, NO_FILTER);

    expect(result.skipped).toBe(false);
    // text a_f is high-but-CAPPED at TEXT_CAP=0.5 < T_ABS=0.6, mcc/currency/amount
    // a_f are 0 → noisy-OR ≤ 0.5 → nothing crosses the absolute tail.
    expect(TEXT_CAP).toBeLessThan(T_ABS);
    expect(result.flagged).toEqual([]);
  });
});

// ── field-availability ───────────────────────────────────────────────────────

describe('rankBucket — field availability', () => {
  it('an all-null counterparty contributes nothing (no flags from it)', () => {
    // mcc constant + counterparty null everywhere; one op differs only by a null
    // counterparty (which is silent). Nothing should flag.
    const list = rows(Array.from({ length: 8 }, () => ({ counterparty: null })));
    const result = rankBucket(list, NO_FILTER);
    expect(result.flagged).toEqual([]);
  });

  it('a uniform-diverse field (every op distinct) is not informative → no flags', () => {
    // bankCategory all-distinct → pMode < 0.5 → not informative. mcc constant,
    // amounts constant, descriptions constant → nothing else flags either.
    const list = rows(
      Array.from({ length: 8 }, (_, i) => ({ bankCategory: `cat-${i}` }))
    );
    const result = rankBucket(list, NO_FILTER);
    expect(result.flagged).toEqual([]);
  });

  it('a FILTERED field never drives a flag', () => {
    // mcc would otherwise flag the 6051 minority — but mcc is the rule's filtered
    // field, so it is gated out and cannot drive a flag. Everything else typical.
    const list = rows([
      ...Array.from({ length: 9 }, () => ({})),
      { rowIndex: 9, mcc: 6051 },
    ]);
    const filtered: ReadonlySet<TypicalityField> = new Set(['mcc']);
    const result = rankBucket(list, filtered);
    expect(result.flagged).toEqual([]);
  });
});

// ── per-currency amount ──────────────────────────────────────────────────────

describe('rankBucket — per-currency amount', () => {
  it('a 10× UAH op flags as amount-outlier; USD ops at another scale do NOT', () => {
    // 8 normal UAH ops near 100, one 10× UAH outlier, + 5 USD ops at a different
    // scale (≈ 5). The USD scale must not contaminate the UAH outlier, and the
    // USD ops themselves are not flagged.
    const list = rows([
      { rowIndex: 0, amount: 98 },
      { rowIndex: 1, amount: 99 },
      { rowIndex: 2, amount: 100 },
      { rowIndex: 3, amount: 101 },
      { rowIndex: 4, amount: 102 },
      { rowIndex: 5, amount: 100 },
      { rowIndex: 6, amount: 99 },
      { rowIndex: 7, amount: 101 },
      { rowIndex: 8, amount: 1000 }, // the 10× UAH outlier
      // 5 USD ops at a different scale, with a non-degenerate in-spread range
      // (median 5, mad 1 → every op well within Z0, none an outlier).
      { rowIndex: 9, amount: 3, currency: 'USD' },
      { rowIndex: 10, amount: 4, currency: 'USD' },
      { rowIndex: 11, amount: 5, currency: 'USD' },
      { rowIndex: 12, amount: 6, currency: 'USD' },
      { rowIndex: 13, amount: 7, currency: 'USD' },
    ]);
    const result = rankBucket(list, NO_FILTER);

    // The UAH outlier flagged with an amount-outlier reason.
    const outlier = result.flagged.find((f) => f.row.rowIndex === 8);
    expect(outlier).toBeDefined();
    expect(outlier!.reasons.some((r) => r.kind === 'amount-outlier')).toBe(true);
    const amountReason = outlier!.reasons.find((r) => r.kind === 'amount-outlier')!;
    expect(amountReason.field).toBe('amount');
    expect(amountReason.magnitude).toBeGreaterThan(0);

    // No USD op is flagged (no cross-currency contamination).
    const usdFlags = result.flagged.filter((f) => f.row.currency === 'USD');
    expect(usdFlags).toEqual([]);
  });
});

// ── attribution ordering ─────────────────────────────────────────────────────

describe('rankBucket — attribution', () => {
  it('reasons are ordered by ENT-021 signal strength (mcc before amount)', () => {
    // One op atypical in BOTH mcc and amount → mcc must come before amount.
    const list = rows([
      { rowIndex: 0, amount: 98 },
      { rowIndex: 1, amount: 99 },
      { rowIndex: 2, amount: 100 },
      { rowIndex: 3, amount: 101 },
      { rowIndex: 4, amount: 102 },
      { rowIndex: 5, amount: 100 },
      { rowIndex: 6, amount: 99 },
      { rowIndex: 7, amount: 101 },
      { rowIndex: 8, amount: 1000, mcc: 6051 }, // atypical mcc AND amount
    ]);
    const result = rankBucket(list, NO_FILTER);
    const flagged = result.flagged.find((f) => f.row.rowIndex === 8)!;
    const fields = flagged.reasons.map((r) => r.field);
    expect(fields.indexOf('mcc')).toBeLessThan(fields.indexOf('amount'));
  });
});

// ── tie-break + sort order ───────────────────────────────────────────────────

describe('rankBucket — sort + tie-break', () => {
  it('flagged sorted by atypicality DESC, ties broken by rowIndex ASC', () => {
    // Two identical-atypicality minority ops (both mcc 6051) at different rows
    // → equal atypicality → ordered by rowIndex ascending.
    const list = rows([
      ...Array.from({ length: 8 }, (_, i) => ({ rowIndex: i })),
      { rowIndex: 8, mcc: 6051 },
      { rowIndex: 9, mcc: 6051 },
    ]);
    const result = rankBucket(list, NO_FILTER);
    const indices = result.flagged.map((f) => f.row.rowIndex);
    // both flagged, ascending rowIndex on the tie
    expect(indices).toEqual([8, 9]);
  });
});

// ── determinism ──────────────────────────────────────────────────────────────

describe('rankBucket — determinism', () => {
  it('two runs on the same bucket → byte-identical flagged', () => {
    const list = rows([
      ...Array.from({ length: 8 }, () => ({})),
      { rowIndex: 8, mcc: 6051, amount: 1000 },
      { rowIndex: 9, mcc: 4829 },
    ]);
    const a = rankBucket(list, NO_FILTER);
    const b = rankBucket(list, NO_FILTER);
    expect(JSON.stringify(a.flagged)).toEqual(JSON.stringify(b.flagged));
  });
});

// ── O(N) (behavioral): correctness on a larger bucket ────────────────────────

describe('rankBucket — O(N) on a larger bucket', () => {
  it('a 31-op bucket with a single MCC minority flags exactly that op', () => {
    // 30 typical grocery ops + 1 mcc 6051 minority. The profile is built once
    // and every op scored against it; only the minority crosses the tail.
    const list = rows([
      ...Array.from({ length: 30 }, (_, i) => ({ rowIndex: i })),
      { rowIndex: 30, mcc: 6051 },
    ]);
    const result = rankBucket(list, NO_FILTER);
    expect(result.bucketSize).toBe(31);
    expect(result.flagged).toHaveLength(1);
    expect(result.flagged[0].row.rowIndex).toBe(30);
    expect(result.flagged[0].reasons[0]).toEqual({
      field: 'mcc',
      kind: 'categorical-minority',
      value: 6051,
    });
  });
});
