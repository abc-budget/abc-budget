/**
 * Ported from prior-art `@abc-budget/utils` → `date/format-detector.spec.ts`.
 *
 * Diff-audit vs prior art:
 *   1. `@jest-environment jsdom` pragma removed (vitest node env; luxon works without jsdom).
 *   2. `import { describe, it, expect }` added (vitest).
 *   3. All `detectDateFormat(...)` calls now `await`-ed (async seam, Task 1).
 *   4. All `tryParseDate(...)` calls now `await`-ed (async seam, Task 1).
 *   5. `calculateFormatMatchPercentage(...)` calls now `await`-ed (async seam, Task 1).
 *   6. All test functions marked `async` where they await.
 *   7. All assertions preserved verbatim — no logic changes.
 */
import { describe, expect, it } from 'vitest';
import {
  calculateFormatMatchPercentage,
  detectDateFormat,
  extractDatePart,
  tryParseDate,
} from './format-detector';

describe('tryParseDate', () => {
  it('should return false for empty string', async () => {
    expect(await tryParseDate('', 'MM/dd/yyyy')).toBe(false);
  });

  it('should return true for valid date string matching format', async () => {
    expect(await tryParseDate('01/15/2023', 'MM/dd/yyyy')).toBe(true);
  });

  it('should return false for valid date string not matching format', async () => {
    expect(await tryParseDate('15/01/2023', 'MM/dd/yyyy')).toBe(false);
  });

  it('should handle date strings with time information', async () => {
    expect(await tryParseDate('01/15/2023 14:30:00', 'MM/dd/yyyy')).toBe(true);
    expect(await tryParseDate('2023-01-15T14:30:00', 'yyyy-MM-dd')).toBe(true);
  });
});

describe('calculateFormatMatchPercentage', () => {
  it('should return 0 for empty array', async () => {
    expect(await calculateFormatMatchPercentage([], 'MM/dd/yyyy')).toBe(0);
  });

  it('should return 100 when all strings match the format', async () => {
    const dates = ['01/15/2023', '02/20/2023', '03/25/2023'];
    expect(await calculateFormatMatchPercentage(dates, 'MM/dd/yyyy')).toBe(100);
  });

  it('should return correct percentage when some strings match the format', async () => {
    const dates = ['01/15/2023', '02/20/2023', '2023-03-25', '04/30/2023'];
    expect(await calculateFormatMatchPercentage(dates, 'MM/dd/yyyy')).toBe(75); // 3 out of 4 = 75%
  });
});

describe('extractDatePart', () => {
  it('should return empty string for empty input', () => {
    expect(extractDatePart('')).toBe('');
  });

  it('should return the same string if no time part is present', () => {
    expect(extractDatePart('2023-01-15')).toBe('2023-01-15');
    expect(extractDatePart('01/15/2023')).toBe('01/15/2023');
    expect(extractDatePart('15.01.2023')).toBe('15.01.2023');
  });

  it('should extract date part when time is separated by space', () => {
    expect(extractDatePart('2023-01-15 14:30:00')).toBe('2023-01-15');
    expect(extractDatePart('01/15/2023 14:30:00')).toBe('01/15/2023');
    expect(extractDatePart('15.01.2023 14:30:00')).toBe('15.01.2023');
  });

  it('should extract date part when time is separated by T', () => {
    expect(extractDatePart('2023-01-15T14:30:00')).toBe('2023-01-15');
    expect(extractDatePart('01/15/2023T14:30:00')).toBe('01/15/2023');
    expect(extractDatePart('15.01.2023T14:30:00')).toBe('15.01.2023');
  });
});

