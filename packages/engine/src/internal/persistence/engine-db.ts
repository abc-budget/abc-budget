/**
 * The engine's database: name, migration lineage, and lazy init.
 * @internal
 */
import type { MigrationStep } from '../store/migrations/migration';
import { openDatabase } from '../store/migrations/open-with-migrations';
import type { DurabilityStatus } from './durability';
import { requestDurability } from './durability';
import { EXCHANGE_RATES_STORE, EXCHANGE_RATES_STORE_CONFIG } from '../exchange-rate/dao';
import { USER_SETTINGS_STORE, USER_SETTINGS_STORE_CONFIG, UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { hydrateEngineConfig } from '../settings/engine-config';
import { getLogger } from '../logging';

export const ENGINE_DB_NAME = 'abc-budget';

/**
 * v1 is a deliberate NO-OP ANCHOR: it pins the version sequence without creating any
 * store (HC-2/3 — no raw-ledger assumptions; store shapes are settled by their epics).
 * EP-4 rules / EP-6 budget append steps here.
 *
 * v2: creates the `exchangeRates` object store (keyPath: ['base', 'date'], indexes: base + date).
 *
 * v3: creates `userSettings` (keyPath: 'key', unique index: 'key') and
 *     `recallPool` (keyPath: 'columnName') — ONE step, both stores.
 *
 * v4: creates the `footprint` object store (keyPath: ['hash', 'year', 'month'], no indexes).
 *     The `hash` non-unique lookup index is deferred to Story 3.4 — do NOT add it here.
 *
 * v5: adds the `hash` NON-unique lookup index to the existing `footprint` store (Story 3.4).
 *     Native compound-keyPath upsert needs no lookup; this index serves forward-looking
 *     findByHash (EP-4/EP-6). No `rebuildStore` — the store already exists from v4.
 *
 * v6: creates the `categories` object store (Story 4.3a, ENT-018). keyPath:'id' with STRING
 *     ids (service-generated crypto.randomUUID) — NO autoIncrement. Indexes: `name`,
 *     `isArchived` (archive != delete — soft-archive is indexed), `currency`, all NON-unique.
 *
 * v7: creates the `complexRules` object store (Story 4.3b, FEAT-019). keyPath:'id' with NUMBER
 *     ids — autoIncrement TRUE (CONTRAST v6 categories: string id, NO autoInc). Indexes:
 *     `order` (eval sequence) + `categoryId` (STRING FK), both NON-unique.
 *
 * v8: adds the `year_month_isManual` compound NON-unique index to the existing `footprint`
 *     store (Story 4.4, Q-012 — sticky manual override) and backfills pre-4.4 rows to
 *     isManual:0. `isManual` is stored 0|1 (NOT boolean — a boolean keyPath drops the tuple
 *     from a compound index). The index powers the period-scoped override-map load.
 */
export const ENGINE_MIGRATIONS: MigrationStep[] = [
  {
    toVersion: 1,
    migrate: () => {
      // intentionally empty
    },
  },
  {
    toVersion: 2,
    migrate: (ctx) => {
      const { name: _name, ...spec } = EXCHANGE_RATES_STORE_CONFIG;
      ctx.createStore(EXCHANGE_RATES_STORE, spec);
    },
  },
  {
    toVersion: 3,
    migrate: (ctx) => {
      // userSettings store — exact prior-art STORE_CONFIG (keyPath:'key', unique index:'key')
      const { name: _usName, keyPath: usKeyPath, indexes: usIndexes } = USER_SETTINGS_STORE_CONFIG;
      ctx.createStore(USER_SETTINGS_STORE, {
        keyPath: usKeyPath,
        indexes: usIndexes.map((idx) => ({ ...idx, options: { ...idx.options } })),
      });
      // recallPool store — keyPath:'columnName' (Task 2 recall pool)
      ctx.createStore('recallPool', { keyPath: 'columnName' });
    },
  },
  {
    toVersion: 4,
    migrate: (ctx) => {
      // footprint store — composite keyPath:['hash','year','month'] (EP-3 dedup footprints).
      // No indexes: the `hash` non-unique lookup index is deferred to Story 3.4.
      ctx.createStore('footprint', { keyPath: ['hash', 'year', 'month'] });
    },
  },
  {
    toVersion: 5,
    migrate: (ctx) => {
      // footprint hash lookup index (Story 3.4) — NON-unique. Native compound-keyPath
      // upsert needs no lookup; this index serves forward-looking findByHash (EP-4/EP-6).
      ctx.createIndex('footprint', { name: 'hash', keyPath: 'hash', options: { unique: false } });
    },
  },
  {
    toVersion: 6,
    migrate: (ctx) => {
      // categories store (Story 4.3a, ENT-018) — STRING ids (service-generated
      // crypto.randomUUID), so NO autoIncrement. archive != delete: isArchived is indexed.
      ctx.createStore('categories', {
        keyPath: 'id',
        indexes: [
          { name: 'name', keyPath: 'name', options: { unique: false } },
          { name: 'isArchived', keyPath: 'isArchived', options: { unique: false } },
          { name: 'currency', keyPath: 'currency', options: { unique: false } },
        ],
      });
    },
  },
  {
    toVersion: 7,
    migrate: (ctx) => {
      // complexRules store (Story 4.3b, FEAT-019) — rule id is a NUMBER (autoIncrement),
      // CONTRAST v6 categories (string id, no autoInc). order = eval sequence; categoryId = STRING FK.
      ctx.createStore('complexRules', {
        keyPath: 'id',
        autoIncrement: true,
        indexes: [
          { name: 'order', keyPath: 'order', options: { unique: false } },
          { name: 'categoryId', keyPath: 'categoryId', options: { unique: false } },
        ],
      });
    },
  },
  {
    toVersion: 8,
    migrate: (ctx) => {
      // Story 4.4 (Q-012): sticky manual override. isManual is stored 0|1 (NOT boolean —
      // a boolean keyPath drops the tuple from a compound index). Compound non-unique
      // index [year, month, isManual] powers the period-scoped override-map load.
      ctx.createIndex('footprint', {
        name: 'year_month_isManual',
        keyPath: ['year', 'month', 'isManual'],
        options: { unique: false },
      });
      // Backfill existing footprints (pre-4.4) to isManual: 0. Iterate the STORE
      // (not the to-be-built index — see migration.ts CURSOR-OVER-MUTATED-INDEX caveat).
      // Fresh install has no rows (no-op). The wrapped store proxy tracks this cursor
      // walk to exhaustion before the version-change tx commits.
      const store = ctx.store('footprint');
      const req = store.openCursor();
      req.onsuccess = () => {
        const cursor = req.result as IDBCursorWithValue | null;
        if (!cursor) return;
        const value = cursor.value as { isManual?: number };
        if (value.isManual === undefined) cursor.update({ ...value, isManual: 0 });
        cursor.continue();
      };
    },
  },
];

export interface PersistenceInitResult {
  opened: boolean;
  durability: DurabilityStatus | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let initPromise: Promise<PersistenceInitResult> | null = null;

// ── onblocked hook (Story 2.6 — the 1.2 multi-tab carry-in) ─────────────────────
//
// Multi-tab model: "loud, not coordinated" (2.6 decision 1).  When the engine-DB
// open fires `blocked` (another tab holds an older version), every registered
// listener is notified — the worker host forwards this as the out-of-band
// `blocked` event so the UI can render the loud close-other-tabs state.
//
// Shape (additive — nothing existing changes):
//   onEngineDbBlocked(listener: () => void): () => void   // returns unsubscribe

const blockedListeners = new Set<() => void>();

/**
 * Subscribe to engine-DB `blocked` notifications (version-change blocked by
 * another open connection).  Returns an unsubscribe function.
 */
export function onEngineDbBlocked(listener: () => void): () => void {
  blockedListeners.add(listener);
  return () => {
    blockedListeners.delete(listener);
  };
}

function notifyEngineDbBlocked(): void {
  for (const listener of blockedListeners) {
    try {
      listener();
    } catch {
      // listener errors are non-fatal — the open rejection stays the loud signal
    }
  }
}

/**
 * Lazy, memoized engine-DB open.
 *
 * ✅ Clear-on-reject (Story 2.3, Task 1): on rejection the memoized promise is cleared
 * so the next caller retries (new promise) rather than permanently receiving the same
 * rejected promise. This resolves the 1.6 ⚠️ guardrail.
 */
export function openEngineDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS, {
      onBlocked: notifyEngineDbBlocked,
    }).catch((err) => {
      // Clear memoization so the next call retries
      dbPromise = null;
      return Promise.reject(err);
    });
  }
  return dbPromise;
}

