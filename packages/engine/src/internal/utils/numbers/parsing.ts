/**
 * Number parsing utilities
 * @module numbers/parsing
 *
 * Ported verbatim from prior-art `@abc-budget/utils` → `numbers/parsing.ts`.
 * Diff-audit: zero changes — pure port, no adaptation required.
 */

/**
 * Array of string values that are considered equivalent to NaN
 * Based on pandas NA values with additional custom values
 */
export const NAN_STRING_VALUES = [
  'NaN',
  'nan',
  '+NaN',
  '-NaN',
  'NA',
  'N/A',
  'na',
  'n/a',
  'null',
  'NULL',
  'None',
  'none',
  '', // empty string
  '-',
  '—', // dash and em dash
];

/**
 * Checks if a value is NaN or a string equivalent of NaN
 *
 * @param value The value to check
 * @returns True if the value is NaN or a string equivalent of NaN, false otherwise
 */
export function isNan(value: null | string | number): boolean {
  if (value === null) {
    return true;
  }

  if (typeof value === 'number') {
    return isNaN(value);
  }

  if (typeof (value as unknown) === 'string') {
    return NAN_STRING_VALUES.includes(value.trim());
  }

  return false;
}

/**
 * Parses a string as a number, supporting various number formats:
 * - 1234567.89
 * - 1,234,567.89
 * - 1.234.567,89
 * - 1 234 567,89
 * - 1 234 567.89
 * - 1'234'567.89
 * - 1'234'567,89
 *
 * @param value The string to parse
 * @returns The parsed number or NaN if the string cannot be parsed
 */
export function parseNumber(value: string): number {
  if (value === null || value === undefined || value.trim() === '') {
    return NaN;
  }

  // Remove any whitespace
  let cleanValue = value.trim();

  // Check if the string contains any non-numeric characters other than formatting characters
  if (/[^\d\s,.'-]/.test(cleanValue)) {
    return NaN;
  }

  // Count occurrences of potential separators
  const dotCount = (cleanValue.match(/\./g) || []).length;
  const commaCount = (cleanValue.match(/,/g) || []).length;

  // Determine the decimal separator based on the rules:
  // If dotCount > 1 then decimalSeparator is ','
  // If commaCount > 1 then decimalSeparator is '.'
  // Otherwise, check lastDot and lastComma
  let decimalSeparator;
  if (dotCount > 1) {
    decimalSeparator = ',';
  } else if (commaCount > 1) {
    decimalSeparator = '.';
  } else {
    // Determine the decimal separator (last '.' or ',' in the string)
    const lastDot = cleanValue.lastIndexOf('.');
    const lastComma = cleanValue.lastIndexOf(',');
    // The decimal separator is the one that appears last
    decimalSeparator = lastDot > lastComma ? '.' : ',';
  }

  // Handle special case where spaces or apostrophes are used as thousand separators
  if (cleanValue.includes(' ') || cleanValue.includes("'")) {
    // Replace spaces or apostrophes with a standard thousand separator
    cleanValue = cleanValue.replace(/ /g, '').replace(/'/g, '');

    // If we have a comma as decimal separator, replace it with a dot for parsing
    if (decimalSeparator === ',') {
      // Replace all dots (thousand separators) with empty string
      cleanValue = cleanValue.replace(/\./g, '');
      // Replace the comma (decimal separator) with a dot
      cleanValue = cleanValue.replace(',', '.');
    } else {
      // Replace all commas (thousand separators) with empty string
      cleanValue = cleanValue.replace(/,/g, '');
    }
  } else {
    // Standard case with dots and commas
    if (decimalSeparator === '.') {
      // Remove all commas (thousand separators)
      cleanValue = cleanValue.replace(/,/g, '');
    } else {
      // Remove all dots (thousand separators)
      cleanValue = cleanValue.replace(/\./g, '');
      // Replace the comma (decimal separator) with a dot for parsing
      cleanValue = cleanValue.replace(',', '.');
    }
  }

  // Parse the cleaned value and ensure it's a valid number
  const result = parseFloat(cleanValue);
  return isNaN(result) ? NaN : result;
}
