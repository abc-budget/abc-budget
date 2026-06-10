/**
 * Dataset inspection notes (currencies.json, 233 entries):
 *  - '$':  only USD has en.symbol === '$'; no other entry uses '$' → unambiguously USD.
 *  - 'kr': NOT present in the dataset (not in any en/uk symbol or specialSymbols field).
 *          'kr' is therefore treated as unknown → undefined.
 *  - '₴':  UAH uk.symbol === '₴'; UAH specialSymbols includes ['₴','грн'].
 *          Exact-symbol match (en or uk) takes priority over specialSymbols lookup.
 *  - symbolToIso ambiguity rule: exact en/uk symbol match wins; if still ambiguous, first
 *    entry in dataset order wins.  Code passthrough ('UAH' → 'UAH') checked before all.
 */
import { describe, it, expect } from 'vitest';
import {
  getCurrency,
  displayName,
  symbol,
  formatAmount,
  symbolToIso,
  localeToCurrency,
} from './reference';

describe('getCurrency', () => {
  it('returns the UAH entry with correct fractionDigits', () => {
    const uah = getCurrency('UAH');
    expect(uah).toBeDefined();
    expect(uah!.defaultFractionDigits).toBe(2);
    expect(uah!.code).toBe('UAH');
  });

  it('returns JPY with 0 fraction digits', () => {
    const jpy = getCurrency('JPY');
    expect(jpy).toBeDefined();
    expect(jpy!.defaultFractionDigits).toBe(0);
  });

  it('returns KWD with 3 fraction digits', () => {
    const kwd = getCurrency('KWD');
    expect(kwd).toBeDefined();
    expect(kwd!.defaultFractionDigits).toBe(3);
  });

  it('returns undefined for unknown code', () => {
    expect(getCurrency('XXXX')).toBeUndefined();
  });
});

describe('displayName', () => {
  it('returns Ukrainian name for UAH in uk', () => {
    expect(displayName('UAH', 'uk')).toBe('Українська гривня');
  });

  it('returns English name for UAH in en', () => {
    expect(displayName('UAH', 'en')).toBe('Ukrainian Hryvnia');
  });
});

describe('symbol', () => {
  it('returns ₴ for UAH in uk', () => {
    expect(symbol('UAH', 'uk')).toBe('₴');
  });

  it('returns UAH string for UAH in en (dataset has no dedicated en symbol)', () => {
    expect(symbol('UAH', 'en')).toBe('UAH');
  });
});

describe('formatAmount', () => {
  /**
   * Assertions use Intl.NumberFormat expectations (never hardcoded separator strings).
   * The reference format is built with the SAME params and compared structurally.
   */

  function intlExpect(amount: number, locale: string, fractionDigits: number, sym: string) {
    const formatted = new Intl.NumberFormat(locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount);
    // The formatted output should appear somewhere in the full formatted+symbol string
    return { numericPart: formatted, sym };
  }

  it('formats UAH in uk with 2 fraction digits and ₴ symbol', () => {
    const result = formatAmount(1234.5, 'UAH', 'uk');
    const { numericPart, sym } = intlExpect(1234.5, 'uk', 2, '₴');
    expect(result).toContain(numericPart);
    expect(result).toContain(sym);
  });

  it('formats UAH in en with 2 fraction digits and UAH symbol', () => {
    const result = formatAmount(1234.5, 'UAH', 'en');
    const { numericPart, sym } = intlExpect(1234.5, 'en', 2, 'UAH');
    expect(result).toContain(numericPart);
    expect(result).toContain(sym);
  });

  it('formats JPY in uk with 0 fraction digits', () => {
    const result = formatAmount(1234, 'JPY', 'uk');
    const { numericPart, sym } = intlExpect(1234, 'uk', 0, '¥');
    expect(result).toContain(numericPart);
    expect(result).toContain(sym);
  });

  it('formats JPY in en with 0 fraction digits', () => {
    const result = formatAmount(1234, 'JPY', 'en');
    const { numericPart, sym } = intlExpect(1234, 'en', 0, '¥');
    expect(result).toContain(numericPart);
    expect(result).toContain(sym);
  });

  it('formats KWD in uk with 3 fraction digits', () => {
    const result = formatAmount(1234.5, 'KWD', 'uk');
    const { numericPart, sym } = intlExpect(1234.5, 'uk', 3, 'KWD');
    expect(result).toContain(numericPart);
    expect(result).toContain(sym);
  });

  it('formats KWD in en with 3 fraction digits', () => {
    const result = formatAmount(1234.5, 'KWD', 'en');
    const { numericPart, sym } = intlExpect(1234.5, 'en', 3, 'KWD');
    expect(result).toContain(numericPart);
    expect(result).toContain(sym);
  });
});

describe('symbolToIso', () => {
  it('resolves ₴ → UAH (exact uk.symbol match)', () => {
    expect(symbolToIso('₴')).toBe('UAH');
  });

  it('resolves грн → UAH (specialSymbols)', () => {
    expect(symbolToIso('грн')).toBe('UAH');
  });

  it('passes through ISO code UAH → UAH', () => {
    expect(symbolToIso('UAH')).toBe('UAH');
  });

  it('resolves $ → USD (only USD has $ as en.symbol)', () => {
    expect(symbolToIso('$')).toBe('USD');
  });

  it('returns undefined for kr (not in dataset)', () => {
    // 'kr' does not appear in any en/uk symbol or specialSymbols in the 233-entry dataset.
    expect(symbolToIso('kr')).toBeUndefined();
  });

  it('returns undefined for completely unknown symbol', () => {
    expect(symbolToIso('ZZZNOPE')).toBeUndefined();
  });
});

describe('localeToCurrency', () => {
  it('resolves uk_UA → UAH', () => {
    expect(localeToCurrency('uk_UA')).toBe('UAH');
  });

  it('resolves uk-UA (BCP-47 dash) → UAH via dash→underscore normalization', () => {
    expect(localeToCurrency('uk-UA')).toBe('UAH');
  });

  it('returns undefined for unknown locale', () => {
    expect(localeToCurrency('xx_ZZ')).toBeUndefined();
  });
});
