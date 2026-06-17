/**
 * Tests for CategorizationServiceImpl — Story 4.9a S3c, Task 2 (EP-4).
 *
 * The engine-side heart of S3c, composed over the ALREADY-MERGED EP-4 graph.
 * The impl is exercised DIRECTLY (the same object the direct-client delegates
 * to) over a single fake-indexeddb database opened through the REAL
 * `ENGINE_MIGRATIONS` lineage (so the v6 categories, v7 complexRules, v8
 * footprint manual-index, and v3 userSettings stores all exist).
 *
 * The session-rows accessor is a test double: it returns a seeded array of
 * stage3 rows for a sessionId (the impl never re-runs the pipeline — it reads
 * the rows importGetRows would window). Trees are NOT built directly; they are
 * persisted via the REAL RulePersistenceService and reloaded live, so a
 * rulesCreate is reflected on the next importCategorizedRows (RE-IMPORT / Q-007).
 *
 * Harness mirrors internal/rules/rule-persistence-service.spec.ts +
 * internal/rules/auto-categorize.spec.ts.
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
import type { ConditionDTO } from '../../client/dto';
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

describe('CategorizationServiceImpl', () => {
  const SESSION = 'session-1';
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let categoriesService: CategoriesService;
  let rulePersistence: RulePersistenceService;
  let svc: CategorizationServiceImpl;
  let sessionRows: ImportStatementStage3Row[];

  beforeEach(async () => {
    dbName = `test-cat-svc-db-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
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
    });
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

  /** Persists a category via the service and returns it (id minted). */
  async function makeCategory(name: string, currency = 'UAH'): Promise<Category> {
    return categoriesService.create({ name, icon: 'glyph-tag', currency });
  }

  // ── importCategorizedRows — live categories + window/segment/total/match ────

  describe('importCategorizedRows', () => {
    it('assigns live categories matching autoCategorize (rule-driven, isManual=0)', async () => {
      const groceries = await makeCategory('Groceries');
      await svc.rulesCreate(
        [{ field: 'description', operator: 'equals', value: 'ATB' }],
        groceries.id!,
      );

      sessionRows = [
        row({ rowIndex: 0, hash: 'a', description: 'ATB' }),
        row({ rowIndex: 1, hash: 'b', description: 'OTHER' }),
      ];

      const win = await svc.importCategorizedRows(SESSION, {
        offset: 0,
        count: 10,
        segment: 'all',
      });

      expect(win.total).toBe(2);
      expect(win.rows).toHaveLength(2);
      const r0 = win.rows.find((r) => r.rowIndex === 0)!;
      const r1 = win.rows.find((r) => r.rowIndex === 1)!;
      expect(r0.categoryId).toBe(groceries.id);
      expect(r0.isManual).toBe(0);
      expect(r0.ruleId).not.toBeNull();
      expect(r1.categoryId).toBeNull();
      expect(r1.ruleId).toBeNull();
    });

    it('the segment "uncat" filter keeps only uncategorized rows; total reflects the filter', async () => {
      const cat = await makeCategory('Cat');
      await svc.rulesCreate(
        [{ field: 'description', operator: 'equals', value: 'MATCH' }],
        cat.id!,
      );
      sessionRows = [
        row({ rowIndex: 0, hash: 'a', description: 'MATCH' }), // categorized
        row({ rowIndex: 1, hash: 'b', description: 'NOPE' }), // uncat
        row({ rowIndex: 2, hash: 'c', description: 'NADA' }), // uncat
      ];

      const all = await svc.importCategorizedRows(SESSION, { offset: 0, count: 10, segment: 'all' });
      expect(all.total).toBe(3);

      const uncat = await svc.importCategorizedRows(SESSION, { offset: 0, count: 10, segment: 'uncat' });
      expect(uncat.total).toBe(2);
      expect(uncat.rows.map((r) => r.rowIndex).sort()).toEqual([1, 2]);
      expect(uncat.rows.every((r) => r.categoryId === null)).toBe(true);
    });

    it('windows the rows by offset/count after the segment filter', async () => {
      sessionRows = [
        row({ rowIndex: 0, hash: 'a' }),
        row({ rowIndex: 1, hash: 'b' }),
        row({ rowIndex: 2, hash: 'c' }),
        row({ rowIndex: 3, hash: 'd' }),
      ];
      const win = await svc.importCategorizedRows(SESSION, { offset: 1, count: 2, segment: 'all' });
      expect(win.total).toBe(4);
      expect(win.rows.map((r) => r.rowIndex)).toEqual([1, 2]);
    });

    it('matchCount = TOTAL draft matches across ALL rows (before windowing); window shows only matches', async () => {
      sessionRows = [
        row({ rowIndex: 0, hash: 'a', description: 'COFFEE SHOP' }),
        row({ rowIndex: 1, hash: 'b', description: 'COFFEE BAR' }),
        row({ rowIndex: 2, hash: 'c', description: 'TEA HOUSE' }),
        row({ rowIndex: 3, hash: 'd', description: 'COFFEE TO GO' }),
      ];
      const draft: ConditionDTO[] = [{ field: 'description', operator: 'contains', value: 'COFFEE' }];

      const win = await svc.importCategorizedRows(SESSION, {
        offset: 0,
        count: 1,
        segment: 'all',
        draft,
      });

      // 3 rows contain COFFEE → matchCount 3 (all rows), total 3 (draft-filtered),
      // but the window is just 1 (offset 0, count 1).
      expect(win.matchCount).toBe(3);
      expect(win.total).toBe(3);
      expect(win.rows).toHaveLength(1);
      expect(win.rows[0].description).toContain('COFFEE');
    });
  });

  // ── rulesCreate → re-categorize live + the amount-currency pairing invariant ─

  describe('rulesCreate', () => {
    it('a created rule re-categorizes live on the next importCategorizedRows', async () => {
      const cat = await makeCategory('Subscriptions');
      sessionRows = [row({ rowIndex: 0, hash: 'a', description: 'NETFLIX' })];

      // Before any rule: uncategorized.
      const before = await svc.importCategorizedRows(SESSION, { offset: 0, count: 10, segment: 'all' });
      expect(before.rows[0].categoryId).toBeNull();

      const { ruleId } = await svc.rulesCreate(
        [{ field: 'description', operator: 'equals', value: 'NETFLIX' }],
        cat.id!,
      );
      expect(ruleId).toBeGreaterThanOrEqual(0);

      // After: the tree reload picks the new rule up.
      const after = await svc.importCategorizedRows(SESSION, { offset: 0, count: 10, segment: 'all' });
      expect(after.rows[0].categoryId).toBe(cat.id);
      expect(after.rows[0].ruleId).toBe(ruleId);
    });

    it('an amount condition WITHOUT a currency throws (the pairing invariant) and persists nothing', async () => {
      const cat = await makeCategory('Big');
      await expect(
        svc.rulesCreate([{ field: 'amount', operator: 'greaterThan', value: 100 }], cat.id!),
      ).rejects.toThrow(/currency/i);

      // No rule was persisted (the throw is BEFORE create).
      const list = await svc.importRulesList(SESSION);
      expect(list).toHaveLength(0);
    });

    it('an amount condition WITH a currency persists the amount+currency pair and matches', async () => {
      const cat = await makeCategory('Big UAH');
      sessionRows = [
        row({ rowIndex: 0, hash: 'a', amount: 250, currency: 'UAH' }), // matches (>100 AND UAH)
        row({ rowIndex: 1, hash: 'b', amount: 250, currency: 'USD' }), // wrong currency
        row({ rowIndex: 2, hash: 'c', amount: 50, currency: 'UAH' }), // too small
      ];
      const { ruleId } = await svc.rulesCreate(
        [{ field: 'amount', operator: 'greaterThan', value: 100, currency: 'UAH' }],
        cat.id!,
      );

      const win = await svc.importCategorizedRows(SESSION, { offset: 0, count: 10, segment: 'all' });
      const byIndex = new Map(win.rows.map((r) => [r.rowIndex, r]));
      expect(byIndex.get(0)!.categoryId).toBe(cat.id);
      expect(byIndex.get(0)!.ruleId).toBe(ruleId);
      expect(byIndex.get(1)!.categoryId).toBeNull();
      expect(byIndex.get(2)!.categoryId).toBeNull();

      // The persisted rule carries TWO conditions (the amount↔currency pair).
      const list = await svc.importRulesList(SESSION);
      expect(list).toHaveLength(1);
      expect(list[0].conditions.map((c) => c.field).sort()).toEqual(['amount', 'currency']);
    });
  });

  // ── importWhy — winner + short-circuit (neutral) + manual override ──────────

  describe('importWhy', () => {
    it('marks the winner "win", earlier misses "miss", and rules after the winner "neutral" (short-circuit)', async () => {
      const a = await makeCategory('A');
      const b = await makeCategory('B');
      const c = await makeCategory('C');
      // r0: description=ZZZ (won't match) → miss
      await svc.rulesCreate([{ field: 'description', operator: 'equals', value: 'ZZZ' }], a.id!);
      // r1: description=HIT → WIN
      const { ruleId: winId } = await svc.rulesCreate(
        [{ field: 'description', operator: 'equals', value: 'HIT' }],
        b.id!,
      );
      // r2: also matches HIT, but never evaluated (short-circuited) → neutral
      await svc.rulesCreate([{ field: 'description', operator: 'equals', value: 'HIT' }], c.id!);

      sessionRows = [row({ rowIndex: 0, hash: 'a', description: 'HIT' })];

      const why = await svc.importWhy(SESSION, 0);
      expect(why.manual).toBeNull();
      expect(why.winnerRuleId).toBe(winId);
      expect(why.rules.map((r) => r.status)).toEqual(['miss', 'win', 'neutral']);
      // the neutral rule's conditions are all met:null (not evaluated)
      const neutral = why.rules[2];
      expect(neutral.conditions.every((cnd) => cnd.met === null)).toBe(true);
      // the winning rule's condition is met:true
      expect(why.rules[1].conditions.every((cnd) => cnd.met === true)).toBe(true);
    });

    it('surfaces a manual override (L1 in-session pick) — manual wins, no rule winner', async () => {
      const manualCat = await makeCategory('ManualPick');
      const ruleCat = await makeCategory('RulePick');
      await svc.rulesCreate([{ field: 'description', operator: 'equals', value: 'X' }], ruleCat.id!);

      sessionRows = [
        row({
          rowIndex: 0,
          hash: 'a',
          description: 'X',
          isManuallySetCategory: true,
          category: manualCat,
        }),
      ];

      const why = await svc.importWhy(SESSION, 0);
      expect(why.manual).toEqual({ categoryId: manualCat.id });
      expect(why.winnerRuleId).toBeNull();
    });

    it('surfaces a manual override (L2 persisted footprint) for the row triplet', async () => {
      const overrideCat = await makeCategory('Override');
      // Seed a persisted MANUAL footprint for the row's (hash, year, month).
      const r = row({ rowIndex: 0, hash: 'fp-hash', date: new Date(Date.UTC(2026, 2, 10)) });
      await footprintDao.put(deriveFootprint(r, 0, overrideCat.id!, 1));
      sessionRows = [r];

      const why = await svc.importWhy(SESSION, 0);
      expect(why.manual).toEqual({ categoryId: overrideCat.id });
      expect(why.winnerRuleId).toBeNull();
    });
  });

  // ── importRulesList — first-match order + appliedCount ──────────────────────

  describe('importRulesList', () => {
    it('lists persisted rules in first-match order with appliedCount = rows this tree routed to each', async () => {
      const a = await makeCategory('A');
      const b = await makeCategory('B');
      const { ruleId: idA } = await svc.rulesCreate(
        [{ field: 'description', operator: 'equals', value: 'AA' }],
        a.id!,
      );
      const { ruleId: idB } = await svc.rulesCreate(
        [{ field: 'description', operator: 'equals', value: 'BB' }],
        b.id!,
      );

      sessionRows = [
        row({ rowIndex: 0, hash: '0', description: 'AA' }),
        row({ rowIndex: 1, hash: '1', description: 'AA' }),
        row({ rowIndex: 2, hash: '2', description: 'BB' }),
        row({ rowIndex: 3, hash: '3', description: 'ZZ' }),
      ];

      const list = await svc.importRulesList(SESSION);
      expect(list.map((r) => r.ruleId)).toEqual([idA, idB]); // first-match (create) order
      const byId = new Map(list.map((r) => [r.ruleId, r]));
      expect(byId.get(idA)!.appliedCount).toBe(2);
      expect(byId.get(idB)!.appliedCount).toBe(1);
      expect(byId.get(idA)!.categoryId).toBe(a.id);
      expect(byId.get(idA)!.conditions).toEqual([
        { field: 'description', operator: 'equals', value: 'AA' },
      ]);
    });
  });

  // ── categoriesList / categoriesCreate — round-trip + «base» resolution ──────

  describe('categories', () => {
    it('categoriesCreate then categoriesList round-trips the category', async () => {
      const created = await svc.categoriesCreate({
        name: 'Travel',
        icon: 'glyph-plane',
        currency: 'EUR',
      });
      expect(created.name).toBe('Travel');
      expect(created.currency).toBe('EUR');
      expect(created.id).toBeTruthy();

      const list = await svc.categoriesList();
      const found = list.find((c) => c.id === created.id)!;
      expect(found).toMatchObject({ name: 'Travel', icon: 'glyph-plane', currency: 'EUR' });
    });

    it('resolves the «base» alias to the configured base currency at read', async () => {
      // base currency was set to USD in beforeEach.
      const created = await svc.categoriesCreate({ name: 'BaseCat', icon: 'glyph-tag', currency: 'base' });
      expect(created.currency).toBe('USD'); // «base» resolved, not the literal

      const list = await svc.categoriesList();
      expect(list.find((c) => c.id === created.id)!.currency).toBe('USD');
    });
  });

  // ── importConditionFields — driven by the import's mapped columns ───────────

  describe('importConditionFields', () => {
    it('derives the fields from the mapped columns (rows non-null), NOT a hardcoded universal list', async () => {
      // Rows map description + mcc, but NOT counterparty/account/bankCategory.
      // Single currency (no CURRENCY column mapped → forced baseCurrency on every row).
      sessionRows = [
        row({ rowIndex: 0, hash: 'a', description: 'X', mcc: 5411, currency: 'UAH', counterparty: null, account: null, bankCategory: null }),
        row({ rowIndex: 1, hash: 'b', description: 'Y', mcc: 5812, currency: 'UAH', counterparty: null, account: null, bankCategory: null }),
      ];

      const fields = await svc.importConditionFields(SESSION);
      const names = fields.map((f) => f.field);

      // Always-present structural fields (a valid import always maps date + amount).
      expect(names).toContain('date');
      expect(names).toContain('amount');
      // Mapped optional fields present.
      expect(names).toContain('description');
      expect(names).toContain('mcc');
      // Unmapped optional fields ABSENT (the whole point — not hardcoded).
      expect(names).not.toContain('counterparty');
      expect(names).not.toContain('account');
      expect(names).not.toContain('bankCategory');
      // currency NOT mapped (single-currency import) → ABSENT (FINDING-C teeth:
      // currency is forced to baseCurrency on every row, so it must NOT be
      // surfaced just because the row carries a value).
      expect(names).not.toContain('currency');
      // The derived boolean markers are NOT user-mappable condition fields → ABSENT
      // from the field surface entirely (FINDING-C teeth).
      expect(names).not.toContain('isBankCommission');
      expect(names).not.toContain('isCashback');

      // mcc is categorical → carries its distinct present values as options.
      const mcc = fields.find((f) => f.field === 'mcc')!;
      expect(mcc.options?.map((o) => o.value).sort()).toEqual(['5411', '5812']);
      // amount carries the numeric operators.
      const amount = fields.find((f) => f.field === 'amount')!;
      expect(amount.operators).toContain('greaterThan');
    });

    it('amount field is present (amount is always mapped) but bankCategory present iff mapped', async () => {
      sessionRows = [row({ rowIndex: 0, hash: 'a', bankCategory: 'GROCERIES' })];
      const fields = await svc.importConditionFields(SESSION);
      expect(fields.map((f) => f.field)).toContain('amount');
      expect(fields.map((f) => f.field)).toContain('bankCategory');
      const bc = fields.find((f) => f.field === 'bankCategory')!;
      expect(bc.options?.map((o) => o.value)).toEqual(['GROCERIES']);
    });

    it('currency is present (with its distinct options) ONLY when a currency column was mapped (>1 currency)', async () => {
      // A multi-currency import: a CURRENCY column was mapped → rows carry >1
      // distinct currency. THAT is the row-derivable signal of a mapped column.
      sessionRows = [
        row({ rowIndex: 0, hash: 'a', currency: 'UAH' }),
        row({ rowIndex: 1, hash: 'b', currency: 'USD' }),
        row({ rowIndex: 2, hash: 'c', currency: 'UAH' }),
      ];
      const fields = await svc.importConditionFields(SESSION);
      const names = fields.map((f) => f.field);
      expect(names).toContain('currency');
      const cur = fields.find((f) => f.field === 'currency')!;
      expect(cur.valueKind).toBe('optone');
      expect(cur.operators).toContain('oneOf');
      // categorical → distinct present values as options.
      expect(cur.options?.map((o) => o.value).sort()).toEqual(['UAH', 'USD']);
    });

    it('NEVER surfaces the derived boolean markers, even though every row always carries them', async () => {
      // isBankCommission/isCashback are ALWAYS set (false) on every row — the very
      // trap FINDING-C describes. They are derived booleans, not user-mapped
      // condition-grammar columns → must be ABSENT from the field surface.
      sessionRows = [
        row({ rowIndex: 0, hash: 'a', isBankCommission: false, isCashback: false }),
        row({ rowIndex: 1, hash: 'b', isBankCommission: true, isCashback: true }),
      ];
      const names = (await svc.importConditionFields(SESSION)).map((f) => f.field);
      expect(names).not.toContain('isBankCommission');
      expect(names).not.toContain('isCashback');
    });
  });
});
