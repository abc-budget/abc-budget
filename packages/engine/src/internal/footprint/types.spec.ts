/**
 * types.spec.ts — Story 3.3 (EP-3): the FootprintRecord minimization contract.
 *
 * The footprint row is the ONLY footprint persistence shape (ENT-001, HC-2/3,
 * VIS-002) and holds EXACTLY 6 fields. This spec enforces that at COMPILE TIME:
 * a type-level exact-key guard so that adding a 7th field FAILS THE BUILD (the
 * engine typecheck, tsc -b). A tiny runtime check mirrors it at the value level.
 *
 * The 6th field, `isManual` (Story 4.4), is a privacy-neutral 0|1 flag recording
 * the categorization SOURCE — it carries NO identifying text, so the pin moving
 * 5→6 keeps VIS-002 minimization intact (the row stays non-reconstructable).
 */

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { FootprintRecord } from './types';

/**
 * True only when A and B have the SAME key set (mutual subset). One-directional
 * `extends` would let a 6th field slip through, so we check both directions.
 */
type KeysEqual<A, B> = [keyof A] extends [keyof B]
  ? [keyof B] extends [keyof A]
    ? true
    : false
  : false;

/** The exact key set the footprint is allowed to have — no more, no less. */
type ExactShape = { year: 0; month: 0; amountUSD: 0; categoryId: 0; hash: 0; isManual: 0 };

// COMPILE-TIME exact-key guard: flips to `false` (build error) if FootprintRecord
// gains or loses a key relative to ExactShape. Adding a 7th field fails here.
const _exact: KeysEqual<FootprintRecord, ExactShape> = true;
void _exact;

describe('FootprintRecord — minimization contract (ENT-001)', () => {
  it('has EXACTLY the 6 allowed keys at the type level', () => {
    expectTypeOf<keyof FootprintRecord>().toEqualTypeOf<
      'year' | 'month' | 'amountUSD' | 'categoryId' | 'hash' | 'isManual'
    >();
  });

  it('a valid record literal has exactly 6 keys at runtime', () => {
    const rec: FootprintRecord = {
      year: 2026,
      month: 6,
      amountUSD: 12.34,
      categoryId: null,
      hash: 'a1b2c3',
      isManual: 0,
    };
    expect(Object.keys(rec).sort()).toEqual([
      'amountUSD',
      'categoryId',
      'hash',
      'isManual',
      'month',
      'year',
    ]);
  });
});
