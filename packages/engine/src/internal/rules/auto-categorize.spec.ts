/**
 * Tests for the BATCH auto-categorization entry point — Story 4.7 (EP-4).
 *
 * The acceptance proofs of the deterministic re-import categorization pass:
 *   - DETERMINISTIC      — two identical calls → byte-identical results.
 *   - LOAD-ONCE          — `getManualByPeriods` reads the DAO EXACTLY ONCE for a
 *                          multi-row batch; the per-row resolution touches ZERO
 *                          further DB (no `getAll`, no `findByHash`).
 *   - Q-007 RE-IMPORT    — re-importing the same hashes with an EDITED tree
 *                          re-resolves the RULE rows to the new rule, but KEEPS
 *                          the manually-overridden row (L2) — and is idempotent.
 *   - MANUAL UNAFFECTED  — editing/removing the rule that would touch a manual
 *                          row leaves it on its manual category.
 *   - NOT A FULL SCAN    — the footprint DAO is read ONLY via the period-scoped
 *                          `getManualByPeriods`, never a full `getAll()`.
 *
 * Wires a REAL `FootprintDao` + a REAL `CategoriesService` (over a real
 * `CategoriesDAO` + a real `UserSettingsIDBDAO`) against a single
 * fake-indexeddb database opened through the REAL `ENGINE_MIGRATIONS` lineage
 * (so the v8 `year_month_isManual` index, the v6 `categories` store, and the v3
 * `userSettings` store all exist). Trees are built directly via the builders.
 *
 * Harness mirrors internal/rules/categorize-with-overrides.spec.ts.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoCategorize, type AutoCategorizeDeps } from './auto-categorize';
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
    currency: 'UAH',
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

describe('auto-categorize', () => {
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let categoriesDao: CategoriesDAO;
  let settingsDao: UserSettingsIDBDAO;
  let categoriesService: CategoriesService;

  beforeEach(async () => {
    dbName = `test-auto-cat-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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

  /** The (categoryId, isManual) projection used for deep-equality assertions. */
  function project(
    results: { categoryId: string | null; isManual: 0 | 1 }[]
  ): { categoryId: string | null; isManual: 0 | 1 }[] {
    return results.map((r) => ({ categoryId: r.categoryId, isManual: r.isManual }));
  }

  // ── DETERMINISTIC ──────────────────────────────────────────────────────────

  it('is DETERMINISTIC — two identical calls produce byte-identical results', async () => {
    const catA = await makeCategory('A');
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06
    const deps: AutoCategorizeDeps = {
      tree: treeFor(catA, 'GROCERIES'),
      footprintDao,
      categoriesService,
    };
    const rows = [
      row({ hash: 'h1', date, description: 'GROCERIES' }),
      row({ hash: 'h2', date, description: 'NO-MATCH' }),
      row({ hash: 'h3', date, description: 'GROCERIES' }),
    ];

    const first = await autoCategorize(rows, deps);
    const second = await autoCategorize(rows, deps);

    expect(project(first)).toEqual(project(second));
  });

  // ── LOAD-ONCE / zero per-op DB ─────────────────────────────────────────────

  it('LOADS ONCE — getManualByPeriods called exactly once; zero per-row DB reads', async () => {
    const catA = await makeCategory('A');
    const date = new Date(Date.UTC(2026, 5, 15));

    const manualSpy = vi.spyOn(footprintDao, 'getManualByPeriods');
    const getAllSpy = vi.spyOn(footprintDao, 'getAll');
    const findByHashSpy = vi.spyOn(footprintDao, 'findByHash');

    const deps: AutoCategorizeDeps = {
      tree: treeFor(catA, 'GROCERIES'),
      footprintDao,
      categoriesService,
    };
    // A multi-row batch — all in the SAME period.
    const rows = Array.from({ length: 10 }, (_, i) =>
      row({ hash: `h-${i}`, date, description: i % 2 === 0 ? 'GROCERIES' : 'X' })
    );

    await autoCategorize(rows, deps);

    // Exactly one period-scoped manual load for the whole batch.
    expect(manualSpy).toHaveBeenCalledTimes(1);
    // ZERO full-store scans / per-hash reads during per-row resolution.
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(findByHashSpy).not.toHaveBeenCalled();
  });

  // ── Q-007 RE-IMPORT CONTRACT (headline) ────────────────────────────────────

  it('Q-007 — re-import re-resolves RULE rows (H2→catB) but KEEPS the manual override (H1)', async () => {
    const catManual = await makeCategory('Manual');
    const catA = await makeCategory('A');
    const catB = await makeCategory('B');
    const date = new Date(Date.UTC(2026, 5, 15)); // 2026-06

    // Seed the store: H1 as a MANUAL footprint (isManual=1 → catManual),
    // H2 as a RULE-categorized footprint (isManual=0 → catA under tree-v1).
    await footprintDao.put(
      deriveFootprint(txRow('h1', date), 10, catManual.id!, 1)
    );
    await footprintDao.put(deriveFootprint(txRow('h2', date), 20, catA.id!, 0));

    // tree-v1 maps H2 (description GROCERIES) → catA.
    // tree-v2 maps the SAME description → catB (the rule was EDITED).
    const treeV2 = treeFor(catB, 'GROCERIES');

    const deps: AutoCategorizeDeps = {
      tree: treeV2,
      footprintDao,
      categoriesService,
    };

    // RE-IMPORT the same hashes. H1 is NOT manual in-session (the override is
    // the persisted L2 one); H2 matches the (edited) rule.
    const reimport = [
      row({ hash: 'h1', date, description: 'GROCERIES' }),
      row({ hash: 'h2', date, description: 'GROCERIES' }),
    ];

    const out = await autoCategorize(reimport, deps);
    const byHash = new Map(out.map((r) => [r.row.hash, r]));

    // H2 — isManual 0, not in the override map → re-resolved to the NEW rule.
    expect(byHash.get('h2')!.categoryId).toBe(catB.id);
    expect(byHash.get('h2')!.isManual).toBe(0);

    // H1 — isManual 1, in the override map → KEPT via L2 (rule change ignored).
    expect(byHash.get('h1')!.categoryId).toBe(catManual.id);
    expect(byHash.get('h1')!.isManual).toBe(1);

    // IDEMPOTENT — re-running with the SAME rows + SAME tree-v2 → identical out.
    const again = await autoCategorize(reimport, deps);
    expect(project(again)).toEqual(project(out));
  });

  // ── manual UNAFFECTED by rule edits ────────────────────────────────────────

  it('manual is UNAFFECTED — removing the rule that would touch H1 keeps catManual', async () => {
    const catManual = await makeCategory('Manual');
    const ruleCat = await makeCategory('RuleCat');
    const date = new Date(Date.UTC(2026, 5, 15));

    // H1 manual → catManual; its description WOULD also match a rule.
    await footprintDao.put(
      deriveFootprint(txRow('h1', date), 10, catManual.id!, 1)
    );

    // A tree whose rule WOULD map H1's description → ruleCat.
    const withRule: AutoCategorizeDeps = {
      tree: treeFor(ruleCat, 'COFFEE'),
      footprintDao,
      categoriesService,
    };
    const rows = [row({ hash: 'h1', date, description: 'COFFEE' })];

    const before = await autoCategorize(rows, withRule);
    expect(before[0].categoryId).toBe(catManual.id);
    expect(before[0].isManual).toBe(1);

    // Remove the rule entirely (empty tree) — H1 still on its manual category.
    const noRule: AutoCategorizeDeps = {
      tree: new DecisionTreeBuilder().withName('Empty Tree').build(),
      footprintDao,
      categoriesService,
    };
    const after = await autoCategorize(rows, noRule);
    expect(after[0].categoryId).toBe(catManual.id);
    expect(after[0].isManual).toBe(1);
  });

  // ── NOT a full-store re-run ────────────────────────────────────────────────

  it('is NOT a full-store re-run — reads ONLY getManualByPeriods, never getAll', async () => {
    const catManual = await makeCategory('Manual');
    const catA = await makeCategory('A');
    const date = new Date(Date.UTC(2026, 5, 15));

    // Seed MANY footprints in the store — only TWO hashes are passed for re-categorization.
    for (let i = 0; i < 20; i++) {
      await footprintDao.put(
        deriveFootprint(txRow(`stored-${i}`, date), 1, catA.id!, 0)
      );
    }
    await footprintDao.put(
      deriveFootprint(txRow('passed-1', date), 5, catManual.id!, 1)
    );

    const getAllSpy = vi.spyOn(footprintDao, 'getAll');
    const manualSpy = vi.spyOn(footprintDao, 'getManualByPeriods');

    const deps: AutoCategorizeDeps = {
      tree: treeFor(catA, 'GROCERIES'),
      footprintDao,
      categoriesService,
    };
    // Only the PASSED rows are categorized — not the whole stored set.
    const rows = [
      row({ hash: 'passed-1', date, description: 'X' }),
      row({ hash: 'passed-2', date, description: 'GROCERIES' }),
    ];

    const out = await autoCategorize(rows, deps);

    // Read ONLY via the period-scoped manual load — never a full getAll scan.
    expect(getAllSpy).not.toHaveBeenCalled();
    expect(manualSpy).toHaveBeenCalledTimes(1);
    // Output covers exactly the PASSED rows.
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.row.hash)).toEqual(['passed-1', 'passed-2']);
  });

  // ── DUMP fallback (L4) ─────────────────────────────────────────────────────

  it('falls back to the dump (L4) for an unmatched row, emitting isManual 0', async () => {
    const catA = await makeCategory('A');
    const dump = await makeCategory('Dump');
    const date = new Date(Date.UTC(2026, 5, 15));

    const deps: AutoCategorizeDeps = {
      tree: treeFor(catA, 'GROCERIES'),
      footprintDao,
      categoriesService,
      dumpCategoryId: dump.id,
    };
    const rows = [row({ hash: 'h-dump', date, description: 'UNMATCHED' })];

    const out = await autoCategorize(rows, deps);
    expect(out[0].categoryId).toBe(dump.id); // L4 dump
    expect(out[0].isManual).toBe(0); // dump is NOT a manual source
  });
});
