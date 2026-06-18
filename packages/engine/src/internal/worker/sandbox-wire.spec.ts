/**
 * Sandbox-wire spec — Story 4.9b, Task 2 (EP-4).
 *
 * Drives the 5 v5 wire methods (rulesClassify / rulesSubmitEdit / sandboxState /
 * sandboxApply / sandboxCancel) + the sandbox-aware importCategorizedRows over a
 * REAL composed CategorizationServiceImpl — the same object the direct-client
 * delegates to — across the FULL sandbox lifecycle.
 *
 * Harness mirrors categorization-service-impl.spec.ts: a single fake-indexeddb DB
 * opened through the REAL ENGINE_MIGRATIONS lineage; trees persisted via the REAL
 * RulePersistenceService and reloaded live; the session-rows accessor is a test
 * double returning a seeded array of stage3 rows.
 *
 * The teeth: a MULTI-RULE, MULTI-CURRENCY seed —
 *   R1: description contains 'АТБ'        → groceries
 *   R2: amount < -1000 (UAH)              → big
 * over a mix of UAH + USD rows, at least one of which a reorder/delete re-routes.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CategorizationServiceImpl,
  type SessionRowsAccessor,
} from './categorization-service-impl';
import { FootprintDao } from '../footprint/footprint-dao';
import { deriveFootprint } from '../footprint/derive-footprint';
import { CategoriesService } from '../categories/categories-service';
import { CategoriesDAO } from '../categories/categories-dao';
import { ComplexRuleDAO } from '../rules/complex-rules-dao';
import { RulePersistenceService } from '../rules/rule-persistence-service';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { setBaseCurrency } from '../settings/base-currency';
import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/** Opens a test DB through the REAL engine migration lineage. */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

/** A full stage-3 row carrying every field the impl reads. */
function row(over: Partial<ImportStatementStage3Row>): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    hash: 'h0',
    date: new Date(Date.UTC(2026, 5, 15)), // 2026-06-15
    amount: 0,
    currency: 'UAH',
    description: null,
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: null,
    isBankCommission: false,
    isCashback: false,
    category: null,
    isManuallySetCategory: false,
    ...over,
  };
}

