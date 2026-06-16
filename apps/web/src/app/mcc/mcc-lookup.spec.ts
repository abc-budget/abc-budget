/**
 * Unit tests for mccTitle (mcc-lookup.ts).
 *
 * The table is a plain JSON import — no network, no async. These tests assert
 * the lookup is a pure, synchronous map read and that `fetch` is never called.
 */

import { describe, expect, it, vi } from 'vitest';
import { mccTitle } from './mcc-lookup';

describe('mccTitle', () => {
  it('resolves a known code in uk and en', () => {
    // 5411 = grocery (present in the vendored table).
    expect(mccTitle(5411, 'uk')).toBe('Продукти');
    expect(mccTitle(5411, 'en')).toBe('Grocery');
  });

  it('resolves another known code (fast food) in both languages', () => {
    expect(mccTitle(5814, 'uk')).toBe('Фаст-фуд');
    expect(mccTitle(5814, 'en')).toBe('Fast Food');
  });

  it('falls back to the bare "dddd" code for an absent code', () => {
    // 9998 is not present in the vendored table.
    expect(mccTitle(9998, 'en')).toBe('9998');
    expect(mccTitle(9998, 'uk')).toBe('9998');
  });

  it('zero-pads short codes to 4 digits in the fallback', () => {
    // 1 has no entry → padded bare code.
    expect(mccTitle(1, 'en')).toBe('0001');
  });

  it('returns the stable null fallback for null', () => {
    expect(mccTitle(null, 'en')).toBe('—');
    expect(mccTitle(null, 'uk')).toBe('—');
  });

  it('never resolves the _meta provenance key as a code', () => {
    // No numeric input pads to "_meta", but the lookup must not leak it.
    const all = [5411, 9998, 1, 0].map((c) => mccTitle(c, 'en'));
    expect(all).not.toContain('MIT');
  });

  it('performs NO network — fetch is never called', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      mccTitle(5411, 'en');
      mccTitle(9998, 'uk');
      mccTitle(null, 'en');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('is synchronous (returns a string, not a Promise)', () => {
    const result = mccTitle(5411, 'en');
    expect(typeof result).toBe('string');
    expect(result).not.toBeInstanceOf(Promise);
  });
});
