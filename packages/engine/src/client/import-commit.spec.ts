/**
 * importCommit end-to-end spec — Story 5.1, Task 4 (EP-5 commit pipeline).
 *
 * Drives `client.importCommit(sessionId)` over a REAL `createDirectEngineClient`
 * backed by fake-indexeddb — the same object the worker host shims over.  Uses a
 * synthetic 2-row import (a simple CSV decoded inline) to produce a valid session,
 * then exercises:
 *
 *   (a) importCommit commits the footprints AND frees the session (a second call
 *       with the SAME sessionId → SessionUnknownError — the registry was freed).
 *   (b) A missing cached rate → RatesUnavailableError + ZERO footprints + session
 *       NOT freed → after seeding the rate a RETRY succeeds (the loud-gate retry
 *       guarantee).
 *
 * Infrastructure mirrors engine-worker-host.spec.ts (the direct-client variant):
 *   - globalThis.indexedDB = new IDBFactory() + resetPersistenceForTests() per test
 *     (fresh DB universe, fresh memoized dbPromise).
 *   - openTestDb() opens a SECOND connection to the SAME engine DB to query
 *     FootprintDao from the test side without touching the client's composition.
 *   - Rates are seeded into the SAME DB via IDBExchangeRateDAO so the cache-only
 *     convert the commit loop reads sees the test-injected values.
 *   - Base currency = 'UAH'; all rows are UAH (identity-convert avoids cross-
 *     currency for the retry scenario so only the day-rate lookup gates commit).
 *
 * Session bootstrap: a minimal two-column (DATE + AMOUNT/UAH) import over two
 * synthetic rows, one on each op date.  importNext advances to stage3 so the
 * CategorizationServiceImpl sees typed rows via the session-rows accessor.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDirectEngineClient } from './direct-client';
import type { EngineClient } from './engine-client';
import { RatesUnavailableError } from '../internal/exchange-rate/cache-only-rates-api';
import { FootprintDao } from '../internal/footprint/footprint-dao';
import { IDBExchangeRateDAO } from '../internal/exchange-rate/dao';
import { openDatabase } from '../internal/store/migrations/open-with-migrations';
import {
  ENGINE_DB_NAME,
  ENGINE_MIGRATIONS,
  resetPersistenceForTests,
} from '../internal/persistence/engine-db';
import { resetEngineConfigForTests } from '../internal/settings/engine-config';
import { ColumnDefinition } from '../internal/importStatement/types';
import type { Stage2SnapshotDTO, Stage2ColumnDTO } from './dto';

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Two op dates (UTC) used in the synthetic import rows. */
const DAY_A = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15
const DAY_B = new Date(Date.UTC(2026, 5, 20)); // 2026-06-20

/** yyyy-MM-dd string — the rate-cache key derivation and the import row date format. */
function dateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Minimal raw rows for importStart: two UAH rows on distinct op dates.
 * Columns: 'Date' (ISO date), 'Amount' (negative UAH), 'Desc' (ignored).
 */
