/**
 * importReview end-to-end spec — Story 5.3, Task 4 (EP-5 S3d review union).
 *
 * Drives `client.importReview(sessionId, opts)` over a REAL `createDirectEngineClient`
 * backed by fake-indexeddb — the same object the worker host shims over.  Uses a
 * synthetic 3-row import to produce a session that contains:
 *
 *   (a) 2 normal expense rows (negative AMOUNT with mixed type) → ok
 *   (b) 1 income row (positive AMOUNT with mixed type) → skipped
 *
 * NOTE on the missing `rowError` state: producing a per-row error through the REAL
 * pipeline requires either (i) a cell that is marked error at stage2 but whose
 * error doesn't surface until stage3 (e.g. a bad DATE that is cast as string at
 * stage3, which then causes a TypeError inside autoCategorize, not a collected
 * rowError), or (ii) a single income-only AMOUNT column (which affects ALL rows,
 * not just one). Neither combination produces a clean 1-error fixture without
 * complexity that outweighs the transport-wire value. The service unit test
 * (categorization-service-impl.spec.ts) directly exercises the `ok/error/skipped`
 * union via a mock accessor. This e2e test focuses on the transport wire, accessor
 * binding, dup detection, windowing, and the full ok+skipped path.
 *
 * Asserts:
 *   - Both ok and skipped states present.
 *   - ok rows have categoryId field + dup:false + positive abs amount.
 *   - skipped row has state:'skipped' + non-empty reasons array.
 *   - summary counts match (total=3, ok=2, skipped=1, error=0, dup=0, newCount=2).
 *   - Windowing slices only rows; summary stays full-set.
 *   - After importCommit, a second session with the same data reports all ok rows
 *     as dup:true + summary.dup===2 + newCount===0.
 *
 * Infrastructure mirrors import-commit.spec.ts (the direct-client e2e variant):
 *   - globalThis.indexedDB = new IDBFactory() + resetPersistenceForTests() per test.
 *   - openTestDb() opens a second connection to the engine DB for RatesDao.
 *   - Base currency = 'UAH'; all expense rows are UAH. Rates seeded so both
 *     importReview (dup-detection path) and importCommit (rate-convert path) work.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDirectEngineClient } from './direct-client';
import type { EngineClient } from './engine-client';
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

/** Two op dates (UTC) for the normal expense rows. */
const DAY_A = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15
const DAY_B = new Date(Date.UTC(2026, 5, 20)); // 2026-06-20

/** yyyy-MM-dd string — the rate-cache key and the import row date format. */
function dateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

/**
 * Raw rows for importStart:
 *   Row 0: expense on DAY_A (negative amount with mixed type) → ok
 *   Row 1: expense on DAY_B (negative amount with mixed type) → ok
 *   Row 2: income on DAY_A  (positive amount with mixed type) → skipped
 *
 * Using mixed type: negative → expense (ok), positive → income (skipped).
 */
