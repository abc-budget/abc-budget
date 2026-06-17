/**
 * Pure footprint derivation from a transaction row (Story 3.3, EP-3).
 * @module internal/footprint/derive-footprint
 * @internal
 *
 * Maps a stage-3 `TransactionRow` + its USD amount onto the persisted
 * `FootprintRecord` shape (ENT-001). PURE: no I/O, no `Date.now()`, no
 * re-hashing, no rate lookup — synchronous and deterministic.
 *
 * The calendar split (year/month) comes from the OPERATION date (`row.date`),
 * read via UTC accessors. `amountUSD` is passed in (not computed here) so this
 * stays rate-free; `categoryId` is the RESOLVED category id (default null until
 * a categorized commit supplies one); `isManual` records the categorization
 * SOURCE (1=manual, 0=derived; default 0); `hash` is the 3.2 dup-wrapped final
 * hash, carried through verbatim.
 */

import type { FootprintRecord } from './types';
import type { TransactionRow } from '../importStatement/stage3/types';

/**
 * THE single footprint period derivation: a transaction date → its `(year,month)`.
 *
 * UTC accessors are MANDATORY here — this is the seam with the rate-date key.
 * The rate cache formats its lookup date via `date.toISOString()` (i.e. UTC), so
 * the year/month split MUST use the same UTC calendar day. Using local-time
 * accessors (`getFullYear()` / `getMonth()`) would let the footprint's
 * year/month and the rate lookup land on different calendar days under a
 * non-UTC host TZ (e.g. a 02:00Z operation reads as the previous day locally in
 * the Americas), silently desyncing the two.
 *
 * SINGLE SOURCE OF TRUTH (4.4.1): the override-map composite key
 * (`overrideKeyForRow` in `../rules/categorize-with-overrides`) REUSES this
 * helper, so a row and its persisted footprint compute the SAME `(year,month)`
 * — and therefore the SAME override key — by construction.
 */
export function footprintYearMonth(date: Date): { year: number; month: number } {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1, // getUTCMonth() is 0-based; footprint month is 1–12
  };
}

/**
 * Derives the persisted footprint record for a transaction row.
 *
 * The calendar split delegates to {@link footprintYearMonth} (the single UTC
 * period derivation) — behavior is identical to the prior inline accessors.
 */
export function deriveFootprint(
  row: TransactionRow,
  amountUSD: number,
  categoryId: string | null = null,
  isManual: 0 | 1 = 0
): FootprintRecord {
  const { year, month } = footprintYearMonth(row.date);
  return {
    year,
    month,
    amountUSD, // kept separate so derive stays rate-free and synchronous
    categoryId, // RESOLVED id; defaults null until a categorized commit supplies one
    hash: row.hash, // already the 3.2 dup-wrapped final hash — do NOT re-hash
    isManual, // categorization SOURCE: defaults 0 (derived) — EP-3 callers stay unchanged
  };
}
