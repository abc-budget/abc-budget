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
 * Derives the persisted footprint record for a transaction row.
 *
 * UTC accessors are MANDATORY here — this is the seam with the rate-date key.
 * The rate cache formats its lookup date via `date.toISOString()` (i.e. UTC), so
 * the year/month split MUST use the same UTC calendar day. Using local-time
 * accessors (`getFullYear()` / `getMonth()`) would let the footprint's
 * year/month and the rate lookup land on different calendar days under a
 * non-UTC host TZ (e.g. a 02:00Z operation reads as the previous day locally in
 * the Americas), silently desyncing the two.
 */
export function deriveFootprint(
  row: TransactionRow,
  amountUSD: number,
  categoryId: string | null = null,
  isManual: 0 | 1 = 0
): FootprintRecord {
  return {
    year: row.date.getUTCFullYear(),
    month: row.date.getUTCMonth() + 1, // getUTCMonth() is 0-based; footprint month is 1–12
    amountUSD, // kept separate so derive stays rate-free and synchronous
    categoryId, // RESOLVED id; defaults null until a categorized commit supplies one
    hash: row.hash, // already the 3.2 dup-wrapped final hash — do NOT re-hash
    isManual, // categorization SOURCE: defaults 0 (derived) — EP-3 callers stay unchanged
  };
}
