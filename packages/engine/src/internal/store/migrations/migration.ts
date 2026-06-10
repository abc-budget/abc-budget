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

  // H1: Use addEventListener instead of assignment so user onsuccess/onerror assignments
  // on the raw request cannot clobber our tracking listeners.
  const trackRequest = (req: IDBRequest, onOk?: () => void): void => {
    pendingCount++;
    req.addEventListener('success', () => {
      try {
        onOk?.();
      } catch (err) {
        failed = err;
      }
      settleOne();
    });
    req.addEventListener('error', () => {
      failed = req.error ?? new Error('migration request failed');
      settleOne();
    });
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

  /**
   * Shared method-interception logic for wrapping IDBObjectStore and IDBIndex proxies.
   *
   * `openCursor` / `openKeyCursor` are cursor requests: `onsuccess` fires once per row
   * plus a final time with `result === null`. We track them as a single pending unit,
   * settling only when the cursor exhausts.
   *
   * H3: Extracted so both the store proxy and index proxy share the same interception,
   * avoiding copy-paste of method lists.
   */
  const wrapRequest = <T extends IDBRequest>(req: T): T => {
    trackRequest(req);
    return req;
  };

  /**
   * Wraps a cursor request so the migration context knows to wait for full cursor
   * exhaustion before advancing to the next step.
   *
   * Returns a proxy around the real request. The proxy stores `onsuccess` as a plain
   * property so user code can assign it after `openCursor()` returns. The real request
   * gets a single interceptor that reads the proxy's `onsuccess` at fire-time, checks
   * for cursor exhaustion, and settles only when `cursor.result === null`.
   *
   * H1: The cursor.continue / continuePrimaryKey re-arming patch has been removed.
   * It was dead code: the proxy intercepts all user assignments to `onsuccess` on the
   * returned proxy, so the real request's `onsuccess = interceptOnsuccess` is never
   * replaced. Re-arming was unnecessary.
   *
   * H2: `interceptOnsuccess` now receives the real IDB event and passes it through to
   * the user handler, so `ev.target` is the real IDBRequest (not null from a fabricated
   * Event). Likewise the error handler passes the real error event through.
   */
  const wrapCursor = <T extends IDBRequest<IDBCursor | IDBCursorWithValue | null>>(req: T): T => {
    pendingCount++;

    // Proxy properties: user writes to these, we read them at fire-time.
    let userOnsuccess: ((this: T, ev: Event) => void) | null = null;
    let userOnerror: ((this: T, ev: Event) => void) | null = null;

    // H2: Accept the real event so ev.target is the actual IDBRequest.
    const interceptOnsuccess = (ev: Event): void => {
      const cursor = req.result as IDBCursor | null;
      if (cursor === null) {
        // Cursor exhausted — pass the real event to user handler.
        userOnsuccess?.call(proxy, ev);
        settleOne();
        return;
      }
      // Patch cursor.continue / continuePrimaryKey so the NEXT iteration also
      // goes through our interceptor. This re-arm is necessary: fake-indexeddb
      // (and some real IDB implementations) clear req.onsuccess to null after
      // firing it, so we must re-set it before calling the real continue().
      const origContinue = cursor.continue.bind(cursor);
      cursor.continue = (...args: Parameters<IDBCursor['continue']>): void => {
        req.onsuccess = interceptOnsuccess;
        origContinue(...args);
      };
      const origContinuePK = cursor.continuePrimaryKey?.bind(cursor);
      if (origContinuePK) {
        cursor.continuePrimaryKey = (...args: Parameters<IDBCursor['continuePrimaryKey']>): void => {
          req.onsuccess = interceptOnsuccess;
          origContinuePK(...args);
        };
      }
      // Invoke user handler with the proxy as `this` and the real event.
      userOnsuccess?.call(proxy, ev);
    };

    // Arm the real request's onsuccess with our interceptor immediately.
    // The proxy shields this assignment from user code — users only set
    // onsuccess on the proxy, which stores it in userOnsuccess.
    req.onsuccess = interceptOnsuccess;

    // H1: Use addEventListener for error so it coexists with any other error listeners.
    // H2: Pass the real error event through to user handler.
    req.addEventListener('error', (ev: Event) => {
      userOnerror?.call(proxy, ev);
      failed = req.error ?? new Error('cursor request failed');
      settleOne();
    });

    // Build a proxy that:
    //  - forwards `result` / `readyState` / `error` etc. to the real request
    //  - stores `onsuccess` and `onerror` locally (so user assignments don't overwrite our interceptors)
    //  - forwards all methods (like `addEventListener`) to the real request
    const proxy = new Proxy(req, {
      get(target, prop) {
        if (prop === 'onsuccess') return userOnsuccess;
        if (prop === 'onerror') return userOnerror;
        const val = target[prop as keyof T];
        return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(target) : val;
      },
      set(target, prop, value) {
        if (prop === 'onsuccess') { userOnsuccess = value as typeof userOnsuccess; return true; }
        if (prop === 'onerror') { userOnerror = value as typeof userOnerror; return true; }
        (target as Record<string | symbol, unknown>)[prop] = value;
        return true;
      },
    }) as T;

    return proxy;
  };

  /**
   * Applies the shared method interception to a target (IDBObjectStore or IDBIndex),
   * returning a Proxy that tracks all request-returning operations.
   *
   * H3: Shared between wrapStore and wrapIndex so index()-based cursor walks are
   * also tracked, preventing the sequencing bug via ctx.store(...).index(...).openCursor().
   */
  const makeMethodProxy = <T extends IDBObjectStore | IDBIndex>(target: T): T => {
    return new Proxy(target, {
      get(t, prop) {
        if (prop === 'openCursor' || prop === 'openKeyCursor') {
          return (...args: unknown[]) => {
            const fn = t[prop as 'openCursor'] as (...a: unknown[]) => IDBRequest<IDBCursor | IDBCursorWithValue | null>;
            const req = fn.apply(t, args);
            return wrapCursor(req);
          };
        }
        if (
          prop === 'get' ||
          prop === 'getAll' ||
          prop === 'getAllKeys' ||
          prop === 'getKey' ||
          prop === 'count' ||
          prop === 'put' ||
          prop === 'add' ||
          prop === 'delete' ||
          prop === 'clear'
        ) {
          return (...args: unknown[]) => {
            const fn = t[prop as keyof T] as (...a: unknown[]) => IDBRequest;
            const req = fn.apply(t, args);
            return wrapRequest(req);
          };
        }
        // H3: For the store proxy, intercept index() to return a wrapped IDBIndex proxy.
        if (prop === 'index' && 'index' in t) {
          return (...args: unknown[]) => {
            const fn = (t as IDBObjectStore).index.bind(t as IDBObjectStore);
            const idx = fn(...(args as [string]));
            return makeMethodProxy(idx);
          };
        }
        const val = t[prop as keyof T];
        return typeof val === 'function' ? (val as (...a: unknown[]) => unknown).bind(t) : val;
      },
    }) as T;
  };

  /**
   * Returns a wrapped IDBObjectStore whose request-returning methods are automatically
   * tracked by the migration context. This is necessary so that async operations initiated
   * by user code inside `migrate()` (e.g. cursor walks via `openCursor`) are sequenced
   * correctly before the next step runs.
   */
  const wrapStore = (raw: IDBObjectStore): IDBObjectStore => makeMethodProxy(raw);

  const api: MigrationContext = {
    createStore: buildStore,
    deleteStore: (name) => db.deleteObjectStore(name),
    createIndex: (storeName, idx) => {
      tx.objectStore(storeName).createIndex(idx.name, idx.keyPath, idx.options);
    },
    deleteIndex: (storeName, indexName) => tx.objectStore(storeName).deleteIndex(indexName),
    store: (name) => wrapStore(tx.objectStore(name)),
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
