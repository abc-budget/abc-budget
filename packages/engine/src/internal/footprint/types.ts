/**
 * The footprint persistence shape (ENT-001, HC-2/3, VIS-002).
 * @module internal/footprint/types
 * @internal
 *
 * Story 3.3 (EP-3): the ONLY shape a footprint row is ever stored as. Data
 * minimization is the contract — this record holds EXACTLY these 6 fields and
 * NOTHING else.
 *
 * Raw identifying text (description / counterparty / amount / currency) lives
 * ONLY inside `hash` and is NOT reconstructable from a stored row. `amountUSD`
 * is the ENT-020 reserve bridge — INTERNAL only, never read by the UI. The
 * minimization is enforced at compile time (see types.spec.ts): adding a 7th
 * field fails the build.
 *
 * PRIVACY-NEUTRALITY of the 6th field (Story 4.4): `isManual` is a 0|1 flag
 * recording the categorization SOURCE (manual vs derived) — NOT identifying
 * text. A bare numeric flag carries NOTHING reconstructable, so VIS-002
 * minimization still holds and the row stays non-reconstructable. Moving the
 * pin 5→6 is a CONSCIOUS, source-recording addition, NOT a relaxation of
 * minimization.
 */

/** A persisted footprint row — exactly 6 fields, nothing more (ENT-001). */
export interface FootprintRecord {
  readonly year: number; // operation-date year (UTC)
  readonly month: number; // operation-date month 1–12
  readonly amountUSD: number; // ENT-020 reserve bridge — INTERNAL only, never read by UI
  readonly categoryId: string | null; // resolved category id; null until a categorized commit
  readonly hash: string; // dup-wrapped final hash from stage 3 (row.hash)
  readonly isManual: 0 | 1; // categorization SOURCE: 1=manual, 0=derived (privacy-neutral flag, NOT boolean)
}
