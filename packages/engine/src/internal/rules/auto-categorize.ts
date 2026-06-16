/**
 * Deterministic BATCH auto-categorization entry point — Story 4.7 (EP-4).
 * @module internal/rules/auto-categorize
 * @internal
 *
 * The single batch surface that categorizes an import's normalized rows by
 * running the merged 4.2/4.4/4.6 precedence ladder over EACH row — once, at
 * import start, having loaded the persisted overrides exactly ONCE.
 *
 *   L1  in-session manual  — `row.isManuallySetCategory && row.category`
 *   L2  persisted override — `overrideMap.get(row.hash)` (a prior manual
 *                            footprint, isManual=1, snapshotted at load)
 *   L3  the live rule tree — `tree.categorizeRow(row)` (first-match-wins)
 *   L4  the dump           — `dumpCategoryId` (the transient session remainder)
 *   ─   null               — nothing matched and no dump is set
 *
 * The ladder itself is NOT rebuilt here: {@link effectiveCategory} (auto-other,
 * 4.6) owns L1→L4 on top of {@link resolveCategory} (4.4), and
 * {@link loadOverrideMap} (4.4) owns the one-time override/category snapshot.
 * This module only orchestrates the BATCH: distinct-period derivation → the
 * single load → a pure synchronous per-row map.
 *
 * RE-CATEGORIZATION = RE-IMPORT (Q-007). A committed footprint is MINIMIZED
 * (ENT-001 privacy) and so can NEVER be re-categorized in place; the user
 * re-imports the statement instead. The SAME pipeline runs at first import and
 * at re-import — there is no separate "re-categorize" path. A rule edit between
 * the two imports is therefore reflected on a re-import: an isManual=0 row
 * (rule/dump-derived) re-resolves through the LIVE tree to the new rule, while
 * an isManual=1 row (a manual pick, snapshotted into the override map by
 * {@link loadOverrideMap}) is KEPT via L2 and ignores the rule change.
 *
 * IDEMPOTENCY is the EP-3 hash-upsert at COMMIT (EP-5), not here: re-importing
 * the same statement re-derives the same `[hash,year,month]` footprints and the
 * native upsert overwrites them in place (last write wins). This module is a
 * read-only resolver — it neither writes footprints nor computes day/amountUSD
 * (both EP-5). It EMITS `isManual` per row so the EP-5 commit can persist it via
 * `deriveFootprint(row, amountUSD, categoryId, isManual)`.
 *
 * LOAD-ONCE: {@link loadOverrideMap} is the ONLY async surface — awaited exactly
 * once. The per-row resolution that follows is PURELY SYNCHRONOUS (no DB, no
 * await) and DETERMINISTIC. The footprint DAO is read ONLY via the period-scoped
 * `getManualByPeriods` — never a full `getAll()` scan; this categorizes the
 * PASSED rows only, NOT the stored footprint set.
 *
 * RxJS-FREE. INTERNAL — deliberately NOT wired into the public barrel; no
 * CONTRACT_VERSION change.
 */

import type { CategoriesService } from '../categories/categories-service';
import type { FootprintDao } from '../footprint/footprint-dao';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { effectiveCategory } from './auto-other';
import { loadOverrideMap } from './categorize-with-overrides';
import type { DecisionTree } from './decision-tree';

/**
 * One row's categorization outcome.
 *
 *  - `row`        — the input row (carried verbatim for the EP-5 commit).
 *  - `categoryId` — the resolved category id across L1→L4, or `null` when
 *                   nothing matched and no (valid) dump is set.
 *  - `isManual`   — the categorization SOURCE: `1` when the category came from a
 *                   manual pick (L1 in-session OR L2 persisted override), `0`
 *                   when it came from a rule (L3) or the dump (L4) — or nothing.
 */
export interface CategorizedRow {
  row: ImportStatementStage3Row;
  categoryId: string | null;
  isManual: 0 | 1;
}

/**
 * The deps the batch entry point resolves through.
 *
 *  - `tree`             — the live decision tree (L3); held by reference so a
 *                         rule edit is reflected on the next re-import.
 *  - `footprintDao`     — the footprint DAO (the period-scoped manual read seam).
 *  - `categoriesService`— the categories service (the full category index).
 *  - `dumpCategoryId`   — the TRANSIENT session dump id (L4), or `null`/absent
 *                         when no dump is set.
 */
export interface AutoCategorizeDeps {
  tree: DecisionTree;
  footprintDao: FootprintDao;
  categoriesService: CategoriesService;
  dumpCategoryId?: string | null;
}

/**
 * Categorizes a batch of normalized rows through the full L1→L4 ladder.
 *
 * Loads the persisted overrides ONCE (over the rows' DISTINCT periods), then
 * maps each row PURELY SYNCHRONOUSLY to its resolved category id + manual
 * source. Deterministic: the same rows + deps yield the same output.
 *
 * @param rows - The normalized stage-3 rows to categorize (passed rows only)
 * @param deps - The tree + DAO + categories service + optional dump id
 * @returns One {@link CategorizedRow} per input row, in input order
 */
export async function autoCategorize(
  rows: readonly ImportStatementStage3Row[],
  deps: AutoCategorizeDeps
): Promise<CategorizedRow[]> {
  // 1. The DISTINCT (year, month) periods the batch spans — via UTC accessors,
  //    consistent with deriveFootprint / the footprint key. De-duped so a period
  //    is never loaded twice.
  const periods = distinctPeriods(rows);

  // 2. Load the persisted override map + category index — the ONLY await. The
  //    footprint DAO is read here via the period-scoped getManualByPeriods only.
  const { overrideMap, categoriesById } = await loadOverrideMap(
    deps.footprintDao,
    deps.categoriesService,
    periods
  );

  // 3. Resolve every row synchronously through the merged ladder (no DB).
  const ctx = { tree: deps.tree, overrideMap, categoriesById };
  const dumpCategoryId = deps.dumpCategoryId ?? null;

  const result: CategorizedRow[] = [];
  for (const row of rows) {
    const categoryId = effectiveCategory(row, ctx, dumpCategoryId)?.id ?? null;
    // The manual SOURCE: L1 in-session pick OR L2 persisted override → 1;
    // a rule (L3) or the dump (L4) → 0.
    const isManual: 0 | 1 =
      row.isManuallySetCategory || overrideMap.has(row.hash) ? 1 : 0;
    result.push({ row, categoryId, isManual });
  }
  return result;
}

/**
 * The DISTINCT `(year, month)` periods spanned by the rows' dates.
 *
 * Split via UTC accessors (`getUTCFullYear()`, `getUTCMonth() + 1`) — the SAME
 * calendar split `deriveFootprint` and the footprint key use, so the loaded
 * override periods line up exactly with the stored manual footprints.
 */
function distinctPeriods(
  rows: readonly ImportStatementStage3Row[]
): { year: number; month: number }[] {
  const distinct = new Map<string, { year: number; month: number }>();
  for (const row of rows) {
    const year = row.date.getUTCFullYear();
    const month = row.date.getUTCMonth() + 1; // getUTCMonth() is 0-based
    distinct.set(`${year}-${month}`, { year, month });
  }
  return [...distinct.values()];
}
