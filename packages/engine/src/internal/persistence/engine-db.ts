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
 * EP-3 footprints / EP-4 rules / EP-6 budget append steps v2+ here.
 *
 * v2: creates the `exchangeRates` object store (keyPath: ['base', 'date'], indexes: base + date).
 *
 * v3: creates `userSettings` (keyPath: 'key', unique index: 'key') and
 *     `recallPool` (keyPath: 'columnName') — ONE step, both stores.
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
];

export interface PersistenceInitResult {
  opened: boolean;
  durability: DurabilityStatus | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let initPromise: Promise<PersistenceInitResult> | null = null;

/**
 * Lazy, memoized engine-DB open.
 *
 * ✅ Clear-on-reject (Story 2.3, Task 1): on rejection the memoized promise is cleared
 * so the next caller retries (new promise) rather than permanently receiving the same
 * rejected promise. This resolves the 1.6 ⚠️ guardrail.
 */
export function openEngineDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS).catch((err) => {
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

/** Test seam — resets memoization. Not exported from the package barrel. */
export function resetPersistenceForTests(): void {
  dbPromise = null;
  initPromise = null;
}
