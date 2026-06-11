/**
 * Lazy luxon seam.
 *
 * Exports `getLuxon()` — returns the luxon module via a cached dynamic import.
 * Using a dynamic import means the luxon bundle chunk is NOT included in the
 * boot/main chunk (tree-shaking + code-splitting friendly, same pattern as
 * `format-detector.ts`).
 *
 * Callers that need `DateTime` at runtime inside async paths:
 *
 *   const { DateTime } = await getLuxon();
 *   const dt = DateTime.fromFormat(s, fmt, { zone: 'utc', locale: 'en-US' });
 *
 * Type-only imports of luxon types still use `import type { DateTime } from 'luxon'`
 * (verbatimModuleSyntax-safe, zero runtime cost).
 */

/** Cached luxon module promise — resolved once, reused on every subsequent call. */
let _luxonPromise: Promise<typeof import('luxon')> | undefined;

/**
 * Returns the lazily-loaded luxon module.
 * The dynamic import is initiated on first call and cached for all subsequent calls.
 */
export function getLuxon(): Promise<typeof import('luxon')> {
  if (_luxonPromise === undefined) {
    _luxonPromise = import('luxon');
  }
  return _luxonPromise;
}
