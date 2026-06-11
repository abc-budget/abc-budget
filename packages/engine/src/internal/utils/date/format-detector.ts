/**
 * Date format detection functionality.
 * @module internal/utils/date/format-detector
 *
 * Ported from prior-art `@abc-budget/utils` → `date/format-detector.ts` with the
 * following adaptations (diff-audit):
 *
 * 1. **Lazy luxon** (plan §Task-1): `import { DateTime } from 'luxon'` removed.
 *    luxon is loaded via a dynamic `import()` inside `tryParseDate` so the bundle
 *    keeps luxon in a separate async chunk and the boot path stays clean.
 *
 * 2. **`detectDateFormat` signature delta** (REPORT):
 *    Prior-art: `detectDateFormat(…): string | null`  ← synchronous
 *    This port:  `detectDateFormat(…): Promise<string | null>` ← async
 *    Reason: the lazy `import('luxon')` inside `tryParseDate` is async, so every
 *    caller that touches `DateTime` must be in an async context.  `column.ts`'s
 *    call site will be updated in Task 3 accordingly.
 *
 * 3. **Pinned zone + locale** (plan §Task-1):
 *    Every `DateTime.fromFormat` call receives `{ zone: 'utc', locale: 'en-US' }`.
 *    This makes parse results invariant to the host's TZ env variable and system
 *    locale — required by HC-9 (deterministic format detection).
 *
 * 4. All other code (constants, helpers, logic) is verbatim from prior art.
 *    `sampleArray` import path updated to sibling `../collections/sampling`.
 */

import { sampleArray } from '../collections/sampling';

/**
 * Default acceptable percentage for successful date parses
 */
export const ACCEPTABLE_PARSE_PERCENTAGE = 90;

/**
 * List of supported date formats to check
 */
export const DATE_FORMATS = [
  'MM/dd/yyyy',
  'MM/dd/yy',
  'dd/MM/yyyy',
  'dd/MM/yy',
  'dd-MM-yyyy',
  'dd-MM-yy',
  'dd.MM.yyyy',
  'dd.MM.yy',
  'MM-dd-yyyy',
  'MM-dd-yy',
  'MM.dd.yyyy',
  'MM.dd.yy',
  'yyyy/MM/dd',
  'yy/MM/dd',
  'yyyy-MM-dd',
  'yy-MM-dd',
  'yyyy.MM.dd',
  'yyyyMMdd',
];

/**
 * Extracts the date part from a string that might contain both date and time.
 * (Verbatim from prior art.)
 *
 * @param dateString - The string that might contain date and time
 * @returns The date part of the string
 */
export function extractDatePart(dateString: string): string {
  if (!dateString) {
    return dateString;
  }

  // If the string contains time information, extract only the date part
  return dateString.split(/\s|T/)[0];
}

/**
 * Attempts to parse a string as a date using the specified format.
 *
 * Adaptation: luxon is loaded lazily via dynamic import so it lands in a
 * separate bundle chunk.  Each `DateTime.fromFormat` call is pinned to
 * `{ zone: 'utc', locale: 'en-US' }` for TZ/locale determinism (HC-9).
 *
 * @param dateString - The string to parse
 * @param format - The format to use for parsing
 * @returns Promise<true> if parsing was successful, Promise<false> otherwise
 */
export async function tryParseDate(
  dateString: string,
  format: string
): Promise<boolean> {
  if (!dateString) {
    return false;
  }

  // Extract only the date part
  const dateOnlyString = extractDatePart(dateString);

  // Lazy load luxon (separate async chunk; boot-path safe)
  const { DateTime } = await import('luxon');

  // Pinned zone + locale for TZ/locale determinism (HC-9)
  const parsed = DateTime.fromFormat(dateOnlyString, format, {
    zone: 'utc',
    locale: 'en-US',
  });

  return parsed.isValid;
}

/**
 * Calculates the percentage of strings in an array that can be parsed using a
 * specific date format.
 *
 * Adaptation: async because `tryParseDate` is now async.
 *
 * @param strings - Array of strings to check
 * @param format - Date format to use for parsing
 * @returns Promise<number> — percentage of strings that can be parsed (0–100)
 */
export async function calculateFormatMatchPercentage(
  strings: string[],
  format: string
): Promise<number> {
  if (!strings || strings.length === 0) {
    return 0;
  }

  const results = await Promise.all(
    strings.map((str) => tryParseDate(str, format))
  );
  const successfulParses = results.filter(Boolean).length;
  return (successfulParses / strings.length) * 100;
}

/**
 * Detects the most appropriate date format for an array of strings.
 *
 * **Signature delta vs prior art:**
 * Prior art returned `string | null` (sync).  This version returns
 * `Promise<string | null>` (async) due to the lazy luxon seam.
 *
 * @param strings              - Array of strings containing dates
 * @param samplePercentage     - Percentage of strings to sample (default: 10)
 * @param maxSampleSize        - Maximum sample size (default: 1000)
 * @param minSampleSize        - Minimum sample size (default: 100)
 * @param acceptablePercentage - Minimum acceptable % of successful parses (default: ACCEPTABLE_PARSE_PERCENTAGE)
 * @param formats              - Array of date formats to check (default: DATE_FORMATS)
 * @returns Promise<string | null> — best-matching format, or null if none qualifies
 */
export async function detectDateFormat(
  strings: string[],
  samplePercentage = 10,
  maxSampleSize = 1000,
  minSampleSize = 100,
  acceptablePercentage: number = ACCEPTABLE_PARSE_PERCENTAGE,
  formats: string[] = DATE_FORMATS
): Promise<string | null> {
  if (!strings || strings.length === 0 || !formats || formats.length === 0) {
    return null;
  }

  // Take a sample of the input strings (deterministic via HC-9 sampleArray)
  const sample = sampleArray(
    strings,
    samplePercentage,
    maxSampleSize,
    minSampleSize
  );

  // Calculate match percentage for each format
  const formatResults = await Promise.all(
    formats.map(async (format) => ({
      format,
      percentage: await calculateFormatMatchPercentage(sample, format),
    }))
  );

  // Sort by percentage (descending)
  formatResults.sort((a, b) => b.percentage - a.percentage);

  // Return the format with the highest percentage if it meets the acceptable threshold
  return formatResults[0].percentage >= acceptablePercentage
    ? formatResults[0].format
    : null;
}
