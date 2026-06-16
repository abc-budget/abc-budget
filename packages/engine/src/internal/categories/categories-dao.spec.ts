/**
 * Tests for CategoriesDAO — Story 4.3a Task 3.
 *
 * The `categories` store (keyPath:'id', STRING ids, NO autoIncrement; indexes
 * `name`/`isArchived`/`currency`) is created by migration v6 (a sibling 4.3a
 * task). The harness therefore opens the engine DB through the REAL
 * `ENGINE_MIGRATIONS` lineage (not a hand-rolled store), so the v6 store +
 * indexes exist.
 *
 * Harness mirrors internal/footprint/footprint-dao.spec.ts (direct construction
 * via an openTestDb opened through the migration framework).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CategoriesDAO } from './categories-dao';
import type { Category } from './types';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/**
 * Opens a test DB with the categories store via the REAL engine migration
 * lineage, so the v6 `categories` store + indexes are present.
 */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

describe('CategoriesDAO', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: CategoriesDAO;

  beforeEach(async () => {
    dbName = `test-categories-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    dao = new CategoriesDAO(() => db);
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

  it('create then read round-trips all fields (id, name, icon, isArchived, currency)', async () => {
    const category: Category = {
      id: 'cat-groceries',
      name: 'Groceries',
      icon: 'glyph-cart',
      isArchived: false,
      currency: 'UAH',
    };

    await dao.create(category);
    const found = await dao.read('cat-groceries');

    expect(found).toEqual(category);
  });

  it('list() returns all created categories', async () => {
    await dao.create({ id: 'c1', name: 'A', icon: 'g1', isArchived: false, currency: 'UAH' });
    await dao.create({ id: 'c2', name: 'B', icon: 'g2', isArchived: true, currency: 'USD' });

    const all = await dao.list();

    expect(all).toHaveLength(2);
    expect(all.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
  });

  it('getActive() / getArchived() partition by isArchived', async () => {
    await dao.create({ id: 'a1', name: 'Active 1', icon: 'g', isArchived: false, currency: 'UAH' });
    await dao.create({ id: 'a2', name: 'Active 2', icon: 'g', isArchived: false, currency: 'USD' });
    await dao.create({ id: 'r1', name: 'Archived 1', icon: 'g', isArchived: true, currency: 'UAH' });

    const active = await dao.getActive();
    const archived = await dao.getArchived();

    expect(active.map((c) => c.id).sort()).toEqual(['a1', 'a2']);
    expect(active.every((c) => c.isArchived === false)).toBe(true);
    expect(archived.map((c) => c.id)).toEqual(['r1']);
    expect(archived.every((c) => c.isArchived === true)).toBe(true);
  });

  it('getByCurrency() filters by currency code', async () => {
    await dao.create({ id: 'u1', name: 'UAH 1', icon: 'g', isArchived: false, currency: 'UAH' });
    await dao.create({ id: 'u2', name: 'UAH 2', icon: 'g', isArchived: true, currency: 'UAH' });
    await dao.create({ id: 'd1', name: 'USD 1', icon: 'g', isArchived: false, currency: 'USD' });

    const uah = await dao.getByCurrency('UAH');

    expect(uah.map((c) => c.id).sort()).toEqual(['u1', 'u2']);
    expect(uah.every((c) => c.currency === 'UAH')).toBe(true);
  });

  it('update() mutates an existing category and read reflects it', async () => {
    const category: Category = {
      id: 'cat-flip',
      name: 'Flip',
      icon: 'g',
      isArchived: false,
      currency: 'UAH',
    };
    await dao.create(category);

    await dao.update('cat-flip', { ...category, isArchived: true });

    const found = await dao.read('cat-flip');
    expect(found?.isArchived).toBe(true);
    // partition reflects the flip
    expect((await dao.getActive()).map((c) => c.id)).toEqual([]);
    expect((await dao.getArchived()).map((c) => c.id)).toEqual(['cat-flip']);
  });
});