const RAW_ROWS: Record<string, unknown>[] = [
  { Date: dateKey(DAY_A), Amount: '-100.00', Desc: 'test-a' },
  { Date: dateKey(DAY_B), Amount: '-200.00', Desc: 'test-b' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract original-name text from a Stage2ColumnDTO. */
function nameOf(col: Stage2ColumnDTO): string {
  return 'text' in col.originalName ? col.originalName.text : col.originalName.key;
}

/**
 * Apply a minimal three-column mapping onto the session: Date → DATE, Amount →
 * AMOUNT (UAH outcome), Desc → IGNORE.  Returns the final snapshot.
 */
async function applyMinimalMappings(
  client: EngineClient,
  sessionId: string,
  snap: Stage2SnapshotDTO,
): Promise<Stage2SnapshotDTO> {
  const mappings: { name: string; def: ColumnDefinition; params: Record<string, unknown> | null }[] = [
    { name: 'Date',   def: ColumnDefinition.DATE,   params: { format: 'auto' } },
    { name: 'Amount', def: ColumnDefinition.AMOUNT, params: { type: 'outcome', currency: { code: 'UAH' } } },
    { name: 'Desc',   def: ColumnDefinition.DESCRIPTION, params: null },
  ];
  let current = snap;
  for (const m of mappings) {
    const col = current.columns.find((c) => nameOf(c) === m.name);
    if (!col) throw new Error(`column '${m.name}' not in snapshot`);
    const res = await client.importApplyColumn(sessionId, col.id, m.def, m.params);
    if (!res.ok) throw new Error(`column rejection for '${m.name}': ${JSON.stringify(res.rejection)}`);
    current = res.snapshot;
  }
  return current;
}

/** Open a SECOND connection to the engine DB so the test side can query stores. */
async function openTestDb(): Promise<IDBDatabase> {
  return openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS);
}

// ── Test infrastructure ───────────────────────────────────────────────────────

let testDbs: IDBDatabase[] = [];

beforeEach(() => {
  // Fresh IDB universe per test; fresh memoized dbPromise so each test gets an
  // isolated DB (no state bleeds from a previous test's schema/data).
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  resetEngineConfigForTests();
  testDbs = [];
});

afterEach(() => {
  for (const db of testDbs) {
    try { db.close(); } catch { /* already closed */ }
  }
  testDbs = [];
});

// ── importCommit end-to-end ───────────────────────────────────────────────────

describe('importCommit wire (Task 4 — v7 EP-5 commit + session free)', () => {
  /**
   * Bootstrap a live importSession in `client`:
   *   - set base currency to UAH
   *   - importStart with RAW_ROWS
   *   - apply minimal column mappings
   *   - importNext (advances to stage3 so the rows accessor can serve them)
   *   - seed UAH rates for DAY_A and DAY_B into the DB (unless `skipRates`)
   *
   * Returns { sessionId, db, footprintDao, ratesDao }.
   */
  async function bootstrap(
    client: EngineClient,
    opts?: { skipRateForDayB?: boolean },
  ): Promise<{
    sessionId: string;
    db: IDBDatabase;
    footprintDao: FootprintDao;
    ratesDao: IDBExchangeRateDAO;
  }> {
    // Set base currency (the composition root's live-read requires it pre-importNext).
    await client.setBaseCurrency('UAH');

    // importStart → stage2 snapshot
    const { sessionId, stage2 } = await client.importStart(RAW_ROWS);

    // Map columns
    await applyMinimalMappings(client, sessionId, stage2);

    // Advance to stage3 (generates typed rows; seeds the session-rows accessor).
    const nextRes = await client.importNext(sessionId);
    if (!nextRes.ok) {
      throw new Error(`importNext failed: ${JSON.stringify(nextRes.unmapped)}`);
    }

    // Open a second DB connection for footprint + rate DAO access from the test side.
    const db = await openTestDb();
    testDbs.push(db);
    const dbProvider = () => db;
    const footprintDao = new FootprintDao(dbProvider);
    const ratesDao = new IDBExchangeRateDAO(dbProvider);

    // Seed UAH rates (USD is the base; UAH rows need USD→UAH for the commit loop).
    await ratesDao.upsert({ base: 'USD', date: dateKey(DAY_A), UAH: 40 });
    if (!opts?.skipRateForDayB) {
      await ratesDao.upsert({ base: 'USD', date: dateKey(DAY_B), UAH: 41 });
    }

    return { sessionId, db, footprintDao, ratesDao };
  }

  it('importCommit commits the footprints + frees the session', async () => {
    const client = createDirectEngineClient();
    const { sessionId, footprintDao } = await bootstrap(client);

    const res = await client.importCommit(sessionId);
    expect(res).toEqual({ sessionId, rowsCommitted: RAW_ROWS.length });

    // Footprints were persisted.
    const fps = await footprintDao.getAll();
    expect(fps).toHaveLength(RAW_ROWS.length);
    for (const fp of fps) {
      expect(typeof fp.day).toBe('number');
      expect(typeof fp.amountUSD).toBe('number');
    }

    // Session freed → a second importCommit with the same sessionId throws SessionUnknownError.
    await expect(client.importCommit(sessionId)).rejects.toMatchObject({ name: 'SessionUnknownError' });
  });

  it('a missing rate → RatesUnavailableError, ZERO footprints, session NOT freed (retry-able)', async () => {
    const client = createDirectEngineClient();
    // Skip the DAY_B rate — that row's UAH convert will hit the loud gate.
    const { sessionId, footprintDao, ratesDao } = await bootstrap(client, { skipRateForDayB: true });

    // First attempt: loud gate fires (missing DAY_B rate).
    await expect(client.importCommit(sessionId)).rejects.toBeInstanceOf(RatesUnavailableError);
    // ZERO footprints written (two-phase atomicity: rate check precedes all writes).
    expect((await footprintDao.getAll()).length).toBe(0);

    // Session is still alive (registry NOT freed) → seed the missing rate and retry.
    await ratesDao.upsert({ base: 'USD', date: dateKey(DAY_B), UAH: 41 });
    const retryRes = await client.importCommit(sessionId);
    expect(retryRes.rowsCommitted).toBe(RAW_ROWS.length);
    expect((await footprintDao.getAll()).length).toBe(RAW_ROWS.length);
  });
});
