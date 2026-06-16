/**
 * Tests for RulePersistenceService — Story 4.3b Task 4 (FEAT-019).
 *
 * Exercises the raw persistence primitives over a REAL `ComplexRuleDAO` and a
 * REAL `CategoriesService` (itself over a real `CategoriesDAO` + a real
 * `UserSettingsIDBDAO`), all sharing a single fake-indexeddb database opened
 * through the REAL `ENGINE_MIGRATIONS` lineage (so the v7 `complexRules` store,
 * the v6 `categories` store, and the v3 `userSettings` store all exist).
 *
 * Harness mirrors internal/rules/complex-rules-dao.spec.ts +
 * internal/categories/categories-service.spec.ts.
 *
 * RxJS-FREE: `reload()` is a plain async that RETURNS a DecisionTree — there is
 * no Observable/BehaviorSubject in the surface (a dev-review grep also confirms
 * the source is rxjs-free).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RulePersistenceService } from './rule-persistence-service';
import { ComplexRuleDAO } from './complex-rules-dao';
import { ComplexRuleImpl, DecisionTreeImpl } from './decision-tree-impl';
import type { ComplexRule } from './decision-tree';
import { createDescriptionRule, createCounterpartyRule } from './rule-factories';
import { CategoriesService } from '../categories/categories-service';
import { CategoriesDAO } from '../categories/categories-dao';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { setBaseCurrency } from '../settings/base-currency';
import { BASE_CURRENCY_ALIAS } from '../categories/categories-service';
import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

// The persistence service captures a module-level logger at import time, so the
// dangling-categoryId loud-log assertion spies on it via a hoisted module mock.
const { mockErrorSpy } = vi.hoisted(() => ({ mockErrorSpy: vi.fn() }));
vi.mock('../logging', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: mockErrorSpy,
    groupCollapsed: vi.fn(),
    groupEnd: vi.fn(),
  }),
}));

/**
 * Opens a test DB through the REAL engine migration lineage, so the v7
 * `complexRules`, v6 `categories`, and v3 `userSettings` stores are present.
 */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

/** A minimal stage-3 row with the fields the rules below read. */
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

