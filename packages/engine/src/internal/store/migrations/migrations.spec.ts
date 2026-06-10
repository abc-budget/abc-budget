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

/** Schema dump for the fresh≡upgrade invariant. */
function dumpSchema(db: IDBDatabase): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const names = Array.from(db.objectStoreNames);
  if (names.length === 0) return out;
  const tx = db.transaction(names, 'readonly');
  for (const storeName of names) {
    const s = tx.objectStore(storeName);
    out[storeName] = {
      keyPath: s.keyPath,
      autoIncrement: s.autoIncrement,
      indexes: Array.from(s.indexNames)
        .map((n) => {
          const idx = s.index(n);
          return { name: n, keyPath: idx.keyPath, unique: idx.unique, multiEntry: idx.multiEntry };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
  return out;
}

/** The shared 4-step lineage used by the transform/rebuild/invariant tests. */
const V2_ADD_INDEX: MigrationStep = {
  toVersion: 2,
  migrate: (ctx) => ctx.createIndex('items', { name: 'by_amount', keyPath: 'amount' }),
};
const V3_DATA_TRANSFORM: MigrationStep = {
  toVersion: 3,
  migrate: (ctx) => {
    // Double every amount via raw store access on the upgrade tx (cursor walk).
    const store = ctx.store('items');
    const cursorReq = store.openCursor();
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (!cursor) return;
      const row = cursor.value as { id: string; amount: number };
      cursor.update({ ...row, amount: row.amount * 2 });
      cursor.continue();
    };
  },
};
const V4_REBUILD_KEYPATH: MigrationStep = {
  toVersion: 4,
  migrate: (ctx) =>
    ctx.rebuildStore(
      'items',
      { keyPath: 'key', indexes: [{ name: 'by_amount', keyPath: 'amount' }] },
      (row) => {
        const r = row as { id: string; amount: number };
        return { key: `k-${r.id}`, amount: r.amount }; // keyPath id → key
      },
    ),
};
const FULL_LINEAGE = [V1_CREATE_ITEMS, V2_ADD_INDEX, V3_DATA_TRANSFORM, V4_REBUILD_KEYPATH];

describe('migration framework — data transforms & rebuildStore', () => {
  it('v3 data transform via raw store access modifies existing rows', async () => {
    const name = freshName();
    const db1 = await open(name, [V1_CREATE_ITEMS]);
    await put(db1, 'items', { id: 'a', amount: 5 });
    await put(db1, 'items', { id: 'b', amount: 7 });
    db1.close();

    const db3 = await open(name, FULL_LINEAGE.slice(0, 3));
    const rows = (await getAll<{ id: string; amount: number }>(db3, 'items')).sort((x, y) =>
      x.id.localeCompare(y.id),
    );
    expect(rows).toEqual([
      { id: 'a', amount: 10 },
      { id: 'b', amount: 14 },
    ]);
  });

  it('v4 rebuildStore changes the keyPath and transforms rows, atomically with the upgrade', async () => {
    const name = freshName();
    const db1 = await open(name, [V1_CREATE_ITEMS]);
    await put(db1, 'items', { id: 'a', amount: 5 });
    db1.close();

    const db4 = await open(name, FULL_LINEAGE);
    expect(db4.version).toBe(4);
    const tx = db4.transaction('items', 'readonly');
    expect(tx.objectStore('items').keyPath).toBe('key');
    expect(Array.from(tx.objectStore('items').indexNames)).toEqual(['by_amount']);
    expect(await getAll(db4, 'items')).toEqual([{ key: 'k-a', amount: 10 }]); // v3 doubled, v4 re-keyed
  });

  it('a step after rebuildStore sees the rebuilt store (sequencing)', async () => {
    const name = freshName();
    const v5AfterRebuild: MigrationStep = {
      toVersion: 5,
      migrate: (ctx) => {
        // Would throw DataError against the OLD keyPath ('id'); proves v4 completed first.
        ctx.store('items').put({ key: 'added-in-v5', amount: 1 });
      },
    };
    const db = await open(name, [...FULL_LINEAGE, v5AfterRebuild]);
    const rows = await getAll<{ key: string }>(db, 'items');
    expect(rows.some((r) => r.key === 'added-in-v5')).toBe(true);
  });
});

describe('migration framework — fresh≡upgrade invariant', () => {
  it('a fresh DB at v4 has the identical schema to a v1→v4 stepwise upgrade', async () => {
    const freshDb = await open(freshName(), FULL_LINEAGE);

    const upgradedName = freshName();
    for (let v = 1; v <= FULL_LINEAGE.length; v++) {
      const db = await open(upgradedName, FULL_LINEAGE.slice(0, v));
      if (v < FULL_LINEAGE.length) db.close();
      else expect(dumpSchema(db)).toEqual(dumpSchema(freshDb));
    }
  });
});

describe('migration framework — abort atomicity', () => {
  it('a throwing step rejects the open with the original error and rolls back ALL steps', async () => {
    const name = freshName();
    const db1 = await open(name, [V1_CREATE_ITEMS]);
    await put(db1, 'items', { id: 'a', amount: 5 });
    db1.close();

    const v2CreatesThenThrows: MigrationStep = {
      toVersion: 2,
      migrate: (ctx) => {
        ctx.createStore('half-done', { keyPath: 'id' });
        throw new Error('boom in v2');
      },
    };
    await expect(open(name, [V1_CREATE_ITEMS, v2CreatesThenThrows])).rejects.toThrow('boom in v2');

    // DB must still be at v1 with v2's partial work rolled back and data intact.
    const reopened = await open(name, [V1_CREATE_ITEMS]);
    expect(reopened.version).toBe(1);
    expect(Array.from(reopened.objectStoreNames)).toEqual(['items']);
    expect(await getAll(reopened, 'items')).toEqual([{ id: 'a', amount: 5 }]);
  });
});

describe('migration framework — tracking hardening', () => {
  it('index-based cursor walk is sequenced before the next step (H3)', async () => {
    // NOTE: The original test used cursor.update({ amount: row.amount + 100 }) on an index
    // cursor ordered by `amount`. Modifying the indexed field during iteration causes the
    // record to re-appear later in the index order, creating an infinite loop — this is real
    // IDB semantics (the spec does not protect you from re-visiting mutated index keys).
    // Adjusted to update a non-indexed field (`tagged`) so the cursor exhausts normally.
    const name = freshName();
    const db1 = await open(name, [V1_CREATE_ITEMS]);
    await put(db1, 'items', { id: 'a', amount: 5 });
    await put(db1, 'items', { id: 'b', amount: 7 });
    db1.close();

    const v3IndexWalk: MigrationStep = {
      toVersion: 3,
      migrate: (ctx) => {
        const cursorReq = ctx.store('items').index('by_amount').openCursor();
        cursorReq.onsuccess = (ev) => {
          // H2: the REAL event must arrive (target is the request)
          expect((ev.target as IDBRequest).result).toBe(cursorReq.result);
          const cursor = cursorReq.result as IDBCursorWithValue | null;
          if (!cursor) return;
          const row = cursor.value as { id: string; amount: number };
          // Update a non-indexed field so we don't re-visit this record.
          cursor.update({ ...row, tagged: true });
          cursor.continue();
        };
      },
    };
    const v4ReadsTransformed: MigrationStep = {
      toVersion: 4,
      migrate: (ctx) => {
        const req = ctx.store('items').getAll();
        req.addEventListener('success', () => {
          const rows = req.result as Array<{ tagged?: boolean }>;
          // If the index walk wasn't awaited, `tagged` would be absent.
          if (rows.some((r) => !r.tagged)) {
            throw new Error('v4 ran before the v3 index-cursor walk finished');
          }
        });
      },
    };
    const db = await open(name, [V1_CREATE_ITEMS, V2_ADD_INDEX, v3IndexWalk, v4ReadsTransformed]);
    const rows = (await getAll<{ id: string; amount: number; tagged: boolean }>(db, 'items')).sort(
      (x, y) => x.id.localeCompare(y.id),
    );
    expect(rows).toEqual([
      { id: 'a', amount: 5, tagged: true },
      { id: 'b', amount: 7, tagged: true },
    ]);
  });

  it('user onsuccess assignment on a tracked write request does not break sequencing (H1)', async () => {
    const name = freshName();
    let userHandlerRan = false;
    const v1Seeds: MigrationStep = {
      toVersion: 1,
      migrate: (ctx) => {
        ctx.createStore('items', { keyPath: 'id' });
        const req = ctx.store('items').put({ id: 'x', amount: 1 });
        req.onsuccess = () => {
          userHandlerRan = true; // clobbers nothing: tracking uses addEventListener
        };
      },
    };
    const v2ReadsSeed: MigrationStep = {
      toVersion: 2,
      migrate: (ctx) => {
        const req = ctx.store('items').get('x');
        req.addEventListener('success', () => {
          if (!req.result) throw new Error('v2 ran before v1 write settled');
        });
      },
    };
    const db = await open(name, [v1Seeds, v2ReadsSeed]);
    expect(userHandlerRan).toBe(true);
    expect(await getAll(db, 'items')).toEqual([{ id: 'x', amount: 1 }]);
  });

  it('cursor walk via getAll-style addEventListener users still settles (H1 symmetry)', async () => {
    const name = freshName();
    const db1 = await open(name, [V1_CREATE_ITEMS]);
    await put(db1, 'items', { id: 'a', amount: 5 });
    db1.close();
    const v2Walk: MigrationStep = {
      toVersion: 2,
      migrate: (ctx) => {
        const cursorReq = ctx.store('items').openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result as IDBCursorWithValue | null;
          if (!cursor) return;
          cursor.continue();
        };
      },
    };
    const db = await open(name, [V1_CREATE_ITEMS, v2Walk]);
    expect(db.version).toBe(2);
  });
});
