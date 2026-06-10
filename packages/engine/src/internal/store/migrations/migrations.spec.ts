import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { MigrationStep } from './migration';
import { openDatabase } from './open-with-migrations';

/** Unique DB name per test — fake-indexeddb state is global per test file. */
let dbCounter = 0;
const freshName = () => `mig-test-${++dbCounter}`;
const openDbs: IDBDatabase[] = [];

async function open(name: string, steps: MigrationStep[]): Promise<IDBDatabase> {
  const db = await openDatabase(name, steps);
  openDbs.push(db);
  return db;
}

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
});

/** Promisified helpers over raw IDB for assertions. */
function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

const V1_CREATE_ITEMS: MigrationStep = {
  toVersion: 1,
  migrate: (ctx) => {
    ctx.createStore('items', { keyPath: 'id' });
  },
};

describe('migration framework — validation', () => {
  it('rejects an empty step list', async () => {
    await expect(openDatabase(freshName(), [])).rejects.toThrow(/at least one migration step/);
  });

  it('rejects non-contiguous steps (gap)', async () => {
    await expect(
      openDatabase(freshName(), [V1_CREATE_ITEMS, { toVersion: 3, migrate: () => {} }]),
    ).rejects.toThrow(/contiguous from 1: expected toVersion 2, got 3/);
  });

  it('rejects steps not starting at 1', async () => {
    await expect(
      openDatabase(freshName(), [{ toVersion: 2, migrate: () => {} }]),
    ).rejects.toThrow(/expected toVersion 1, got 2/);
  });
});

describe('migration framework — open & upgrade', () => {
  it('fresh open replays all steps and resolves with the migrated DB', async () => {
    const db = await open(freshName(), [V1_CREATE_ITEMS]);
    expect(db.version).toBe(1);
    expect(Array.from(db.objectStoreNames)).toEqual(['items']);
  });

  it('version bump migrates cleanly on existing data (v1 seed → v2 adds index)', async () => {
    const name = freshName();
    const db1 = await open(name, [V1_CREATE_ITEMS]);
    await put(db1, 'items', { id: 'a', amount: 5 });
    db1.close();

    const V2_ADD_INDEX: MigrationStep = {
      toVersion: 2,
      migrate: (ctx) => ctx.createIndex('items', { name: 'by_amount', keyPath: 'amount' }),
    };
    const db2 = await open(name, [V1_CREATE_ITEMS, V2_ADD_INDEX]);
    expect(db2.version).toBe(2);
    const tx = db2.transaction('items', 'readonly');
    expect(Array.from(tx.objectStore('items').indexNames)).toEqual(['by_amount']);
    expect(await getAll(db2, 'items')).toEqual([{ id: 'a', amount: 5 }]); // data survived
  });

  it('only replays steps above oldVersion (v1 does not re-run)', async () => {
    const name = freshName();
    let v1Runs = 0;
    const countingV1: MigrationStep = {
      toVersion: 1,
      migrate: (ctx) => {
        v1Runs++;
        ctx.createStore('items', { keyPath: 'id' });
      },
    };
    (await open(name, [countingV1])).close();
    await open(name, [countingV1, { toVersion: 2, migrate: () => {} }]);
    expect(v1Runs).toBe(1);
  });

  it('promise resolves only after the upgrade tx committed — data written by a migration is immediately readable', async () => {
    const name = freshName();
    const seedStep: MigrationStep = {
      toVersion: 1,
      migrate: (ctx) => {
        const store = ctx.createStore('items', { keyPath: 'id' });
        store.put({ id: 'seeded', amount: 1 }); // enqueued on the version-change tx
      },
    };
    const db = await open(name, [seedStep]);
    // If the promise could resolve mid-upgrade, this read would race the upgrade tx.
    expect(await getAll(db, 'items')).toEqual([{ id: 'seeded', amount: 1 }]);
  });
});