describe('sandbox-wire (the 5 v5 methods + sandbox-aware window)', () => {
  const SESSION = 'session-1';
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let categoriesService: CategoriesService;
  let rulePersistence: RulePersistenceService;
  let svc: CategorizationServiceImpl;
  let sessionRows: ImportStatementStage3Row[];
  let groceries: Category;
  let big: Category;

  beforeEach(async () => {
    dbName = `test-sandbox-wire-db-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    db = await openTestDb(dbName);
    const provider = () => db;
    const settingsDao = new UserSettingsIDBDAO(provider);
    await setBaseCurrency(settingsDao, 'USD');

    footprintDao = new FootprintDao(provider);
    categoriesService = new CategoriesService(new CategoriesDAO(provider), settingsDao);
    rulePersistence = new RulePersistenceService(new ComplexRuleDAO(provider), categoriesService);

    sessionRows = [];
    const accessor: SessionRowsAccessor = async (id) => {
      if (id !== SESSION) throw new Error(`unknown session ${id}`);
      return sessionRows;
    };

    svc = new CategorizationServiceImpl({
      getSessionRows: accessor,
      footprintDao,
      categoriesService,
      rulePersistence,
      userSettings: settingsDao,
      ratesProvider: async () => null,
    });

    // ── the multi-rule, multi-currency seed ────────────────────────────────────
    groceries = await categoriesService.create({ name: 'Groceries', icon: 'glyph-cart', currency: 'UAH' });
    big = await categoriesService.create({ name: 'Big', icon: 'glyph-coin', currency: 'UAH' });

    // R1: description contains 'АТБ' → groceries
    await svc.rulesCreate(
      [{ field: 'description', operator: 'contains', value: 'АТБ' }],
      groceries.id!,
    );
    // R2: amount < -1000 (UAH) → big
    await svc.rulesCreate(
      [{ field: 'amount', operator: 'lessThan', value: -1000, currency: 'UAH' }],
      big.id!,
    );

    // Rows: mix of UAH + USD. Row 1 ('АТБ', -1500 UAH) matches BOTH R1 (wins
    // first) and R2 — so DELETING R1 re-routes it to big (the teeth), and
    // REORDERING [R2,R1] re-routes it to big too. Row 3 ('АТБ', -2000 USD)
    // matches R1 only (R2 is UAH-paired) → delete-R1 sends it to null.
    sessionRows = [
      row({ rowIndex: 0, hash: 'a', description: 'АТБ магазин', amount: -1500, currency: 'UAH' }),
      row({ rowIndex: 1, hash: 'b', description: 'СІЛЬПО', amount: -1500, currency: 'UAH' }),
      row({ rowIndex: 2, hash: 'c', description: 'АТБ store', amount: -2000, currency: 'USD' }),
      row({ rowIndex: 3, hash: 'd', description: 'COFFEE', amount: -50, currency: 'USD' }),
    ];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (db) db.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  it('reorder ENGAGES the sandbox: rulesSubmitEdit → {engaged:true, count>0}, nothing persisted', async () => {
    const before = await svc.importRulesList(SESSION);
    const state = await svc.rulesSubmitEdit(SESSION, {
      kind: 'reorder',
      order: [before[1].ruleId, before[0].ruleId],
    });
    expect(state.engaged).toBe(true);
    expect(state.count).toBeGreaterThan(0);
    // not persisted: a fresh rules list is still the ORIGINAL order.
    expect((await svc.importRulesList(SESSION)).map((r) => r.ruleId)).toEqual(
      before.map((r) => r.ruleId),
    );
  });

  it('categoryOnly is LIVE: persists immediately, session discarded (engaged:false)', async () => {
    const [r1] = await svc.importRulesList(SESSION);
    const cats = await svc.categoriesList();
    const target = cats.find((c) => c.id !== r1.categoryId)!;
    const state = await svc.rulesSubmitEdit(SESSION, {
      kind: 'categoryOnly',
      ruleId: r1.ruleId,
      categoryId: target.id,
    });
    expect(state.engaged).toBe(false);
    expect(
      (await svc.importRulesList(SESSION)).find((r) => r.ruleId === r1.ruleId)!.categoryId,
    ).toBe(target.id);
  });

  it('importCategorizedRows is sandbox-aware while engaged: changed rows carry previousCategoryId (old→new)', async () => {
    const list = await svc.importRulesList(SESSION);
    await svc.rulesSubmitEdit(SESSION, { kind: 'delete', ruleId: list[0].ruleId });
    const win = await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'all' });
    const changed = win.rows.filter(
      (r) => r.previousCategoryId !== undefined && r.previousCategoryId !== r.categoryId,
    );
    expect(changed.length).toBeGreaterThan(0);
    // Row 0 ('АТБ', -1500 UAH): groceries → big (R2 now wins). Row 2 ('АТБ', USD):
    // groceries → null (R2 is UAH-paired, no match).
    const byIndex = new Map(win.rows.map((r) => [r.rowIndex, r]));
    expect(byIndex.get(0)!.previousCategoryId).toBe(groceries.id);
    expect(byIndex.get(0)!.categoryId).toBe(big.id);
    expect(byIndex.get(2)!.previousCategoryId).toBe(groceries.id);
    expect(byIndex.get(2)!.categoryId).toBeNull();
    // An unchanged row carries NO previousCategoryId.
    expect(byIndex.get(1)!.previousCategoryId).toBeUndefined();
  });

  it('changedOnly windows ONLY the diff rows', async () => {
    const list = await svc.importRulesList(SESSION);
    await svc.rulesSubmitEdit(SESSION, { kind: 'delete', ruleId: list[0].ruleId });
    const all = await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'all' });
    const only = await svc.importCategorizedRows(SESSION, {
      offset: 0,
      count: 240,
      segment: 'all',
      changedOnly: true,
    });
    expect(only.rows.length).toBeLessThan(all.rows.length);
    expect(
      only.rows.every((r) => r.previousCategoryId !== undefined && r.previousCategoryId !== r.categoryId),
    ).toBe(true);
  });

  it('apply persists (saveDecisionTree delta) + tears down; cancel discards', async () => {
    const list = await svc.importRulesList(SESSION);
    await svc.rulesSubmitEdit(SESSION, { kind: 'reorder', order: [list[1].ruleId, list[0].ruleId] });
    await svc.sandboxApply(SESSION);
    expect(svc.sandboxState(SESSION).engaged).toBe(false);
    expect((await svc.importRulesList(SESSION)).map((r) => r.ruleId)).toEqual([
      list[1].ruleId,
      list[0].ruleId,
    ]);
    // cancel path:
    await svc.rulesSubmitEdit(SESSION, { kind: 'delete', ruleId: list[1].ruleId });
    svc.sandboxCancel(SESSION);
    expect(svc.sandboxState(SESSION).engaged).toBe(false);
    expect((await svc.importRulesList(SESSION)).length).toBe(list.length);
  });

  it('returning to the SAME conditions (any order) does NOT engage (canonical no-op)', async () => {
    const [r1] = await svc.importRulesList(SESSION);
    const state = await svc.rulesSubmitEdit(SESSION, {
      kind: 'editConditions',
      ruleId: r1.ruleId,
      before: r1.conditions,
      after: [...r1.conditions].reverse(),
    });
    expect(state.engaged).toBe(false);
  });

  it('rulesClassify is a pure preview (live|sandbox) without engaging', async () => {
    const [r1] = await svc.importRulesList(SESSION);
    expect(await svc.rulesClassify(SESSION, { kind: 'reorder', order: [r1.ruleId] })).toBe('sandbox');
    expect(
      await svc.rulesClassify(SESSION, { kind: 'categoryOnly', ruleId: r1.ruleId, categoryId: r1.categoryId }),
    ).toBe('live');
    expect(svc.sandboxState(SESSION).engaged).toBe(false); // classify never engages
  });

  it('importAbort teardown: dropSandbox clears an engaged sandbox (the abort path)', async () => {
    // The direct-client's importAbort calls categorization.dropSandbox(sessionId)
    // (direct-client.ts) — this asserts that teardown call clears an engaged
    // session: sandboxState → engaged:false.
    const list = await svc.importRulesList(SESSION);
    const state = await svc.rulesSubmitEdit(SESSION, { kind: 'delete', ruleId: list[0].ruleId });
    expect(state.engaged).toBe(true);

    svc.dropSandbox(SESSION);
    expect(svc.sandboxState(SESSION).engaged).toBe(false);
    // And the live tree was never touched (drop discards, like cancel).
    expect((await svc.importRulesList(SESSION)).length).toBe(list.length);
  });

  it('override-ops never appear in the diff (structural)', async () => {
    // Seed a manual override (footprint) for row 0 — the row a delete-R1 would
    // otherwise re-route (groceries → big). The L2 override pins it, so it must
    // NOT appear in changedOnly. (Mirrors the 4.4.1 / categorize-with-overrides
    // override-seeding: deriveFootprint(row, amountUSD, categoryId, isManual=1).)
    const pinned = await categoriesService.create({ name: 'Pinned', icon: 'glyph-pin', currency: 'UAH' });
    const r0 = sessionRows[0]; // hash 'a', 2026-06
    await footprintDao.put(deriveFootprint(r0, 0, pinned.id!, 1));

    const list = await svc.importRulesList(SESSION);
    await svc.rulesSubmitEdit(SESSION, { kind: 'delete', ruleId: list[0].ruleId });
    const only = await svc.importCategorizedRows(SESSION, {
      offset: 0,
      count: 240,
      segment: 'all',
      changedOnly: true,
    });
    // Row 0 is override-pinned (resolves to 'pinned' under BOTH trees) → absent.
    expect(only.rows.find((r) => r.rowIndex === 0)).toBeUndefined();
  });
});
