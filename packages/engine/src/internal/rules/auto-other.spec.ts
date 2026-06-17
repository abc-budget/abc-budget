/**
 * Tests for the «Auto-Other» completeness gate + L4 dump fallback —
 * Story 4.6 Task 2 (EP-4).
 *
 * The dump is a TRANSIENT, session-level `dumpCategoryId` (a single id — the
 * whole remainder collapses into ONE category). It sits at L4, BELOW the rules,
 * so a row the rules can categorize keeps its rule category even with a dump
 * set. The dump NEVER mutates `row.category`, the override map, or a rule; it is
 * gone on re-import and is never persisted.
 *
 * Proofs:
 *   - «Далі» gate toggles on the LAST remainder row (rule, then dump close it).
 *   - dump catches the whole remainder → every previously-null row → X.
 *   - rules beat the dump (resolveCategory runs first — L3 > L4).
 *   - L4 reclaim — a dumped row is reclaimed by a newly-matching rule.
 *   - dangling dumpCategoryId → fail-soft null (no throw).
 *   - THE TRANSIENT RE-IMPORT PROOF (headline): a dumped row's footprint is
 *     isManual=0 and is therefore NOT in a freshly-loaded override map; on
 *     re-import (fresh ctx, dumpCategoryId=null, no matching rule) the same row
 *     resolves to null again — proving the dump is NOT sticky.
 *
 * SYNCHRONOUS + RxJS-FREE: `effectiveCategory` / `remainderRows` / `isComplete`
 * are plain synchronous functions — no Promise, no Observable, no DB access. The
 * headline proof wires a REAL `FootprintDao` + `CategoriesService` over a
 * fake-indexeddb database opened through the REAL `ENGINE_MIGRATIONS` lineage,
 * mirroring categorize-with-overrides.spec.ts.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  effectiveCategory,
  isComplete,
  remainderRows,
} from './auto-other';
import {
  loadOverrideMap,
  type OverrideContext,
} from './categorize-with-overrides';
import { FootprintDao } from '../footprint/footprint-dao';
import { deriveFootprint } from '../footprint/derive-footprint';
import { CategoriesService } from '../categories/categories-service';
import { CategoriesDAO } from '../categories/categories-dao';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import {
  DecisionTreeBuilder,
  ComplexRuleBuilder,
} from './decision-tree-builder';
import { createDescriptionRule } from './rule-factories';
import type { Category } from '../categories/types';
import type { DecisionTree } from './decision-tree';
import type {
  ImportStatementStage3Row,
  TransactionRow,
} from '../importStatement/stage3/types';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/** Opens a test DB through the REAL engine migration lineage. */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

/** A minimal stage-3 row carrying the fields the gate + rules read. */
function row(over: Partial<ImportStatementStage3Row>): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    // Default UTC date (2026-06) so resolveCategory's composite override key
    // (${hash}|${year}|${month}, 4.4.1) is always derivable.
    date: new Date(Date.UTC(2026, 5, 15)),
    amount: 0,
    description: null,
    counterparty: null,
    category: null,
    isManuallySetCategory: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** A bare DATE-bearing TransactionRow for deriveFootprint (year/month split). */
function txRow(over: Partial<ImportStatementStage3Row>): TransactionRow {
  return row(over) as TransactionRow;
}

/** A bare in-memory category (no persistence). */
function cat(id: string, name: string): Category {
  return { id, name, isArchived: false, currency: 'UAH' } as Category;
}

/** A single-rule tree: description equals `value` → `category`. */
function treeFor(category: Category, value: string): DecisionTree {
  return new DecisionTreeBuilder()
    .withName('Decision Tree')
    .withComplexRule(
      new ComplexRuleBuilder()
        .withCategory(category)
        .withRule(createDescriptionRule({ type: 'equals', value }))
        .build()
    )
    .build();
}

/** An OverrideContext with an empty override map + the given tree/index. */
function ctxFor(
  categoriesById: Map<string, Category>,
  tree: DecisionTree
): OverrideContext {
  return { overrideMap: new Map<string, string>(), categoriesById, tree };
}