describe('RulePersistenceService', () => {
  let dbName: string;
  let db: IDBDatabase;
  let ruleDao: ComplexRuleDAO;
  let categoriesDao: CategoriesDAO;
  let settingsDao: UserSettingsIDBDAO;
  let categoriesService: CategoriesService;
  let service: RulePersistenceService;

  beforeEach(async () => {
    mockErrorSpy.mockClear();
    dbName = `test-rule-persistence-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    ruleDao = new ComplexRuleDAO(() => db);
    categoriesDao = new CategoriesDAO(() => db);
    settingsDao = new UserSettingsIDBDAO(() => db);
    categoriesService = new CategoriesService(categoriesDao, settingsDao);
    service = new RulePersistenceService(ruleDao, categoriesService);
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

  /** A ComplexRule over the given rules + category (its evaluate is unused here). */
  function rule(cat: Category, rules: ComplexRule['rules'], id?: number): ComplexRule {
    return new ComplexRuleImpl(rules, cat, id);
  }

  // ── create → reload round-trip ─────────────────────────────────────────────

  it('create → reload round-trips a rule whose conditions stay intact', async () => {
    const cat = await makeCategory('Coffee');
    await service.create(
      rule(cat, [
        createDescriptionRule({ type: 'equals', value: 'STARBUCKS' }),
        createCounterpartyRule({ type: 'contains', value: 'CAFE' }),
      ])
    );

    const tree = await service.reload();

    expect(tree.complexRules).toHaveLength(1);
    const reloaded = tree.complexRules[0];
    expect(reloaded.category.id).toBe(cat.id);

    // The rehydrated rules honor the original AND-conditions.
    expect(
      reloaded.evaluate(
        row({ description: 'STARBUCKS', counterparty: 'CORNER CAFE' })
      )
    ).toBe(true);
    expect(
      reloaded.evaluate(row({ description: 'STARBUCKS', counterparty: 'BAR' }))
    ).toBe(false);
    expect(
      reloaded.evaluate(row({ description: 'TESCO', counterparty: 'CAFE' }))
    ).toBe(false);
  });

  it('create appends with order = (max existing)+1', async () => {
    const cat = await makeCategory('A');
    await service.create(rule(cat, []));
    await service.create(rule(cat, []));
    await service.create(rule(cat, []));

    const ordered = await ruleDao.getAllOrdered();
    expect(ordered.map((d) => d.order)).toEqual([0, 1, 2]);
  });

  // ── update preserves order ─────────────────────────────────────────────────

  it('update preserves the existing order and rewrites the conditions', async () => {
    const cat = await makeCategory('A');
    await service.create(rule(cat, []));
    const created = await service.create(
      rule(cat, [createDescriptionRule({ type: 'equals', value: 'OLD' })])
    );
    const id = created.id as number;

    await service.update(
      rule(cat, [createDescriptionRule({ type: 'equals', value: 'NEW' })], id)
    );

    const after = await ruleDao.read(id);
    expect(after?.order).toBe(1); // order preserved
    expect(after?.rules[0].operation).toEqual({ type: 'equals', value: 'NEW' });
  });

  // ── reorder — id preservation + eval honors new order ──────────────────────

  it('reorder reflects the new order, preserves EVERY id, and first-match honors it', async () => {
    const catA = await makeCategory('A');
    const catB = await makeCategory('B');
    const catC = await makeCategory('C');

    // Each rule matches description 'X' so a row can match more than one.
    const r1 = await service.create(
      rule(catA, [createDescriptionRule({ type: 'equals', value: 'X' })])
    );
    const r2 = await service.create(
      rule(catB, [createDescriptionRule({ type: 'equals', value: 'X' })])
    );
    const r3 = await service.create(
      rule(catC, [createDescriptionRule({ type: 'equals', value: 'X' })])
    );

    const id1 = r1.id as number;
    const id2 = r2.id as number;
    const id3 = r3.id as number;

    const idsBefore = (await ruleDao.list()).map((d) => d.id).sort();

    await service.reorder([id3, id1, id2]);

    // Every id is preserved — the id set is unchanged.
    const idsAfter = (await ruleDao.list()).map((d) => d.id).sort();
    expect(idsAfter).toEqual(idsBefore);

    // getAllOrdered reflects the new eval order: id3, id1, id2.
    const ordered = await ruleDao.getAllOrdered();
    expect(ordered.map((d) => d.id)).toEqual([id3, id1, id2]);

    // First-match eval honors the new order: a row matching all three now gets C.
    const tree = await service.reload();
    expect(tree.complexRules.map((c) => c.id)).toEqual([id3, id1, id2]);
    const assigned = tree.categorizeRow(row({ description: 'X' }));
    expect(assigned?.id).toBe(catC.id);
  });

  // ── saveDecisionTree delta — id assertions ─────────────────────────────────

  it('saveDecisionTree keeps matched ids, mints fresh ids, deletes unmatched', async () => {
    const catA = await makeCategory('A');
    const catB = await makeCategory('B');
    const catC = await makeCategory('C');

    // Persist A, B.
    const a = await service.create(
      rule(catA, [createDescriptionRule({ type: 'equals', value: 'A' })])
    );
    const b = await service.create(
      rule(catB, [createDescriptionRule({ type: 'equals', value: 'B' })])
    );
    const idA = a.id as number;
    const idB = b.id as number;

    // New tree: A (kept, same content+id), C (new) — WITHOUT B, reordered to [C, A].
    const reloaded = await service.reload(); // has A, B
    const keptA = reloaded.complexRules.find((c) => c.id === idA)!;
    const newC = rule(catC, [
      createDescriptionRule({ type: 'equals', value: 'C' }),
    ]);
    const newTree = new DecisionTreeImpl([newC, keptA], 'Decision Tree');

    await service.saveDecisionTree(newTree);

    const after = await ruleDao.list();
    const afterIds = after.map((d) => d.id);

    // A keeps its original id.
    expect(afterIds).toContain(idA);
    // B is GONE.
    expect(afterIds).not.toContain(idB);
    // C has a fresh NUMBER id, distinct from A and B.
    const cDto = after.find((d) => d.categoryId === catC.id);
    expect(cDto).toBeDefined();
    expect(typeof cDto?.id).toBe('number');
    expect(cDto?.id).not.toBe(idA);
    expect(cDto?.id).not.toBe(idB);

    // Exactly two rows survive: A and C.
    expect(after).toHaveLength(2);
  });

  // ── dangling categoryId — skip + log + retain ──────────────────────────────

  it('reload SKIPS a dangling-categoryId rule, logs an error, and RETAINS the row', async () => {
    // A DTO whose categoryId points at no category (written via the DAO directly).
    const dangling = await ruleDao.create({
      rules: [{ field: 'description', operation: { type: 'equals', value: 'X' } }],
      categoryId: 'no-such-category',
      order: 0,
    });

    const tree = await service.reload();

    // Skipped from the tree …
    expect(tree.complexRules).toHaveLength(0);
    // … logged loudly …
    expect(mockErrorSpy).toHaveBeenCalledTimes(1);
    expect(mockErrorSpy.mock.calls[0][0]).toContain('no-such-category');
    // … but the row is RETAINED (never auto-deleted).
    expect(await ruleDao.read(dangling.id as number)).not.toBeNull();
  });

  // ── «base» resolves at reload ──────────────────────────────────────────────

  it('reload resolves a «base»-currency category to the configured base', async () => {
    const cat = await makeCategory('Misc', BASE_CURRENCY_ALIAS);
    await service.create(
      rule(cat, [createDescriptionRule({ type: 'equals', value: 'X' })])
    );

    await setBaseCurrency(settingsDao, 'USD');

    const tree = await service.reload();
    expect(tree.complexRules).toHaveLength(1);
    expect(tree.complexRules[0].category.currency).toBe('USD');
  });

  // ── RxJS-free surface ──────────────────────────────────────────────────────

  it('reload returns a plain Promise<DecisionTree> (no Observable)', async () => {
    const cat = await makeCategory('A');
    await service.create(rule(cat, []));

    const result = service.reload();
    expect(result).toBeInstanceOf(Promise);
    const tree = await result;
    // A DecisionTree exposes synchronous categorize methods — not an Observable.
    expect(typeof tree.categorizeRow).toBe('function');
    expect('subscribe' in (tree as object)).toBe(false);
  });
});
