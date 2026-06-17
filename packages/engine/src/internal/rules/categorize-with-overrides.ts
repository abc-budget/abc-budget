/**
 * Sticky-override precedence orchestrator — Story 4.4 Task 3 (EP-4).
 * @module internal/rules/categorize-with-overrides
 * @internal
 *
 * The heart of the sticky-override feature: a 4-level precedence ladder that
 * resolves a row's category at import time, honoring both in-session manual
 * picks and the user's PERSISTED manual overrides — without freezing the rule
 * outcome for un-overridden rows.
 *
 *   L1  in-session manual    — `row.isManuallySetCategory && row.category`
 *   L2  persisted override   — `overrideMap.get(overrideKeyForRow(row))` (a prior
 *                              manual footprint, loaded ONCE at import start)
 *   L3  the live rule tree   — `tree.categorizeRow(row)` (first-match-wins)
 *   L4  null                 — categorizeRow's own no-match return
 *
 * OVERRIDE KEY (4.4.1): the override map keys on the COMPOSITE
 * `${hash}|${year}|${month}` — matching the footprint PRIMARY KEY triplet
 * `(hash, year, month)`, NOT the hash alone. The `(year,month)` is derived from
 * `row.date` via the SAME `footprintYearMonth` helper `deriveFootprint` uses, so
 * a row and its persisted footprint compute the SAME key by construction.
 *
 * LOAD-ONCE: {@link loadOverrideMap} is the ONLY async surface. It is called a
 * single time at import start to snapshot the manual footprints for the imported
 * periods into an in-memory map. {@link resolveCategory} and {@link resetToRules}
 * are then PURELY SYNCHRONOUS (no DB, no await) — so the per-op hot path never
 * touches IndexedDB.
 *
 * SANDBOX-INDEPENDENT: an override (L1/L2) short-circuits BEFORE the tree, so an
 * overridden op keeps its category even when the rules are reordered or the
 * matching rule is deleted.
 *
 * RxJS-FREE. INTERNAL — deliberately NOT wired into the public barrel; no
 * CONTRACT_VERSION change.
 */

import type { CategoriesService } from '../categories/categories-service';
import type { Category } from '../categories/types';
import { footprintYearMonth } from '../footprint/derive-footprint';
import type { FootprintDao } from '../footprint/footprint-dao';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { getLogger } from '../logging';
import type { DecisionTree } from './decision-tree';

const logger = getLogger('override');

/**
 * The override-map composite key (4.4.1) — `${hash}|${year}|${month}`.
 *
 * Mirrors the footprint PRIMARY KEY triplet `(hash, year, month)` so a manual
 * footprint and a re-imported row that derive the SAME `(year,month)` land on
 * the SAME map entry. Keying on the hash alone (the pre-4.4.1 shape) would
 * mis-apply a manual override to a same-hash row in a DIFFERENT month.
 */
export function overrideKey(hash: string, year: number, month: number): string {
  return `${hash}|${year}|${month}`;
}

/**
 * The composite override key for a stage-3 row — `${hash}|${year}|${month}`.
 *
 * Derives `(year,month)` from `row.date` via the SAME {@link footprintYearMonth}
 * helper `deriveFootprint` uses, so a row and its persisted footprint compute
 * BYTE-IDENTICAL keys.
 */
export function overrideKeyForRow(row: ImportStatementStage3Row): string {
  const { year, month } = footprintYearMonth(row.date);
  return overrideKey(row.hash, year, month);
}

/**
 * The load-once context the synchronous resolver reads through.
 *
 *  - `overrideMap`     — `${hash}|${year}|${month} → categoryId` (the composite
 *                        override key, 4.4.1) for the imported periods' MANUAL
 *                        footprints (snapshotted once at import start).
 *  - `categoriesById`  — `id → Category` for the full category set («base»
 *                        resolved), so a persisted override id maps to a live
 *                        Category without a per-op read.
 *  - `tree`            — the live decision tree (L3). Held by reference so a
 *                        rule edit / reorder is reflected on the next resolve.
 */
export interface OverrideContext {
  overrideMap: Map<string, string>;
  categoriesById: Map<string, Category>;
  tree: DecisionTree;
}