describe('auto-other (completeness gate + L4 dump)', () => {
  // ── «Далі» gate toggles on the LAST remainder row ──────────────────────────

  it('«Далі» gate flips to complete when the LAST remainder is covered', () => {
    const food = cat('food', 'Food');
    const other = cat('other', 'Other');
    const categoriesById = new Map<string, Category>([
      [food.id!, food],
      [other.id!, other],
    ]);

    // 3 rows; a tree matches only 'GROCERIES' → 'BUS' is the lone remainder.
    const rows = [
      row({ rowIndex: 0, hash: 'h0', description: 'GROCERIES' }),
      row({ rowIndex: 1, hash: 'h1', description: 'GROCERIES' }),
      row({ rowIndex: 2, hash: 'h2', description: 'BUS' }),
    ];

    const ctx = ctxFor(categoriesById, treeFor(food, 'GROCERIES'));

    // No dump yet → one remainder, gate NOT complete.
    expect(isComplete(rows, ctx, null)).toBe(false);
    const rem = remainderRows(rows, ctx, null);
    expect(rem).toHaveLength(1);
    expect(rem[0]!.hash).toBe('h2');

    // Cover the last remainder with a DUMP → gate complete.
    expect(isComplete(rows, ctx, other.id!)).toBe(true);
    expect(remainderRows(rows, ctx, other.id!)).toEqual([]);

    // Alternatively, cover the last remainder with a RULE → gate complete.
    const ctx2 = ctxFor(categoriesById, treeFor(food, 'BUS'));
    // (food-tree matches BUS now; GROCERIES rows fall through → still a remainder)
    // Use a tree that matches BOTH to fully close it.
    const ctxAll: OverrideContext = {
      overrideMap: new Map(),
      categoriesById,
      tree: new DecisionTreeBuilder()
        .withName('All')
        .withComplexRule(
          new ComplexRuleBuilder()
            .withCategory(food)
            .withRule(createDescriptionRule({ type: 'equals', value: 'GROCERIES' }))
            .build()
        )
        .withComplexRule(
          new ComplexRuleBuilder()
            .withCategory(food)
            .withRule(createDescriptionRule({ type: 'equals', value: 'BUS' }))
            .build()
        )
        .build(),
    };
    expect(isComplete(rows, ctxAll, null)).toBe(true);
    // sanity: ctx2 alone (only BUS rule) still leaves the GROCERIES rows open
    expect(isComplete(rows, ctx2, null)).toBe(false);
  });

  // ── dump catches the remainder ─────────────────────────────────────────────

  it('the dump catches the entire remainder (all null rows → X)', () => {
    const x = cat('x', 'Other');
    const categoriesById = new Map<string, Category>([[x.id!, x]]);

    // Empty tree → every row is a remainder.
    const ctx = ctxFor(
      categoriesById,
      new DecisionTreeBuilder().withName('Empty').build()
    );

    const rows = [
      row({ rowIndex: 0, hash: 'a' }),
      row({ rowIndex: 1, hash: 'b' }),
      row({ rowIndex: 2, hash: 'c' }),
    ];

    // Before the dump: all null.
    for (const r of rows) {
      expect(effectiveCategory(r, ctx, null)).toBeNull();
    }

    // With the dump set: every row resolves to X.
    for (const r of rows) {
      expect(effectiveCategory(r, ctx, x.id!)?.id).toBe(x.id);
    }
    expect(isComplete(rows, ctx, x.id!)).toBe(true);
    expect(remainderRows(rows, ctx, x.id!)).toEqual([]);

    // The dump NEVER mutates row.category.
    for (const r of rows) {
      expect(r.category).toBeNull();
    }
  });

  // ── rules beat the dump ────────────────────────────────────────────────────

  it('rules beat the dump (L3 > L4): a rule-matched row keeps R even with a dump set', () => {
    const r = cat('R', 'Rule');
    const x = cat('x', 'Other');
    const categoriesById = new Map<string, Category>([
      [r.id!, r],
      [x.id!, x],
    ]);
    const ctx = ctxFor(categoriesById, treeFor(r, 'GROCERIES'));

    const matched = row({ hash: 'h', description: 'GROCERIES' });
    // resolveCategory runs FIRST → the rule category wins over the dump.
    expect(effectiveCategory(matched, ctx, x.id!)?.id).toBe(r.id);
  });

  // ── L4 reclaim ─────────────────────────────────────────────────────────────

  it('L4 reclaim: a dumped row is reclaimed by a newly-matching rule (dump unchanged)', () => {
    const r = cat('R', 'Rule');
    const x = cat('x', 'Other');
    const categoriesById = new Map<string, Category>([
      [r.id!, r],
      [x.id!, x],
    ]);
    const dumpId = x.id!;

    // Phase 1: empty tree → the row is dumped to X.
    const ctxDump = ctxFor(
      categoriesById,
      new DecisionTreeBuilder().withName('Empty').build()
    );
    const op = row({ hash: 'h', description: 'GROCERIES' });
    expect(effectiveCategory(op, ctxDump, dumpId)?.id).toBe(x.id);

    // Phase 2: swap in a tree whose rule NOW matches the row → reclaimed by R.
    // The dumpCategoryId is unchanged (still X) — the rule simply wins above it.
    const ctxRule = ctxFor(categoriesById, treeFor(r, 'GROCERIES'));
    expect(effectiveCategory(op, ctxRule, dumpId)?.id).toBe(r.id);
  });

  // ── dangling dumpCategoryId ────────────────────────────────────────────────

  it('a dangling dumpCategoryId fails soft → null (no throw)', () => {
    const categoriesById = new Map<string, Category>();
    const ctx = ctxFor(
      categoriesById,
      new DecisionTreeBuilder().withName('Empty').build()
    );

    const r = row({ hash: 'h' });
    // 'nope' is not in categoriesById → fail-soft null, no throw.
    expect(() => effectiveCategory(r, ctx, 'nope')).not.toThrow();
    expect(effectiveCategory(r, ctx, 'nope')).toBeNull();
    // The remainder is therefore NOT closed by a dangling dump.
    expect(isComplete([r], ctx, 'nope')).toBe(false);
    expect(remainderRows([r], ctx, 'nope')).toHaveLength(1);
  });
});

