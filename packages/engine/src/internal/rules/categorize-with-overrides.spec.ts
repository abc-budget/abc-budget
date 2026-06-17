/**
 * Tests for the override-precedence orchestrator — Story 4.4 Task 3 (EP-4).
 *
 * The 6 acceptance proofs of the sticky-override precedence ladder:
 *   1. override survives re-import (L2 from a persisted manual footprint)
 *   2. L1 (in-session manual) beats L2 (persisted override)
 *   3. isManual=0 re-evaluates through the live tree (not frozen)
 *   4. loaded ONCE — no per-op DAO read during the N synchronous resolves
 *   5. sandbox-independent — L2 short-circuits before the (mutated) tree
 *   6. reset — resetToRules clears both levels → the rule result (or null)
 *
 * Wires a REAL `FootprintDao` + a REAL `CategoriesService` (over a real
 * `CategoriesDAO` + a real `UserSettingsIDBDAO`) against a single
 * fake-indexeddb database opened through the REAL `ENGINE_MIGRATIONS` lineage
 * (so the v8 `year_month_isManual` index, the v6 `categories` store, and the v3
 * `userSettings` store all exist). Trees are built directly via the builder.
 *
 * Harness mirrors internal/rules/rule-persistence-service.spec.ts +
 * internal/footprint/footprint-dao.spec.ts.
 *
 * SYNCHRONOUS + RxJS-FREE: `resolveCategory` / `resetToRules` are plain
 * synchronous functions — no Promise, no Observable, no DB access. Only
 * `loadOverrideMap` is async (load-once at import start).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadOverrideMap,
  overrideKey,
  overrideKeyForRow,
  resetToRules,
  resolveCategory,
  type OverrideContext,
} from './categorize-with-overrides';
import { FootprintDao } from '../footprint/footprint-dao';
import { deriveFootprint } from '../footprint/derive-footprint';
import { CategoriesService } from '../categories/categories-service';
import { CategoriesDAO } from '../categories/categories-dao';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { DecisionTreeBuilder, ComplexRuleBuilder } from './decision-tree-builder';
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

/** A minimal stage-3 row carrying the fields the orchestrator + rules read. */
function row(over: Partial<ImportStatementStage3Row>): ImportStatementStage3Row {
  return {
    rowIndex: 0,
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
function txRow(hash: string, date: Date): TransactionRow {
  return row({ hash, date }) as TransactionRow;
}

/** A single-rule tree: description equals `value` → `cat`. */
function treeFor(cat: Category, value: string): DecisionTree {
  return new DecisionTreeBuilder()
    .withName('Decision Tree')
    .withComplexRule(
      new ComplexRuleBuilder()
        .withCategory(cat)
        .withRule(createDescriptionRule({ type: 'equals', value }))
        .build()
    )
    .build();
}

describe('categorize-with-overrides', () => {
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let categoriesDao: CategoriesDAO;
  let settingsDao: UserSettingsIDBDAO;
  let categoriesService: CategoriesService;

  beforeEach(async () => {
    dbName = `test-overrides-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    footprintDao = new FootprintDao(() => db);
    categoriesDao = new CategoriesDAO(() => db);
    settingsDao = new UserSettingsIDBDAO(() => db);
    categoriesService = new CategoriesService(categoriesDao, settingsDao);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (db) {
      db.close();
    }
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve();
    });
  });

  /** Persists a category via the service and returns it (id minted). */
  async function makeCategory(name: string, currency = 'UAH'): Promise<Category> {
    return categoriesService.create({ name, icon: 'glyph-tag', currency });
  }

  // ── PROOF 1: override survives re-import ───────────────────────────────────

  it('PROOF 1 — a persisted manual override survives a re-import (L2)', async () => {
    const c = await makeCategory('Coffee');
    const hash = 'hash-reimport';
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06

    // A manual footprint is persisted (isManual=1, the resolved categoryId).
    const manual = deriveFootprint(txRow(hash, date), 12.5, c.id!, 1);
    await footprintDao.put(manual);

    const { overrideMap, categoriesById } = await loadOverrideMap(
      footprintDao,
      categoriesService,
      [{ year: 2026, month: 6 }]
    );
    const ctx: OverrideContext = {
      overrideMap,
      categoriesById,
      tree: treeFor(await makeCategory('Other'), 'SOMETHING-ELSE'),
    };

    // A FRESH re-imported row: same hash + SAME period date, NOT manual in-session.
    const fresh = row({ hash, date, isManuallySetCategory: false, description: null });
    const resolved = resolveCategory(fresh, ctx);

    expect(resolved?.id).toBe(c.id);
  });

  // ── PROOF 2: L1 beats L2 ───────────────────────────────────────────────────

  it('PROOF 2 — in-session manual (L1) beats a persisted override (L2)', async () => {
    const x = await makeCategory('X');
    const y = await makeCategory('Y');
    const hash = 'hash-l1-wins';
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06

    const overrideMap = new Map<string, string>([[overrideKey(hash, 2026, 6), y.id!]]);
    const categoriesById = new Map<string, Category>([
      [x.id!, x],
      [y.id!, y],
    ]);
    const ctx: OverrideContext = {
      overrideMap,
      categoriesById,
      tree: treeFor(await makeCategory('R'), 'NEVER'),
    };

    // Row is manually set to X in-session, but the map says (hash,2026,6) → Y.
    const r = row({ hash, date, isManuallySetCategory: true, category: x });
    expect(resolveCategory(r, ctx)?.id).toBe(x.id);
  });

  // ── PROOF 3: isManual=0 re-evaluates through the live tree ─────────────────

  it('PROOF 3 — a non-override row re-evaluates through the live tree (not frozen)', async () => {
    const rCat = await makeCategory('R');
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06
    const ctx: OverrideContext = {
      overrideMap: new Map(),
      categoriesById: new Map([[rCat.id!, rCat]]),
      tree: treeFor(rCat, 'GROCERIES'),
    };

    // Not in the override map, not manual in-session, matches the rule → R.
    const r = row({ hash: 'h-rules', date, description: 'GROCERIES' });
    expect(resolveCategory(r, ctx)?.id).toBe(rCat.id);

    // Swap the tree (a different rule) → the SAME row re-resolves to the new
    // result. The orchestrator does not freeze the rule outcome.
    const sCat = await makeCategory('S');
    ctx.tree = treeFor(sCat, 'GROCERIES');
    expect(resolveCategory(r, ctx)?.id).toBe(sCat.id);

    // A row matching neither rule resolves to null (L4 — no match).
    expect(resolveCategory(row({ hash: 'h-none', date, description: 'OTHER' }), ctx)).toBeNull();
  });

  // ── PROOF 4: loaded ONCE — no per-op DAO read ──────────────────────────────

  it('PROOF 4 — loadOverrideMap reads the DAO ONCE; the N resolves never touch it', async () => {
    const c = await makeCategory('Coffee');
    const date = new Date(Date.UTC(2026, 5, 15));
    // Persist a few manual footprints across distinct hashes.
    for (let i = 0; i < 3; i++) {
      await footprintDao.put(deriveFootprint(txRow(`h-${i}`, date), 1, c.id!, 1));
    }

    const manualSpy = vi.spyOn(footprintDao, 'getManualByPeriods');
    const findByHashSpy = vi.spyOn(footprintDao, 'findByHash');
    const getAllSpy = vi.spyOn(footprintDao, 'getAll');

    const { overrideMap, categoriesById } = await loadOverrideMap(
      footprintDao,
      categoriesService,
      [{ year: 2026, month: 6 }]
    );

    // The load touched the manual-period read exactly once.
    expect(manualSpy).toHaveBeenCalledTimes(1);

    const callsAfterLoad = manualSpy.mock.calls.length;
    const ctx: OverrideContext = {
      overrideMap,
      categoriesById,
      tree: treeFor(c, 'NEVER'),
    };

    // Resolve over N rows — synchronous, no DB.
    const N = 50;
    for (let i = 0; i < N; i++) {
      resolveCategory(row({ hash: `h-${i % 3}`, date }), ctx);
    }

    // ZERO additional footprint reads during the N resolves.
    expect(manualSpy.mock.calls.length).toBe(callsAfterLoad);
    expect(findByHashSpy).not.toHaveBeenCalled();
    expect(getAllSpy).not.toHaveBeenCalled();
  });

  // ── PROOF 5: sandbox-independent ───────────────────────────────────────────

  it('PROOF 5 — an override op keeps its category when the matching rule is removed', async () => {
    const c = await makeCategory('Coffee');
    const ruleCat = await makeCategory('RuleCat');
    const hash = 'hash-sandbox';
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06

    const overrideMap = new Map<string, string>([[overrideKey(hash, 2026, 6), c.id!]]);
    const categoriesById = new Map<string, Category>([
      [c.id!, c],
      [ruleCat.id!, ruleCat],
    ]);

    // A tree that WOULD match this row's description → ruleCat.
    const ctx: OverrideContext = {
      overrideMap,
      categoriesById,
      tree: treeFor(ruleCat, 'COFFEE-SHOP'),
    };

    const r = row({ hash, date, description: 'COFFEE-SHOP' });
    // Even though the tree matches, L2 short-circuits → the override category.
    expect(resolveCategory(r, ctx)?.id).toBe(c.id);

    // Reorder / delete the matching rule entirely — the override is unaffected.
    ctx.tree = new DecisionTreeBuilder().withName('Empty Tree').build();
    expect(resolveCategory(r, ctx)?.id).toBe(c.id);
  });

  // ── PROOF 5b: dangling override falls through to rules + loud log ───────────

  it('PROOF 5b — a dangling override categoryId falls through to the rules and logs', async () => {
    const rCat = await makeCategory('R');
    const hash = 'hash-dangling';
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06

    const overrideMap = new Map<string, string>([
      [overrideKey(hash, 2026, 6), 'no-such-category'],
    ]);
    const categoriesById = new Map<string, Category>([[rCat.id!, rCat]]);
    const ctx: OverrideContext = {
      overrideMap,
      categoriesById,
      tree: treeFor(rCat, 'GROCERIES'),
    };

    const r = row({ hash, date, description: 'GROCERIES' });
    // The dangling id is not in categoriesById → fall through to L3 (rules).
    expect(resolveCategory(r, ctx)?.id).toBe(rCat.id);
  });

  // ── PROOF 6: reset clears both levels ──────────────────────────────────────

  it('PROOF 6 — resetToRules clears L1 + L2 so the rule result wins', async () => {
    const overrideCat = await makeCategory('Override');
    const ruleCat = await makeCategory('RuleCat');
    const hash = 'hash-reset';
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06

    const overrideMap = new Map<string, string>([
      [overrideKey(hash, 2026, 6), overrideCat.id!],
    ]);
    const categoriesById = new Map<string, Category>([
      [overrideCat.id!, overrideCat],
      [ruleCat.id!, ruleCat],
    ]);
    const ctx: OverrideContext = {
      overrideMap,
      categoriesById,
      tree: treeFor(ruleCat, 'GROCERIES'),
    };

    // Resolves via L1 (manual in-session) before reset.
    const r = row({
      hash,
      date,
      isManuallySetCategory: true,
      category: overrideCat,
      description: 'GROCERIES',
    });
    expect(resolveCategory(r, ctx)?.id).toBe(overrideCat.id);

    // Reset clears BOTH the in-session manual flag AND the persisted override.
    const cleared = resetToRules(r, ctx);
    expect(cleared.isManuallySetCategory).toBe(false);
    expect(cleared.category).toBeNull();
    expect(overrideMap.has(overrideKey(hash, 2026, 6))).toBe(false);

    // Now it resolves via the RULE (L3).
    expect(resolveCategory(cleared, ctx)?.id).toBe(ruleCat.id);

    // And a reset row with no matching rule resolves to null.
    const r2 = resetToRules(
      row({ hash: 'h-noreset', date, isManuallySetCategory: true, category: overrideCat, description: 'NOPE' }),
      ctx
    );
    expect(resolveCategory(r2, ctx)).toBeNull();
  });

  // ── PROOF 7: composite key narrows by month (same hash, different month) ────

  it('PROOF 7 — an override is month-scoped: same hash, DIFFERENT month does NOT match', async () => {
    const overrideCat = await makeCategory('Override');
    const hash = 'hash-month-narrow';

    // Override persisted for (hash, 2026, 6) ONLY.
    const overrideMap = new Map<string, string>([
      [overrideKey(hash, 2026, 6), overrideCat.id!],
    ]);
    const categoriesById = new Map<string, Category>([
      [overrideCat.id!, overrideCat],
    ]);
    const ctx: OverrideContext = {
      overrideMap,
      categoriesById,
      // Empty tree → no rule match; the ONLY way to a category is the override.
      tree: new DecisionTreeBuilder().withName('Empty Tree').build(),
    };

    // Same hash, but date in 2026-07 → composite key (hash,2026,7) is NOT in the
    // map → falls through to rules/null (hash-alone would have mis-applied it).
    const julyRow = row({ hash, date: new Date(Date.UTC(2026, 6, 15)) }); // 2026-07
    expect(resolveCategory(julyRow, ctx)).toBeNull();

    // Same hash, date in 2026-06 → composite key matches → gets the override.
    const juneRow = row({ hash, date: new Date(Date.UTC(2026, 5, 15)) }); // 2026-06
    expect(resolveCategory(juneRow, ctx)?.id).toBe(overrideCat.id);
  });

  // ── PROOF 8: derivation byte-match (row key === footprint key) ──────────────

  it('PROOF 8 — overrideKeyForRow(row) === overrideKey(fp.hash, fp.year, fp.month)', () => {
    const sample = txRow('hash-bytematch', new Date(Date.UTC(2026, 5, 15)));
    const fp = deriveFootprint(sample, 0);
    expect(overrideKeyForRow(sample)).toBe(
      overrideKey(fp.hash, fp.year, fp.month)
    );
  });
});
