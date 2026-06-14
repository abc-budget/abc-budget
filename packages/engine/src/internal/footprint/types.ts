/**
 * The footprint persistence shape (ENT-001, HC-2/3, VIS-002).
 * @module internal/footprint/types
 * @internal
 *
 * Story 3.3 (EP-3): the ONLY shape a footprint row is ever stored as. Data
 * minimization is the contract — this record holds EXACTLY these 5 fields and
 * NOTHING else.
 *
 * Raw identifying text (description / counterparty / amount / currency) lives
 * ONLY inside `hash` and is NOT reconstructable from a stored row. `amountUSD`
 * is the ENT-020 reserve bridge — INTERNAL only, never read by the UI. The
 * minimization is enforced at compile time (see types.spec.ts): adding a 6th
 * field fails the build.
 */

/** A persisted footprint row — exactly 5 fields, nothing more (ENT-001). */
export interface FootprintRecord {
  readonly year: number; // operation-date year (UTC)
  readonly month: number; // operation-date month 1–12
  readonly amountUSD: number; // ENT-020 reserve bridge — INTERNAL only, never read by UI
  readonly categoryId: string | null; // null until EP-4 populates it
  readonly hash: string; // dup-wrapped final hash from stage 3 (row.hash)
}
