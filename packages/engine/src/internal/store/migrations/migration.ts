/**
 * Versioned-migration types and the migration context.
 * @module internal/store/migrations
 * @internal
 *
 * Replaces the prior-art `store/idb/database.ts`, whose additive-only config and
 * transaction-less callback could not express data migrations.
 */

/** Index definition, shape inherited from the prior-art IDBIndexConfig. */
export interface StoreIndexSpec {
  name: string;
  keyPath: string | string[];
  options?: { unique?: boolean; multiEntry?: boolean };
}

/** Object-store definition, shape inherited from the prior-art IDBStoreConfig. */
export interface StoreSpec {
  keyPath?: string | string[];
  autoIncrement?: boolean;
  indexes?: StoreIndexSpec[];
}

/**
 * Handed to each migration step. Wraps the native version-change transaction.
 *
 * ⚠️ SYNC DISCIPLINE (the classic IndexedDB migration pitfall): `migrate()` must NOT
 * await external promises — the version-change transaction auto-commits as soon as its
 * request queue drains. Enqueueing IDB requests via these helpers (or on `store(name)`)
 * is the one legal async pattern inside a migration.
 */
export interface MigrationContext {
  createStore(name: string, spec?: StoreSpec): IDBObjectStore;
  deleteStore(name: string): void;
  createIndex(storeName: string, index: StoreIndexSpec): void;
  deleteIndex(storeName: string, indexName: string): void;
  /** Raw store access on the upgrade tx — for data transforms. */
  store(name: string): IDBObjectStore;
  /**
   * The keyPath-change escape hatch: reads all rows, deletes the store, recreates it
   * with `spec`, and re-inserts every row (optionally transformed). Runs entirely inside
   * the version-change transaction — atomic with the rest of the upgrade.
   */
  rebuildStore(name: string, spec?: StoreSpec, transform?: (row: unknown) => unknown): void;
}

/** One migration step. Steps must be contiguous from 1; DB version = last step's toVersion. */
export interface MigrationStep {
  toVersion: number;
  migrate(ctx: MigrationContext): void;
}

/**
 * Builds a MigrationContext plus a `whenSettled` hook the replay engine uses to sequence
 * steps: helper-enqueued async work (rebuildStore's read-then-recreate) must complete
 * before the next step runs. All callbacks fire on the still-open version-change tx —
 * there is never a macrotask gap that would let the tx auto-commit early.
 */
export function createMigrationContext(
  db: IDBDatabase,
  tx: IDBTransaction,
): { api: MigrationContext; whenSettled(ok: () => void, fail: (err: unknown) => void): void } {
  let pendingCount = 0;
  let failed: unknown = null;
  let onAllSettled: (() => void) | null = null;
  let onFail: ((err: unknown) => void) | null = null;

  const settleOne = (): void => {
    pendingCount--;
    if (pendingCount === 0) {
      if (failed !== null) onFail?.(failed);
      else onAllSettled?.();
    }
  };

  const trackRequest = (req: IDBRequest, onOk?: () => void): void => {
    pendingCount++;
    req.onsuccess = () => {
      try {
        onOk?.();
      } catch (err) {
        failed = err;
      }
      settleOne();
    };
    req.onerror = () => {
      failed = req.error ?? new Error('migration request failed');
      settleOne();
    };
  };

  const buildStore = (name: string, spec: StoreSpec = {}): IDBObjectStore => {
    const store = db.createObjectStore(name, {
      keyPath: spec.keyPath,
      autoIncrement: spec.autoIncrement,
    });
    for (const idx of spec.indexes ?? []) {
      store.createIndex(idx.name, idx.keyPath, idx.options);
    }
    return store;
  };

  const api: MigrationContext = {
    createStore: buildStore,
    deleteStore: (name) => db.deleteObjectStore(name),
    createIndex: (storeName, idx) => {
      tx.objectStore(storeName).createIndex(idx.name, idx.keyPath, idx.options);
    },
    deleteIndex: (storeName, indexName) => tx.objectStore(storeName).deleteIndex(indexName),
    store: (name) => tx.objectStore(name),
    rebuildStore: (name, spec, transform) => {
      const getAllReq = tx.objectStore(name).getAll();
      trackRequest(getAllReq, () => {
        db.deleteObjectStore(name);
        const next = buildStore(name, spec);
        for (const row of getAllReq.result as unknown[]) {
          // put() errors here surface as a tx error → the whole version change aborts.
          next.put(transform ? transform(row) : row);
        }
      });
    },
  };

  const whenSettled = (ok: () => void, fail: (err: unknown) => void): void => {
    if (pendingCount === 0) {
      if (failed !== null) fail(failed);
      else ok();
      return;
    }
    onAllSettled = ok;
    onFail = fail;
  };

  return { api, whenSettled };
}
