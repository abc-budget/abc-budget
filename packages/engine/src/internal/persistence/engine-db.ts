/**
 * The engine's database: name, migration lineage, and lazy init.
 * @internal
 */
import type { MigrationStep } from '../store/migrations/migration';
import { openDatabase } from '../store/migrations/open-with-migrations';
import type { DurabilityStatus } from './durability';
import { requestDurability } from './durability';

export const ENGINE_DB_NAME = 'abc-budget';

/**
 * v1 is a deliberate NO-OP ANCHOR: it pins the version sequence without creating any
 * store (HC-2/3 — no raw-ledger assumptions; store shapes are settled by their epics).
 * EP-3 footprints / EP-4 rules / EP-6 budget append steps v2+ here.
 */
export const ENGINE_MIGRATIONS: MigrationStep[] = [
  {
    toVersion: 1,
    migrate: () => {
      // intentionally empty
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
 * Lazy, memoized engine-DB open. Future DAO consumers (EP-2+) build on this.
 *
 * ⚠️ EP-2 NOTE: a failed open memoizes a REJECTED promise for the process lifetime —
 * fine in 1.2 (doInit masks it; nothing else calls this), but before real DAO consumers
 * wire in, add clear-on-reject (or retry) so one transient failure doesn't brick the
 * engine until reload.
 */
export function openEngineDb(): Promise<IDBDatabase> {
  dbPromise ??= openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS);
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
    await openEngineDb();
    const durability = await requestDurability();
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
