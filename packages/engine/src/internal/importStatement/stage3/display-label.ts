/**
 * Display-label fallback for a transaction row (ENT-006).
 * @module internal/importStatement/stage3/display-label
 * @internal
 *
 * Story 3.1 (EP-3): how a row identifies itself in lists (S3c/S3d). Adaptive
 * fallback by priority: description → counterparty → bankCategory → mcc → «—».
 * First NON-EMPTY (after trim) wins; an absent/empty level falls through.
 *
 * DERIVED-ON-READ ONLY — this is NOT a stored field. It must never enter the
 * footprint (HC-2/3, ENT-001): the footprint keeps only {year, month, amountUSD,
 * categoryId, hash}. Identifying text lives in the hash, not readable in storage.
 *
 * No locale (VIS-003): user content is not translated — the helper returns the
 * raw field text verbatim, or the em-dash (U+2014) when nothing is available.
 */

/** The subset of transaction fields the display-label fallback reads. */
export interface DisplayLabelFields {
  readonly description: string | null;
  readonly counterparty: string | null;
  readonly bankCategory: string | null;
  readonly mcc: number | null;
}

/** The em-dash shown when no identifying field is available (ENT-006 «—»). */
const EM_DASH = '—';

/** A string field counts as present only if it is non-empty after trimming. */
function firstNonEmpty(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Returns the row's display label per the ENT-006 fallback:
 * description → counterparty → bankCategory → String(mcc) → «—».
 */
export function displayLabel(row: DisplayLabelFields): string {
  return (
    firstNonEmpty(row.description) ??
    firstNonEmpty(row.counterparty) ??
    firstNonEmpty(row.bankCategory) ??
    (row.mcc !== null ? String(row.mcc) : null) ??
    EM_DASH
  );
}