/**
 * Loads — ONCE, at import start — the persisted manual overrides for the
 * imported periods plus the full category index.
 *
 * The override map is built from the MANUAL footprints of the given
 * `(year,month)` periods (`getManualByPeriods`), keyed
 * `${hash}|${year}|${month} → categoryId` (the composite override key, 4.4.1);
 * a footprint whose `categoryId` is null is skipped (an override must name a
 * category). The category index is built from
 * `categoriesService.list({ includeArchived: true })` («base» resolved at read)
 * — INCLUDING archived rows, since an override may legitimately point at a
 * since-archived category.
 *
 * This is the ONLY async surface. The caller invokes it exactly once and then
 * resolves every row synchronously through {@link resolveCategory}.
 *
 * @param footprintDao - The footprint DAO (the manual-period read seam)
 * @param categoriesService - The categories service (full category index)
 * @param periods - The imported `(year,month)` periods to snapshot overrides for
 * @returns The override map + the category index for the {@link OverrideContext}
 */
export async function loadOverrideMap(
  footprintDao: FootprintDao,
  categoriesService: CategoriesService,
  periods: ReadonlyArray<{ year: number; month: number }>
): Promise<{
  overrideMap: Map<string, string>;
  categoriesById: Map<string, Category>;
}> {
  const manual = await footprintDao.getManualByPeriods(periods);
  const overrideMap = new Map<string, string>();
  for (const footprint of manual) {
    // An override must name a category — skip a manual row with a null id.
    if (footprint.categoryId !== null) {
      overrideMap.set(
        overrideKey(footprint.hash, footprint.year, footprint.month),
        footprint.categoryId
      );
    }
  }

  const categoriesById = new Map<string, Category>();
  for (const category of await categoriesService.list({ includeArchived: true })) {
    if (category.id !== undefined) {
      categoriesById.set(category.id, category);
    }
  }

  return { overrideMap, categoriesById };
}

/**
 * Resolves a row's category through the precedence ladder. SYNCHRONOUS — no DB,
 * no await; reads only the load-once {@link OverrideContext}.
 *
 *   L1  in-session manual  — `row.isManuallySetCategory && row.category`.
 *   L2  persisted override — `overrideMap.get(overrideKeyForRow(row))` resolved
 *       through `categoriesById` (the composite `${hash}|${year}|${month}` key,
 *       4.4.1). A dangling id (in the map, but absent from the index) is LOUDLY
 *       logged and FALLS THROUGH to the rules (never silently dropped).
 *   L3  the live rule tree — `tree.categorizeRow(row)` (first-match-wins).
 *   L4  null               — categorizeRow's own no-match return.
 *
 * @param row - The stage-3 row to categorize
 * @param ctx - The load-once override context
 * @returns The resolved Category, or null when nothing matches
 */
export function resolveCategory(
  row: ImportStatementStage3Row,
  ctx: OverrideContext
): Category | null {
  // L1 — an in-session manual pick beats everything (in-session > persisted).
  if (row.isManuallySetCategory && row.category) {
    return row.category;
  }

  // L2 — a persisted manual override for this row's (hash, year, month) triplet.
  const id = ctx.overrideMap.get(overrideKeyForRow(row));
  if (id !== undefined) {
    const category = ctx.categoriesById.get(id);
    if (category) {
      return category;
    }
    logger.error(
      `[override] dangling categoryId ${id} for hash ${row.hash} — falling through to rules`
    );
  }

  // L3 (and L4 = its own null no-match) — the live rule tree.
  return ctx.tree.categorizeRow(row);
}

/**
 * Clears BOTH override levels for a row so it re-evaluates through the rules on
 * the next {@link resolveCategory}. SYNCHRONOUS — no DB, no await.
 *
 *  L1  clears the in-session manual pick (`isManuallySetCategory = false`,
 *      `category = null`).
 *  L2  deletes the persisted-override entry from the in-memory map.
 *
 * The cleared row is RETURNED (and also mutated in place, since the stage-3 row
 * fields are mutable). The next commit's `deriveFootprint` reads the cleared
 * flag → `isManual 0`; the native [hash,year,month] upsert overwrites the prior
 * manual footprint — so there is no footprint DELETE here.
 *
 * @param row - The row to reset to rule-driven categorization
 * @param ctx - The override context (its map entry is removed)
 * @returns The cleared row (mutated in place and returned)
 */
export function resetToRules(
  row: ImportStatementStage3Row,
  ctx: OverrideContext
): ImportStatementStage3Row {
  // L1 — clear the in-session manual pick.
  row.isManuallySetCategory = false;
  row.category = null;
  // L2 — drop the persisted override (composite key, 4.4.1) from the in-memory map.
  ctx.overrideMap.delete(overrideKeyForRow(row));
  return row;
}
