/**
 * detect.spec.ts — TDD for resolveCurrency (ENT-011)
 *
 * Five cases from the plan (verbatim):
 *   1. 'auto' + symbol '₴' + base 'USD'  → 'UAH'   (column value, symbol-normalised)
 *   2. 'auto' + undefined column + 'USD' → 'USD'   (no column → base)
 *   3. 'use_base' + 'EUR' + 'USD'        → 'USD'   (ignores column)
 *   4. { code: 'PLN' } + 'EUR' + 'USD'  → 'PLN'   (override)
 *   5. 'auto' + 'XXNOPE' + 'USD'         → throws  (unknown symbol — EP-2 data problem)
 */
import { describe, it, expect } from 'vitest';
import { resolveCurrency } from './detect';

describe('resolveCurrency', () => {
  it('auto + symbol → resolved ISO code', () => {
    expect(resolveCurrency('auto', '₴', 'USD')).toBe('UAH');
  });

  it('auto + undefined column → base currency', () => {
    expect(resolveCurrency('auto', undefined, 'USD')).toBe('USD');
  });

  it('use_base → always returns base (ignores column)', () => {
    expect(resolveCurrency('use_base', 'EUR', 'USD')).toBe('USD');
  });

  it('{ code } override → always returns the override code', () => {
    expect(resolveCurrency({ code: 'PLN' }, 'EUR', 'USD')).toBe('PLN');
  });

  it('auto + unknown symbol → throws a descriptive Error (EP-2 fail-loud)', () => {
    expect(() => resolveCurrency('auto', 'XXNOPE', 'USD')).toThrow(
      /XXNOPE/,
    );
  });
});