const RAW_ROWS: Record<string, unknown>[] = [
  { Date: dateKey(DAY_A), Amount: '-100.00', Desc: 'expense-a' },
  { Date: dateKey(DAY_B), Amount: '-200.00', Desc: 'expense-b' },
  { Date: dateKey(DAY_A), Amount: '500.00',  Desc: 'income-row' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract original-name text from a Stage2ColumnDTO. */
function nameOf(col: Stage2ColumnDTO): string {
  return 'text' in col.originalName ? col.originalName.text : col.originalName.key;
}

/**
 * Apply a minimal three-column mapping:
 *   Date → DATE (auto format)
 *   Amount → AMOUNT (mixed type, UAH) — mixed: negative → expense ok, positive → skipped
 *   Desc → DESCRIPTION
 */
async function applyMinimalMappings(
  client: EngineClient,
  sessionId: string,
  snap: Stage2SnapshotDTO,
): Promise<Stage2SnapshotDTO> {
  const mappings: { name: string; def: ColumnDefinition; params: Record<string, unknown> | null }[] = [
    { name: 'Date',   def: ColumnDefinition.DATE,        params: { format: 'auto' } },
    { name: 'Amount', def: ColumnDefinition.AMOUNT,      params: { type: 'mixed', currency: { code: 'UAH' } } },
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

/** Open a SECOND connection to the engine DB for test-side DAO access. */
async function openTestDb(): Promise<IDBDatabase> {
  return openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS);
}

// ── Test infrastructure ───────────────────────────────────────────────────────

let testDbs: IDBDatabase[] = [];

beforeEach(() => {
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

// ── Shared bootstrap ─────────────────────────────────────────────────────────

/**
 * Bootstrap a live import session in `client`:
 *   - set base currency to UAH
 *   - importStart with RAW_ROWS
 *   - apply minimal column mappings (mixed amount)
 *   - importNext (advances to stage3; seeds the session-rows/review accessor)
 *   - seed UAH rates for DAY_A and DAY_B
 *
 * Returns { sessionId, ratesDao, db }.
 */
async function bootstrap(client: EngineClient): Promise<{
  sessionId: string;
  db: IDBDatabase;
  ratesDao: IDBExchangeRateDAO;
}> {
  await client.setBaseCurrency('UAH');

  const { sessionId, stage2 } = await client.importStart(RAW_ROWS);
  await applyMinimalMappings(client, sessionId, stage2);

  const nextRes = await client.importNext(sessionId);
  if (!nextRes.ok) {
    throw new Error(`importNext failed: ${JSON.stringify(nextRes.unmapped)}`);
  }

  const db = await openTestDb();
  testDbs.push(db);
  const dbProvider = () => db;
  const ratesDao = new IDBExchangeRateDAO(dbProvider);

  // Seed UAH rates for both op dates (used by importReview dup-detection via
  // autoCategorize + by importCommit's cache-only rate-convert).
  await ratesDao.upsert({ base: 'USD', date: dateKey(DAY_A), UAH: 40 });
  await ratesDao.upsert({ base: 'USD', date: dateKey(DAY_B), UAH: 41 });

  return { sessionId, db, ratesDao };
}

// ── importReview end-to-end ───────────────────────────────────────────────────

describe('importReview wire (Task 4 — v8 EP-5 S3d review union)', () => {
  it('returns ok + skipped states with correct summary (total=3, ok=2, skipped=1)', async () => {
    const client = createDirectEngineClient();
    const { sessionId } = await bootstrap(client);

    const win = await client.importReview(sessionId, { offset: 0, count: 100 });

    // Summary: 2 ok, 0 error, 1 skipped, total=3
    expect(win.summary.total).toBe(3);
    expect(win.summary.ok).toBe(2);
    expect(win.summary.error).toBe(0);
    expect(win.summary.skipped).toBe(1);
    expect(win.summary.dup).toBe(0);
    expect(win.summary.newCount).toBe(2); // ok - dup = 2 - 0 = 2

    // All 3 rows returned
    expect(win.rows).toHaveLength(3);

    // States present: ok and skipped
    const states = new Set(win.rows.map((r) => r.state));
    expect(states.has('ok')).toBe(true);
    expect(states.has('skipped')).toBe(true);
  });

  it('ok rows have categoryId field + dup:false + positive abs amount + date', async () => {
    const client = createDirectEngineClient();
    const { sessionId } = await bootstrap(client);

    const win = await client.importReview(sessionId, { offset: 0, count: 100 });

    const okRows = win.rows.filter((r) => r.state === 'ok');
    expect(okRows).toHaveLength(2);

    for (const okRow of okRows) {
      // categoryId must be present (null if no rule matches — that's fine)
      expect('categoryId' in okRow).toBe(true);
      expect(okRow.dup).toBe(false);
      expect(typeof okRow.amount).toBe('number');
      expect(okRow.amount).toBeGreaterThan(0); // abs value (mixed type → negative → abs)
      expect(okRow.date).toBeTruthy();
    }
  });

  it('skipped row has state:skipped + a reason (income)', async () => {
    const client = createDirectEngineClient();
    const { sessionId } = await bootstrap(client);

    const win = await client.importReview(sessionId, { offset: 0, count: 100 });

    const skipRows = win.rows.filter((r) => r.state === 'skipped');
    expect(skipRows).toHaveLength(1);
    expect(skipRows[0].reasons).toBeDefined();
    expect(skipRows[0].reasons!.length).toBe(1);
    // The reason key or text should mention income/positive/ignored
    const reason = skipRows[0].reasons![0];
    const reasonStr = JSON.stringify(reason);
    expect(reasonStr).toMatch(/income|positive|ignored/i);
  });

  it('union order: ok rows come first, then skipped (offset/count slices correctly)', async () => {
    const client = createDirectEngineClient();
    const { sessionId } = await bootstrap(client);

    // Offset 0 count 2 → should return the first 2 rows (both ok rows in union order)
    const winSliced = await client.importReview(sessionId, { offset: 0, count: 2 });

    // Summary is always full-set
    expect(winSliced.summary.total).toBe(3);
    expect(winSliced.summary.ok).toBe(2);
    expect(winSliced.summary.skipped).toBe(1);

    // Only 2 rows returned
    expect(winSliced.rows).toHaveLength(2);
    // Both should be ok (ok rows come first in the union)
    expect(winSliced.rows[0].state).toBe('ok');
    expect(winSliced.rows[1].state).toBe('ok');
  });

  it('after importCommit, a second session with the same data reports dup:true for all ok rows + summary.dup===2 + newCount===0', async () => {
    // First session: commit the 2 ok rows' footprints.
    const client = createDirectEngineClient();
    const { sessionId: firstSessionId } = await bootstrap(client);

    const commitRes = await client.importCommit(firstSessionId);
    // Only ok rows commit (skipped rows are excluded from footprints)
    expect(commitRes.rowsCommitted).toBe(2);

    // Second session: fresh import with the SAME raw data.
    // Same client = same IDB universe → footprints from the first commit are present.
    const { sessionId: secondSessionId } = await bootstrap(client);

    const win2 = await client.importReview(secondSessionId, { offset: 0, count: 100 });

    // Both ok rows are dups now
    const okRows2 = win2.rows.filter((r) => r.state === 'ok');
    expect(okRows2).toHaveLength(2);
    for (const row of okRows2) {
      expect(row.dup).toBe(true);
    }

    // Summary reflects both as dups
    expect(win2.summary.dup).toBe(2);
    expect(win2.summary.newCount).toBe(0); // ok - dup = 2 - 2 = 0
  });
});
