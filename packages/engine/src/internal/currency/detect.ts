/**
 * ENT-011 currency resolver.
 *
 * CurrencyDetectOptions:
 *   'auto'      — inspect the column value; fall back to base when column absent.
 *   'use_base'  — always use the budget's base currency.
 *   { code }    — unconditional override.
 *
 * Fail-loud contract (EP-2):
 *   When mode is 'auto' and a column value is present but does not resolve to a
 *   known ISO code via symbolToIso, resolveCurrency THROWS a descriptive Error.
 *   A non-empty column value that is unrecognised is a data problem that must
 *   surface, not silently degrade to the base currency.
 */
import { symbolToIso } from './reference';

/** Governs how EP-2 resolves the currency for a parsed transaction row. */
export type CurrencyDetectOptions = 'auto' | 'use_base' | { code: string };

/**
 * Resolves the effective ISO currency code for a transaction row.
 *
 * @param options   Detection mode (see CurrencyDetectOptions).
 * @param column    Raw cell value from the currency column (may be undefined
 *                  when the column is absent or blank).
 * @param base      The budget's base currency ISO code (e.g. 'USD').
 * @returns         Resolved ISO currency code.
 * @throws {Error}  In 'auto' mode, if `column` is a non-empty string that
 *                  cannot be resolved to an ISO code.
 */
export function resolveCurrency(
  options: CurrencyDetectOptions,
  column: string | undefined,
  base: string,
): string {
  // { code } override — unconditional
  if (typeof options === 'object' && 'code' in options) {
    return options.code;
  }

  // use_base — always return base
  if (options === 'use_base') {
    return base;
  }

  // 'auto' — resolve from column, or fall back to base when column absent
  if (column === undefined || column === '') {
    return base;
  }

  const resolved = symbolToIso(column);
  if (resolved === undefined) {
    throw new Error(
      `resolveCurrency: unknown currency symbol or code "${column}" ` +
        `(base: ${base}). ` +
        `Check the currency column value — this is a data problem (EP-2).`,
    );
  }
  return resolved;
}
