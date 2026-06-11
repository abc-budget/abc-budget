/**
 * TDD spec for deterministic sampleArray (HC-9 mandate).
 *
 * Port of prior-art `@abc-budget/utils` → `collections/sampling.spec.ts` with
 * two critical additions that verify the HC-9 replacement:
 *   1. Determinism: same input → same output across two calls.
 *   2. Even spacing: 10-of-100 → indices 0, 10, 20, …, 90.
 *
 * Diff-audit vs prior art:
 *   - `jest.fn()` / jest globals absent in original spec; vitest imports added.
 *   - "does not mutate" case: prior art's Fisher-Yates mutated a copy internally
 *     (the `arrayCopy`). Deterministic code never touches input — assertion still passes.
 *   - "returns unique elements" case: evenly-spaced indices are always unique when
 *     `sampleSize < array.length`, so assertion is preserved without change.
 *   - NEW: determinism cases + even-spacing case added (HC-9 TDD).
 */
import { describe, expect, it } from 'vitest';
import { sampleArray } from './sampling';

describe('sampleArray', () => {
  // ─── Ported clamp/size cases (verbatim from prior art) ──────────────────

  it('returns empty array for empty input', () => {
    expect(sampleArray([], 10, 100, 10)).toEqual([]);
    // also handles falsy input defensively
    // @ts-expect-error intentional wrong type for test
    expect(sampleArray(undefined, 10, 100, 10)).toEqual([]);
  });

  it('returns entire array when sample size >= array length (percentage 100)', () => {
    const array = [1, 2, 3, 4, 5];
    const result = sampleArray(array, 100, 100, 0);
    expect(result).toEqual(array);
    expect(result).not.toBe(array); // should be a copy, not the same reference
  });

  it('respects the percentage parameter (ceil rounding)', () => {
    const array = Array.from({ length: 100 }, (_, i) => i);
    expect(sampleArray(array, 10, 100, 1).length).toBe(10); // 10% of 100 -> 10

    const array10 = Array.from({ length: 3 }, (_, i) => i);
    // ceil(3 * 10% = 0.3) -> 1
    expect(sampleArray(array10, 10, 100, 0).length).toBe(1);
  });

  it('respects maxElements parameter (caps the percentage result)', () => {
    const array = Array.from({ length: 100 }, (_, i) => i);
    // 50% would be 50, but max is 20
    expect(sampleArray(array, 50, 20, 1).length).toBe(20);
  });

  it('respects minElements parameter (raises the percentage result)', () => {
    const array = Array.from({ length: 100 }, (_, i) => i);
    // 1% would be 1, but min is 5
    expect(sampleArray(array, 1, 100, 5).length).toBe(5);
  });

  it('clamps percentage below 0 to 0 and above 100 to 100', () => {
    const array = Array.from({ length: 10 }, (_, i) => i);
    // negative percentage -> 0, with min 0 and max large -> 0
    expect(sampleArray(array, -50, 100, 0).length).toBe(0);
    // over 100 -> treated as 100 -> returns full array (copy)
    const result = sampleArray(array, 150, 1000, 0);
    expect(result).toEqual(array);
    expect(result).not.toBe(array);
  });

  it('when maxElements < minElements, minElements wins after constraints', () => {
    const array = Array.from({ length: 50 }, (_, i) => i);
    // percentage suggests 25, max=3 reduces to 3, then min=10 raises to 10
    const result = sampleArray(array, 50, 3, 10);
    expect(result.length).toBe(10);
  });

  it('zero maxElements leads to zero sample unless raised by minElements', () => {
    const array = Array.from({ length: 10 }, (_, i) => i);
    expect(sampleArray(array, 50, 0, 0).length).toBe(0);
    expect(sampleArray(array, 50, 0, 3).length).toBe(3);
  });

  it('minElements is clamped to array length', () => {
    const array = [1, 2, 3];
    // minElements=10 should clamp to 3 -> return entire array (copy)
    const result = sampleArray(array, 1, 100, 10);
    expect(result).toEqual(array);
    expect(result).not.toBe(array);
  });

  it('does not mutate the input array', () => {
    const array = [1, 2, 3, 4, 5, 6];
    const copyBefore = [...array];
    sampleArray(array, 50, 100, 0);
    expect(array).toEqual(copyBefore);
    expect(array).toBe(array); // still same reference (sanity)
  });

  it('returns unique elements that are all from the original array', () => {
    const array = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = sampleArray(array, 30, 100, 0);
    // all elements are from original
    expect(result.every((x) => array.includes(x))).toBe(true);
    // uniqueness (evenly-spaced indices are always distinct when sampleSize < length)
    expect(new Set(result).size).toBe(result.length);
  });

  // ─── HC-9 NEW: determinism cases ────────────────────────────────────────

  it('determinism: same input produces identical output on two calls (HC-9)', () => {
    const array = Array.from({ length: 200 }, (_, i) => i);
    const first = sampleArray(array, 15, 50, 5);
    const second = sampleArray(array, 15, 50, 5);
    expect(first).toEqual(second);
  });

  it('determinism: string array, same output twice (HC-9)', () => {
    const array = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const first = sampleArray(array, 50, 100, 1);
    const second = sampleArray(array, 50, 100, 1);
    expect(first).toEqual(second);
  });

  // ─── HC-9 NEW: even spacing ──────────────────────────────────────────────

  it('even spacing: 10-of-100 → indices 0, 10, 20, …, 90 (HC-9)', () => {
    const array = Array.from({ length: 100 }, (_, i) => i); // [0..99]
    // sampleSize = ceil(100 × 10 / 100) = 10; no clamp needed with max=10, min=1
    const result = sampleArray(array, 10, 10, 1);
    expect(result).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it('even spacing: 4-of-8 → indices 0, 2, 4, 6', () => {
    const array = [10, 20, 30, 40, 50, 60, 70, 80]; // length 8
    // ceil(8 × 50 / 100) = 4
    const result = sampleArray(array, 50, 100, 0);
    expect(result).toEqual([10, 30, 50, 70]);
  });

  it('even spacing: single element sample picks first element', () => {
    const array = [100, 200, 300, 400, 500];
    // maxElements=1 forces sampleSize to 1
    const result = sampleArray(array, 100, 1, 0);
    expect(result).toEqual([100]); // floor(0 × 5 / 1) = 0
  });

  it('full-array passthrough when sampleSize >= length', () => {
    const array = [1, 2, 3];
    // minElements=10 clamped to 3; sampleSize >= length → [...array]
    const result = sampleArray(array, 10, 100, 10);
    expect(result).toEqual([1, 2, 3]);
    expect(result).not.toBe(array);
  });
});