/**
 * Engine-init persistence bootstrap: open the DB (proves the migration plumbing on a
 * real, empty database) and request durability. Memoized; guarded no-throw without
 * indexedDB (node, worker spike).
 *
 * In 1.2 a real failure is non-fatal (console.warn) — nothing reads the DB yet and no UI
 * surface exists. ⚠️ CARRY-FORWARD (EP-3, fail-loud): once footprints land, a persist()
 * denial or DB-open failure must surface loudly through the engine to the UI (FEAT-022),
 * not warn-and-continue.
 */
export function initEnginePersistence(): Promise<PersistenceInitResult> {
  initPromise ??= doInit();
  return initPromise;
}

async function doInit(): Promise<PersistenceInitResult> {
  if (typeof indexedDB === 'undefined') {
    return { opened: false, durability: null };
  }
  try {
    const db = await openEngineDb();
    const durability = await requestDurability();

    // Story 2.4 (Task 4) — ENGINE-INIT HYDRATION:
    // After the DB opens, construct a UserSettingsIDBDAO over the live database
    // and hydrate the engine-config snapshot so it reflects any stored overrides
    // before any service or component reads getEngineConfig().
    // Failure here is NON-FATAL but LOUD (HC-7 pattern from 2.3 savePool catch):
    // the snapshot falls back to ENT-016 defaults; the engine continues.
    try {
      const settingsDao = new UserSettingsIDBDAO(() => db);
      await hydrateEngineConfig(settingsDao);
    } catch (hydrateErr) {
      getLogger('engine.persistence.engine-db').error(
        '[engine-init] engine-config hydration failed (non-fatal) — defaults stand:',
        hydrateErr
      );
    }

    return { opened: true, durability };
  } catch (err) {
    console.warn('[abc-engine] persistence init failed (non-fatal in 1.2):', err);
    return { opened: false, durability: null };
  }
}

/**
 * Test seam — resets memoization. Not exported from the package barrel.
 *
 * 2.8 QA MAJOR-1 follow-up: also CLOSE the memoized connection. Nulling the
 * promise alone left a live IDBDatabase open on the (often about-to-be-swapped)
 * fake-indexeddb factory; across spec files that lingering connection holds the
 * DB at its version and made a later open's `onblocked` fire (unhandled →
 * non-zero vitest exit). Closing here makes the seam leak-free for every spec.
 * Fire-and-forget close (the promise may still be resolving); swallow errors —
 * a reset must never throw.
 */
export function resetPersistenceForTests(): void {
  const closing = dbPromise;
  dbPromise = null;
  initPromise = null;
  if (closing) {
    closing.then((db) => db.close()).catch(() => { /* never throw from a reset */ });
  }
}