// ── THE TRANSIENT RE-IMPORT PROOF (headline) ─────────────────────────────────

describe('auto-other — TRANSIENT re-import proof', () => {
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let categoriesService: CategoriesService;

  beforeEach(async () => {
    dbName = `test-auto-other-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    footprintDao = new FootprintDao(() => db);
    const categoriesDao = new CategoriesDAO(() => db);
    const settingsDao = new UserSettingsIDBDAO(() => db);
    categoriesService = new CategoriesService(categoriesDao, settingsDao);
  });

  afterEach(async () => {
    if (db) {
      db.close();
    }
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve();
    });
  });

  it('a dumped footprint is isManual=0, absent from a fresh override map, and re-resolves to null on re-import', async () => {
    // X is a real persisted category (so it lives in categoriesById).
    const x = await categoriesService.create({
      name: 'Other',
      icon: 'glyph-tag',
      currency: 'UAH',
    });

    const hash = 'hash-transient';
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06
    const period = { year: 2026, month: 6 };

    // ── Session 1: the row is uncategorized by the rules; the user dumps it. ──
    const { categoriesById } = await loadOverrideMap(footprintDao, categoriesService, [period]);
    const ctx1: OverrideContext = {
      overrideMap: new Map(), // nothing manual yet
      categoriesById,
      tree: new DecisionTreeBuilder().withName('Empty').build(), // no matching rule
    };

    const op = txRow({ hash, date, description: 'MYSTERY' });

    // Resolved through the dump → X.
    const resolved = effectiveCategory(op, ctx1, x.id!);
    expect(resolved?.id).toBe(x.id);

    // Commit the dumped row's footprint — isManual=0 (it is DERIVED, not manual).
    const fp = deriveFootprint(op, 9.99, resolved?.id ?? null, 0);
    await footprintDao.put(fp);

    // The stored footprint carries the dump category id but is NOT manual.
    const stored = await footprintDao.findByHash(hash);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.categoryId).toBe(x.id);
    expect(stored[0]!.isManual).toBe(0);

    // ── Session 2: simulate re-import. A FRESH override map for the period. ──
    // Because the dumped footprint is isManual=0, getManualByPeriods skips it →
    // it is NOT in the override map.
    const { overrideMap: freshMap, categoriesById: freshIndex } =
      await loadOverrideMap(footprintDao, categoriesService, [period]);
    expect(freshMap.has(hash)).toBe(false);

    const ctx2: OverrideContext = {
      overrideMap: freshMap,
      categoriesById: freshIndex,
      tree: new DecisionTreeBuilder().withName('Empty').build(), // still no rule
    };

    // The dump is TRANSIENT — gone on re-import (dumpCategoryId = null). The SAME
    // row, with no matching rule and no manual override, is uncategorized again.
    const freshOp = txRow({ hash, date, description: 'MYSTERY' });
    expect(effectiveCategory(freshOp, ctx2, null)).toBeNull();

    // Contrast with a manual override (isManual=1) which WOULD persist + reappear:
    // the dump proves NON-sticky precisely because its footprint stayed isManual=0
    // and never entered the override map.
  });
});
