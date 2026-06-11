/**
 * Ported from prior-art `@abc-budget/utils` → `numbers/parsing.spec.ts`.
 * Diff-audit: jest globals → vitest `import { describe, test, it, expect }`;
 * all assertions preserved verbatim.
 */
import { describe, expect, it, test } from 'vitest';
import { isNan, parseNumber } from './parsing';

describe('isNan', () => {
  test('should return true for null', () => {
    expect(isNan(null)).toBe(true);
  });

  test('should return true for NaN number', () => {
    expect(isNan(NaN)).toBe(true);
  });

  test('should return false for non-NaN number', () => {
    expect(isNan(123)).toBe(false);
  });

  test('should return true for string "NaN"', () => {
    expect(isNan('NaN')).toBe(true);
  });

  test('should return true for string "  NaN  " with extra spaces', () => {
    expect(isNan('  NaN  ')).toBe(true);
  });

  test('should return true for empty string', () => {
    expect(isNan('')).toBe(true);
  });

  test('should return true for dash', () => {
    expect(isNan('-')).toBe(true);
  });

  test('should return false for other strings', () => {
    expect(isNan('123')).toBe(false);
    expect(isNan('hello')).toBe(false);
  });

  test('should return false for undefined', () => {
    expect(isNan(undefined as unknown as number)).toBe(false);
  });

  test('should return true for string equivalent of valid NaN representations', () => {
    const NAN_STRING_VALUES = ['NaN', '+NaN', '-NaN']; // Add valid NaN-like strings for testing
    for (const val of NAN_STRING_VALUES) {
      expect(isNan(val)).toBe(true);
    }
  });

  test('should return false for unrelated data types', () => {
    expect(isNan([] as unknown as number)).toBe(false);
    expect(isNan({} as unknown as number)).toBe(false);
    expect(isNan(true as unknown as number)).toBe(false);
  });
});

describe('parseNumber', () => {
  describe('invalid and empty inputs', () => {
    it('returns NaN for null, undefined, and empty/whitespace-only strings', () => {
      expect(Number.isNaN(parseNumber(null as unknown as string))).toBe(true);
      expect(Number.isNaN(parseNumber(undefined as unknown as string))).toBe(
        true
      );
      expect(Number.isNaN(parseNumber(''))).toBe(true);
      expect(Number.isNaN(parseNumber('   '))).toBe(true);
    });

    it('returns NaN when containing unsupported characters', () => {
      expect(Number.isNaN(parseNumber('12a3'))).toBe(true);
      expect(Number.isNaN(parseNumber('$1,234.56'))).toBe(true);
      expect(Number.isNaN(parseNumber('1_234.56'))).toBe(true);
    });
  });

  describe('basic decimal formats', () => {
    it('parses standard dot-decimal format', () => {
      expect(parseNumber('1234567.89')).toBeCloseTo(1234567.89);
    });

    it('parses standard comma-decimal format', () => {
      expect(parseNumber('1.234.567,89')).toBeCloseTo(1234567.89);
    });
  });

  describe('thousand separators with commas and dots', () => {
    it('parses "1,234,567.89" as 1234567.89', () => {
      expect(parseNumber('1,234,567.89')).toBeCloseTo(1234567.89);
    });

    it('parses "1.234.567,89" as 1234567.89', () => {
      expect(parseNumber('1.234.567,89')).toBeCloseTo(1234567.89);
    });

    it('parses "1,234,567" as integer 1234567', () => {
      expect(parseNumber('1,234,567')).toBe(1234567);
    });

    it('parses "1.234.567" as integer 1234567', () => {
      expect(parseNumber('1.234.567')).toBe(1234567);
    });

    it('parses mixed separators "1,234.567" as 1234.567', () => {
      expect(parseNumber('1,234.567')).toBeCloseTo(1234.567);
    });

    it('parses mixed separators "1.234,567" as 1234.567', () => {
      expect(parseNumber('1.234,567')).toBeCloseTo(1234.567);
    });
  });

  describe('thousand separators with spaces and apostrophes', () => {
    it('parses with spaces as thousand separators and comma decimal', () => {
      expect(parseNumber('1 234 567,89')).toBeCloseTo(1234567.89);
    });

    it('parses with spaces as thousand separators and dot decimal', () => {
      expect(parseNumber('1 234 567.89')).toBeCloseTo(1234567.89);
    });

    it('parses with apostrophes as thousand separators and dot decimal', () => {
      expect(parseNumber("1'234'567.89")).toBeCloseTo(1234567.89);
    });

    it('parses with apostrophes as thousand separators and comma decimal', () => {
      expect(parseNumber("1'234'567,89")).toBeCloseTo(1234567.89);
    });

    it('parses integer with spaces as thousand separators', () => {
      expect(parseNumber('  1 234 567  ')).toBe(1234567);
    });
  });

  describe('negative numbers', () => {
    it('parses negative with comma thousand and dot decimal', () => {
      expect(parseNumber('-1,234.56')).toBeCloseTo(-1234.56);
    });

    it('parses negative with dot thousand and comma decimal', () => {
      expect(parseNumber('-1.234,56')).toBeCloseTo(-1234.56);
    });

    it('parses negative with space thousand and comma decimal', () => {
      expect(parseNumber('-1 234,56')).toBeCloseTo(-1234.56);
    });

    it('parses negative with apostrophe thousand and comma decimal', () => {
      expect(parseNumber("-1'234,56")).toBeCloseTo(-1234.56);
    });
  });
});
