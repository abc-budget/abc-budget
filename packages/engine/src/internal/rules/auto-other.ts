/**
 * «Auto-Other» completeness gate + the L4 dump fallback — Story 4.6 Task 2 (EP-4).
 * @module internal/rules/auto-other
 * @internal
 *
 * The completeness gate that lets the import «Далі» (Next) button enable only
 * when EVERY row has an effective category, plus the L4 "dump" fallback that
 * sweeps the whole uncategorized remainder into a single category in one move.
 *
 * THE DUMP IS TRANSIENT. `dumpCategoryId` is a SINGLE session-level id — the
 * whole remainder collapses into ONE category. It sits at L4, BELOW the rules,
 * so it is the LAST resort:
 *
 *   L1  in-session manual  — `row.isManuallySetCategory && row.category`
 *   L2  persisted override — `overrideMap.get(row.hash)`
 *   L3  the live rule tree — `tree.categorizeRow(row)` (first-match-wins)
 *   L4  the dump           — `dumpCategoryId` (this module) — rules BEAT the dump
 *   ─   null               — nothing matched and no dump is set
 *
 * L1–L3 are owned by {@link resolveCategory}; this module only adds L4 on top of
 * it. Because {@link resolveCategory} runs FIRST, a row the rules can categorize
 * keeps its rule category even with a dump set (rules beat the dump). When a new
 * rule later matches a previously-dumped row, that row is RECLAIMED by the rule
 * on the next resolve — the dump never freezes the outcome.
 *
 * NON-STICKY by construction. The dump NEVER mutates `row.category`, NEVER
 * writes the override map, and NEVER creates a rule. It is held only in the
 * caller's session state (`dumpCategoryId`), is GONE on re-import, and is NEVER
 * persisted. A committed dumped footprint is written with `isManual=0` (DERIVED,
 * not manual), so on re-import {@link loadOverrideMap} skips it (it only snapshots
 * `isManual=1` rows) — the dumped category does NOT reappear as a sticky
 * override. (Contrast a manual pick, which is `isManual=1` and DOES survive.)
 *
 * A dangling `dumpCategoryId` (an id absent from `categoriesById`) FAILS SOFT to
 * `null` — never throws — so the gate simply stays open rather than crashing.
 *
 * SYNCHRONOUS + RxJS-FREE: all three functions are plain synchronous, pure
 * reads — no DB, no await, no Promise, no Observable. INTERNAL — deliberately
 * NOT wired into the public barrel; no CONTRACT_VERSION change.
 */

import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import {
  resolveCategory,
  type OverrideContext,
} from './categorize-with-overrides';

/**
 * Resolves a row's EFFECTIVE category across the full L1→L4 ladder.
 *
 * Runs {@link resolveCategory} first (L1 manual → L2 override → L3 rules); only
 * when that returns `null` does it fall back to the L4 dump. The dump id is
 * resolved through `ctx.categoriesById`; a dangling id (or `dumpCategoryId ===
 * null`) yields `null` (fail-soft — no throw). PURELY SYNCHRONOUS — no DB.
 *
 * @param row - The stage-3 row to categorize
 * @param ctx - The load-once override context (its tree/index/map back L1–L3)
 * @param dumpCategoryId - The TRANSIENT session dump id, or `null` when no dump
 *   is set
 * @returns The resolved Category, or `null` when nothing matches and no (valid)
 *   dump is set
 */
export function effectiveCategory(
  row: ImportStatementStage3Row,
  ctx: OverrideContext,
  dumpCategoryId: string | null
): Category | null {
  // L1–L3 — rules beat the dump, so resolve them first.
  return (
    resolveCategory(row, ctx) ??
    // L4 — the dump. A dangling id resolves to null (fail-soft).
    (dumpCategoryId !== null
      ? ctx.categoriesById.get(dumpCategoryId) ?? null
      : null)
  );
}

/**
 * The still-uncategorized remainder: the rows whose effective category is
 * `null` across the full L1→L4 ladder (including the dump). PURELY SYNCHRONOUS.
 *
 * @param rows - The rows to filter
 * @param ctx - The load-once override context
 * @param dumpCategoryId - The TRANSIENT session dump id, or `null`
 * @returns The rows that remain uncategorized
 */
export function remainderRows(
  rows: ImportStatementStage3Row[],
  ctx: OverrideContext,
  dumpCategoryId: string | null
): ImportStatementStage3Row[] {
  return rows.filter(
    (row) => effectiveCategory(row, ctx, dumpCategoryId) === null
  );
}

/**
 * The «Далі» completeness gate: `true` only when EVERY row has an effective
 * category (the remainder is empty). PURELY SYNCHRONOUS.
 *
 * @param rows - The rows to check
 * @param ctx - The load-once override context
 * @param dumpCategoryId - The TRANSIENT session dump id, or `null`
 * @returns `true` when nothing remains uncategorized
 */
export function isComplete(
  rows: ImportStatementStage3Row[],
  ctx: OverrideContext,
  dumpCategoryId: string | null
): boolean {
  return remainderRows(rows, ctx, dumpCategoryId).length === 0;
}
