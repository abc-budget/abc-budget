/**
 * Engine composition root (Story 2.6, Task 4 — the 2.3 wiring MUST-DO dies here).
 *
 * `composeEngine()` constructs the production object graph:
 *   - opens the engine DB (initEnginePersistence — v3 migrations + durability +
 *     engine-config hydration at engine init, the 2.4 semantics),
 *   - constructs the REAL `UserSettingsIDBDAO` over the live database,
 *   - constructs the REAL recall pool (`createRecallPool`),
 *   - wires the remote rates api into the module-level rates holder (lazy
 *     ExchangeRateService construction stays in rates-holder.ts),
 *   - constructs `ImportStatementServiceImpl` with settingsDao + recallPool WIRED.
 *
 * ONE root, BOTH hosts: `createDirectEngineClient` (in-thread — vitest/QA) and
 * `attachEngineHost` (the worker host) compose through this module, so the
 * direct and worker transports run the IDENTICAL object graph.
 *
 * No-indexedDB baseline: when `indexedDB` is absent (node without fake-indexeddb)
 * or the open fails, composeEngine resolves with null settingsDao/recallPool and a
 * service constructed with nulls — NO throw.  The deterministic node baseline
 * (engine-config defaults, no recall, no use_base) stays byte-identical.
 */

import type { ExchangeRateApi } from '../exchange-rate/api';
import { setRemoteRatesApi } from '../exchange-rate/rates-holder';
import { WorkerHttpRatesApi } from '../exchange-rate/worker-http-rates-api';
import { initEnginePersistence, openEngineDb } from '../persistence/engine-db';
import type { PersistenceInitResult } from '../persistence/engine-db';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import type { UserSettingsDAO } from '../settings/user-settings';
import { createRecallPool } from '../importStatement/recall/recall';
import type { RecallPool } from '../importStatement/recall/recall';
import { ImportStatementServiceImpl } from '../importStatement/service';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Options accepted by composeEngine (mirrors the public EngineInitOptions). */
export interface ComposeEngineOptions {
  /**
   * Remote ExchangeRateApi implementation supplied by the app layer.
   * When provided, the engine wires a 2-level cache (IDB → remote) lazily.
   * When omitted, composeEngine self-derives a same-origin WorkerHttpRatesApi.
   */
  exchangeRateApi?: ExchangeRateApi;
}

/** The composed production object graph. */
export interface ComposedEngine {
  /** Import service with settingsDao + recallPool wired (nulls when no IDB). */
  readonly service: ImportStatementServiceImpl;
  /** Real UserSettingsIDBDAO over the live engine DB; null when no IDB. */
  readonly settingsDao: UserSettingsDAO | null;
  /** Real recall pool over the live engine DB; null when no IDB. */
  readonly recallPool: RecallPool | null;
  /** Result of initEnginePersistence (opened flag + durability). */
  readonly persistence: PersistenceInitResult;
}

// ── composeEngine ─────────────────────────────────────────────────────────────

/**
 * Compose the production engine object graph.
 *
 * Safe in every environment: where indexedDB is absent the graph composes with
 * nulls and never throws (the node-without-idb baseline stays deterministic).
 */
export async function composeEngine(options?: ComposeEngineOptions): Promise<ComposedEngine> {
  // Rates holder wiring — module-level; lazy service construction on first use.
  // When no explicit api is provided, self-derive the same-origin WorkerHttpRatesApi so the
  // worker host (which composes WITHOUT a rates api) gets a working remote. This closes the
  // 2.6 carry-forward gap (worker had an IDB rate cache DAO but no remote source) WITHOUT an
  // init param and WITHOUT touching CONTRACT_VERSION — nothing about rates crosses the wire.
  // An explicit override (in-thread/QA composition) is preserved as-is.
  setRemoteRatesApi(options?.exchangeRateApi ?? new WorkerHttpRatesApi());

  // Opens the engine DB (v3 migrations), requests durability, hydrates the
  // engine-config snapshot (2.4 engine-init hydration). Memoized; no-throw
  // where indexedDB is absent.
  const persistence = await initEnginePersistence();

  if (!persistence.opened) {
    // No persistence — compose with nulls, no throw.
    return {
      service: new ImportStatementServiceImpl(),
      settingsDao: null,
      recallPool: null,
      persistence,
    };
  }

  const db = await openEngineDb();
  const dbProvider = () => db;

  const settingsDao = new UserSettingsIDBDAO(dbProvider);
  const recallPool = createRecallPool(dbProvider);

  // THE 2.3 MUST-DO dies here: ImportStatementServiceImpl with settingsDao +
  // recallPool wired (stage3 categorization deps stay null until EP-4).
  const service = new ImportStatementServiceImpl(null, null, settingsDao, recallPool);

  return { service, settingsDao, recallPool, persistence };
}