describe('detectDateFormat', () => {
  it('should return null for empty array', async () => {
    expect(await detectDateFormat([])).toBeNull();
  });

  it('should detect MM/dd/yyyy format', async () => {
    const dates = ['01/15/2023', '02/20/2023', '03/25/2023', '04/30/2023'];
    expect(await detectDateFormat(dates)).toBe('MM/dd/yyyy');
  });

  it('should detect yyyy-MM-dd format', async () => {
    const dates = ['2023-01-15', '2023-02-20', '2023-03-25', '2023-04-30'];
    expect(await detectDateFormat(dates)).toBe('yyyy-MM-dd');
  });

  it('should detect dd.MM.yyyy format', async () => {
    const dates = ['15.01.2023', '20.02.2023', '25.03.2023', '30.04.2023'];
    expect(await detectDateFormat(dates)).toBe('dd.MM.yyyy');
  });

  it('should detect yyyyMMdd format', async () => {
    const dates = ['20230115', '20230220', '20230325', '20230430'];
    expect(await detectDateFormat(dates)).toBe('yyyyMMdd');
  });

  it('should return null when no format meets the acceptable percentage', async () => {
    const dates = [
      '01/15/2023', // MM/dd/yyyy
      '15/01/2023', // dd/MM/yyyy
      '2023-01-15', // yyyy-MM-dd
      '15.01.2023', // dd.MM.yyyy
      '01-15-2023', // MM-dd-yyyy
    ];
    expect(await detectDateFormat(dates)).toBeNull();
  });

  it('should prioritize formats based on order when percentages are equal', async () => {
    // Both MM/dd/yyyy and dd/MM/yyyy could be valid for these dates
    const dates = ['01/01/2023', '02/02/2023', '03/03/2023'];
    expect(await detectDateFormat(dates)).toBe('MM/dd/yyyy'); // First in the list
  });

  it('should handle date strings with time information', async () => {
    const dates = [
      '01/15/2023 14:30:00',
      '02/20/2023 15:45:00',
      '03/25/2023 16:00:00',
    ];
    expect(await detectDateFormat(dates)).toBe('MM/dd/yyyy');
  });

  it('should return null when percentage is just below acceptable threshold', async () => {
    // 8 out of 9 = 88.888... which is just below default 90%
    const dates = [
      '01/01/2023',
      '02/01/2023',
      '03/01/2023',
      '04/01/2023',
      '05/01/2023',
      '06/01/2023',
      '07/01/2023',
      '08/01/2023',
      '2023-09-01', // one non-matching
    ];
    expect(await detectDateFormat(dates)).toBeNull();
  });

  it('should use custom formats when provided', async () => {
    const dates = ['15.01.2023', '20.02.2023', '25.03.2023'];
    const customFormats = ['dd.MM.yyyy', 'yyyy-MM-dd'];
    expect(
      await detectDateFormat(dates, 100, 100, 1, 90, customFormats)
    ).toBe('dd.MM.yyyy');
  });

  it('should use custom acceptable percentage when provided', async () => {
    const dates = [
      '01/15/2023',
      '02/20/2023',
      '03/25/2023', // 60% MM/dd/yyyy
      '2023-01-15',
      '2023-02-20', // 40% yyyy-MM-dd
    ];
    // With 90% threshold, should return null
    expect(await detectDateFormat(dates)).toBeNull();
    // With 50% threshold, should detect MM/dd/yyyy
    expect(await detectDateFormat(dates, 100, 100, 1, 50)).toBe('MM/dd/yyyy');
  });
});

describe('two-digit year support', () => {
  it('should parse two-digit years for MM/dd/yy in tryParseDate', async () => {
    expect(await tryParseDate('01/15/23', 'MM/dd/yy')).toBe(true);
  });

  it('should detect two-digit year format MM/dd/yy', async () => {
    const dates = ['01/15/23', '02/20/23', '03/25/23', '04/30/23'];
    expect(
      await detectDateFormat(dates, 100, 100, 1, 90, ['MM/dd/yy', 'MM/dd/yyyy'])
    ).toBe('MM/dd/yy');
  });
});

describe('extractDatePart mixed whitespace', () => {
  it('should extract date when separated by tabs and multiple spaces', () => {
    expect(extractDatePart('2023-01-15\t14:30:00')).toBe('2023-01-15');
    expect(extractDatePart('2023-01-15    14:30:00')).toBe('2023-01-15');
  });
});
