/**
 * engine-worker-host.spec.ts — Story 2.6 Task 4: the REAL thread hop.
 *
 * Runs the production worker entry (src/engine-worker.ts) under
 * @vitest/web-worker (the 1.1 pattern) against the production WorkerTransport
 * (createWorkerEngineClient).  Everything asserted here CROSSED THE WIRE:
 * requests/responses via postMessage structured clone, errors via the wire
 * codec, events out-of-band.
 *
 * Environment facts (verified by probe before this suite was written):
 *   - each `new Worker(...)` gets a FRESH module graph (worker-side memoization
 *     such as openEngineDb's dbPromise does not leak across workers/tests);
 *   - fake-indexeddb's global IS shared between the test and the worker (same
 *     realm) — worker writes are visible to the test and vice versa.
 *
 * Per-test isolation: `globalThis.indexedDB = new IDBFactory()` in beforeEach +
 * fresh worker(s) per test.
 *
 * Coverage (the Task 4 checklist):
 *   - host unit: helloAck carries CONTRACT_VERSION; unknown method rejected loudly
 *   - engine-db onblocked → hook fires (the additive listener shape)
 *   - handshake + ping/getVersion over the hop
 *   - FULL session flow over the hop: decode → importStart (snapshot DTO shape)
 *     → importApplyColumn ×9 → importGetRows windows → importNext (typed rows,
 *     ISO dates) → post-next apply → SessionUnknownError (registry empty)
 *   - recall prefill + N-of-M visible over the hop (map-once → re-importStart)
 *   - bad column → ColumnRejectionDTO over the hop, rehydrated client-side as
 *     ColumnTransformRejection with cellErrors intact
 *   - SESSION PINS: double importStart → SessionAlreadyActiveError;
 *     post-respawn old sessionId → SessionUnknownError (real terminate+respawn)
 *   - ROW-ECONOMY PIN: 10k-row applyColumn snapshot within 2× of 12-row (equal
 *     column counts)
 *   - engine-config over the hop: store override 0.05 → the 2.4 gate bites
 *   - MID-JOB KILL ATOMICITY PIN (decision 1): terminate mid-flight → recall
 *     pool contains none-or-complete entries, never partial
 *   - PROGRESS HONESTY: 10k-row decode → monotone, ≥2 intermediates,
 *     final done === total; importNext emits final done === total
 */

import '@vitest/web-worker';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorkerEngineClient } from '../../client/worker-client';
import type { WorkerLike } from '../../client/worker-client';
import type { EngineClient, EngineEventPayload, ProgressEventPayload } from '../../client/engine-client';
import type { Stage2SnapshotDTO, ColumnRejectionDTO, Stage2ColumnDTO } from '../../client/dto';
import { rehydrateEngineError } from '../../client/errors';
import { SessionAlreadyActiveError, SessionUnknownError } from '../../client/errors';
import { ColumnTransformRejection } from '../importStatement/stage2/errors';
import { attachEngineHost } from './engine-worker-host';
import type { WorkerScopeLike } from './engine-worker-host';
import { CONTRACT_VERSION } from '../../client/protocol';
import { openDatabase } from '../store/migrations/open-with-migrations';
import {
  ENGINE_DB_NAME,
  ENGINE_MIGRATIONS,
  onEngineDbBlocked,
  openEngineDb,
  resetPersistenceForTests,
} from '../persistence/engine-db';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { SettingKeys } from '../settings/user-settings';
import { setEngineParam, resetEngineConfigForTests } from '../settings/engine-config';
import { setBaseCurrency } from '../settings/base-currency';
import { ColumnDefinition } from '../importStatement/types';
import { RECALL_POOL_STORE } from '../importStatement/recall/pool-dao';

// ---------------------------------------------------------------------------
// Fixtures + helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '../ingest/fixtures');

function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/** Extract the raw header text from a snapshot column's originalName. */
function nameOf(col: Stage2ColumnDTO): string {
  return 'text' in col.originalName ? col.originalName.text : col.originalName.key;
}

function findColumn(snapshot: Stage2SnapshotDTO, columnName: string): Stage2ColumnDTO {
  const col = snapshot.columns.find((c) => nameOf(c) === columnName);
  if (!col) throw new Error(`column '${columnName}' not in snapshot`);
  return col;
}

interface Mapping {
  columnName: string;
  definition: ColumnDefinition;
  params: Record<string, unknown> | null;
}

/** The established mono-like-utf8.csv mapping (pipeline-e2e parity). */
const MONO_MAPPINGS: Mapping[] = [
  { columnName: 'Дата i час операції',  definition: ColumnDefinition.DATE,              params: { format: 'auto' } },
  { columnName: 'Деталі операції',      definition: ColumnDefinition.DESCRIPTION,       params: null },
  { columnName: 'MCC',                  definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
  { columnName: 'Сума в валюті картки', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } },
  { columnName: 'Валюта картки',        definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Сума в USD',           definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Комісія',              definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Кешбек',              definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Залишок',             definition: ColumnDefinition.IGNORE,            params: null },
];

/** Apply all mappings over the hop; every one must come back ok. */
async function applyAll(
  client: EngineClient,
  sessionId: string,
  snapshot: Stage2SnapshotDTO,
  mappings: Mapping[],
): Promise<Stage2SnapshotDTO> {
  let snap = snapshot;
  for (const m of mappings) {
    const col = findColumn(snap, m.columnName);
    const res = await client.importApplyColumn(sessionId, col.id, m.definition, m.params);
    if (!res.ok) {
      throw new Error(`unexpected rejection for '${m.columnName}': ${JSON.stringify(res.rejection)}`);
    }
    snap = res.snapshot;
  }
  return snap;
}

/** Open a SECOND connection to the engine DB from the test side. */
function openTestDb(): Promise<IDBDatabase> {
  return openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS);
}

/** Read all recall-pool entries via a direct store scan. */
function readPoolEntries(db: IDBDatabase): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECALL_POOL_STORE, 'readonly');
    const req = tx.objectStore(RECALL_POOL_STORE).getAll();
    req.onsuccess = () => resolve(req.result as unknown[]);
    req.onerror = () => reject(req.error);
  });
}

/** Poll until the recall pool holds at least `min` entries (savePool is async). */
async function waitForPoolEntries(db: IDBDatabase, min: number, timeoutMs = 4000): Promise<unknown[]> {
  const start = Date.now();
  for (;;) {
    const entries = await readPoolEntries(db);
    if (entries.length >= min) return entries;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`recall pool never reached ${min} entries (got ${entries.length})`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

/** Synthetic in-memory rows (equal column counts across sizes — row-economy pin). */
function syntheticRows(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    Name: `name-${i % 7}`,
    Note: `note-${i % 5}`,
    Extra: `x-${i % 3}`,
  }));
}

/** Build a synthetic CSV with `n` data rows (progress honesty + decode tests). */
function syntheticCsvBytes(n: number): ArrayBuffer {
  const lines = ['Date,Amount,Description'];
  for (let i = 0; i < n; i++) {
    lines.push(`2024-01-${String((i % 28) + 1).padStart(2, '0')},-${(i % 90) + 1}.50,row ${i}`);
  }
  const buf = new TextEncoder().encode(lines.join('\n'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// ---------------------------------------------------------------------------
// Per-test infrastructure
// ---------------------------------------------------------------------------

let rawWorkers: Worker[] = [];
let testDbs: IDBDatabase[] = [];

/** Spawn the PRODUCTION worker entry — this is the real hop. */
function workerFactory(): WorkerLike {
  const w = new Worker(new URL('../../engine-worker.ts', import.meta.url), { type: 'module' });
  rawWorkers.push(w);
  return w as unknown as WorkerLike;
}

function makeClient(): EngineClient {
  return createWorkerEngineClient(workerFactory);
}

/**
 * Kill the most recent worker: notify the transport (its onerror handler —
 * drain + dead event) and actually terminate the worker.
 */
function killCurrentWorker(): void {
  const w = rawWorkers[rawWorkers.length - 1];
  (w as unknown as { onerror: ((ev: unknown) => void) | null }).onerror?.(new Error('killed by test'));
  w.terminate();
}

async function trackedTestDb(): Promise<IDBDatabase> {
  const db = await openTestDb();
  testDbs.push(db);
  return db;
}

beforeEach(() => {
  // Fresh IDB universe per test; fresh worker module graphs come for free.
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  resetEngineConfigForTests();
});

afterEach(() => {
  for (const w of rawWorkers) {
    try { w.terminate(); } catch { /* already dead */ }
  }
  rawWorkers = [];
  for (const db of testDbs) {
    try { db.close(); } catch { /* already closed */ }
  }
  testDbs = [];
});

// ===========================================================================
// Host unit (fake scope — no hop): handshake ack + unknown-method rejection
// ===========================================================================

describe('host unit (fake scope)', () => {
  function makeScope(): { scope: WorkerScopeLike; posted: unknown[] } {
    const posted: unknown[] = [];
    const scope: WorkerScopeLike = {
      postMessage: (d: unknown) => posted.push(d),
      onmessage: null,
    };
    return { scope, posted };
  }

  it('replies to hello with helloAck carrying CONTRACT_VERSION', () => {
    const { scope, posted } = makeScope();
    attachEngineHost(scope);
    scope.onmessage!({ data: { kind: 'hello', contract: 999 } });
    expect(posted[0]).toEqual({ kind: 'helloAck', contract: CONTRACT_VERSION });
    expect(CONTRACT_VERSION).toBe(2);
  });

  it('rejects an unknown method loudly (name preserved over the codec)', async () => {
    const { scope, posted } = makeScope();
    attachEngineHost(scope);
    scope.onmessage!({ data: { kind: 'req', id: 7, method: 'notAMethod', args: [] } });
    // sequential queue → drain microtasks
    await new Promise((r) => setTimeout(r, 10));
    const res = posted.find((p) => (p as { kind?: string }).kind === 'res') as
      | { id: number; ok: boolean; error: { name: string; message: string } }
      | undefined;
    expect(res).toBeDefined();
    expect(res!.id).toBe(7);
    expect(res!.ok).toBe(false);
    expect(res!.error.message).toMatch(/Unknown engine method: 'notAMethod'/);
  });
});

// ===========================================================================
// engine-db onblocked → host event hook (the additive listener shape)
// ===========================================================================

describe('engine-db blocked hook', () => {
  it('onEngineDbBlocked listeners fire when an older connection blocks the upgrade', async () => {
    // Hold a connection at v2 (subset of the lineage) WITHOUT a versionchange
    // close handler — the v3 open must fire `blocked`.
    const older = await openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS.slice(0, 2));
    testDbs.push(older);

    const fired: number[] = [];
    const unsubscribe = onEngineDbBlocked(() => fired.push(1));

    await expect(openEngineDb()).rejects.toThrow(/blocked/);
    expect(fired).toHaveLength(1);

    // Unsubscribe shape: the listener does not fire again.
    unsubscribe();
    older.close();
  });
});

// ===========================================================================
// Real hop: baseline
// ===========================================================================

describe('real hop: handshake + baseline', () => {
  it('ping and getVersion survive the real worker hop (contract 2 acked)', async () => {
    const client = makeClient();
    expect(await client.ping('over-the-hop')).toBe('over-the-hop');
    const version = await client.getVersion();
    expect(version.contract).toBe(2);
    expect(typeof version.engine).toBe('string');
  });
});

// ===========================================================================
// Real hop: full session flow (decode → start → apply → windows → next)
// ===========================================================================

describe('real hop: full session flow (mono-like-utf8.csv)', () => {
  it('decode → importStart → applyColumn ×9 → getRows windows → importNext → typed rows; completed next frees the session', { timeout: 20000 }, async () => {
    // The 2.7 gate sets the base currency before any import — mirror that.
    const db = await trackedTestDb();
    await setBaseCurrency(new UserSettingsIDBDAO(() => db), 'UAH');

    const client = makeClient();
    const progressEvents: ProgressEventPayload[] = [];
    client.onEvent((e: EngineEventPayload) => {
      if (e.event === 'progress') progressEvents.push(e);
    });

    // ── decode over the hop ──────────────────────────────────────────────────
    const decodeResult = await client.decode(readFixture('mono-like-utf8.csv'), 'mono-like-utf8.csv');
    expect(decodeResult.rows).toHaveLength(12);
    expect(decodeResult.meta.decodedRows).toBe(12);

    // ── importStart: snapshot DTO shape over the hop ─────────────────────────
    const { sessionId, stage2 } = await client.importStart(decodeResult.rows);
    expect(typeof sessionId).toBe('string');
    expect(stage2.columns).toHaveLength(9);
    expect(stage2.recognized).toEqual({ n: 0, m: 9 }); // empty pool — nothing recognized
    expect(stage2.unmapped).toHaveLength(9);
    expect(stage2.lastSaveCollision).toBeNull();
    // Row economy: sample cells are capped (12 rows but ≤10 sample cells/column)
    for (const col of stage2.columns) {
      expect(col.sampleCells.length).toBeLessThanOrEqual(10);
      expect(col.definition).toBeNull();
      expect(col.recallState).toBeNull();
    }

    // ── apply all 9 mappings (each returns the column-state snapshot) ───────
    const finalSnap = await applyAll(client, sessionId, stage2, MONO_MAPPINGS);
    expect(finalSnap.unmapped).toHaveLength(0);
    const dateCol = findColumn(finalSnap, 'Дата i час операції');
    expect(dateCol.definition).toBe(ColumnDefinition.DATE);

    // ── importGetRows windows (offset/count/total correct) ──────────────────
    const w1 = await client.importGetRows(sessionId, 0, 5);
    expect(w1.offset).toBe(0);
    expect(w1.total).toBe(12);
    expect(w1.rows).toHaveLength(5);
    // dates cross as ISO strings (JSON-safe pin)
    expect(typeof w1.rows[0].date).toBe('string');
    expect(w1.rows[0].date).toMatch(/^2024-01-15T/);
    expect(w1.rows[0].amount).toBe(42);
    expect(w1.rows[0].description).toBe('TEST COFFEE 1');

    const w2 = await client.importGetRows(sessionId, 10, 5);
    expect(w2.offset).toBe(10);
    expect(w2.total).toBe(12);
    expect(w2.rows).toHaveLength(2); // window clamps at the end

    // ── importNext → GenerateResultDTO (typed rows, dates as ISO) ───────────
    const next = await client.importNext(sessionId);
    expect(next.ok).toBe(true);
    if (!next.ok) throw new Error('unreachable');
    expect(next.result.rows).toHaveLength(12);
    expect(next.result.rowErrors).toHaveLength(0);
    expect(next.result.skipped).toHaveLength(0);
    const row0 = next.result.rows[0];
    expect(row0.date).toMatch(/^2024-01-15T/);
    expect(row0.amount).toBe(42);
    expect('time' in row0).toBe(false);
    expect(typeof row0.hash).toBe('string');

    // importNext progress (HC-10): final event reports done === total
    const generateEvents = progressEvents.filter((e) => e.phase === 'generate');
    expect(generateEvents.length).toBeGreaterThanOrEqual(1);
    const lastGen = generateEvents[generateEvents.length - 1];
    expect(lastGen.done).toBe(lastGen.total);
    expect(lastGen.total).toBe(12);

    // ── completed importNext FREES the session (refinement 1) ────────────────
    const dateColId = dateCol.id;
    await expect(
      client.importApplyColumn(sessionId, dateColId, ColumnDefinition.IGNORE, null),
    ).rejects.toThrowError(SessionUnknownError);
  });

  it('recall prefill + N-of-M are visible over the hop (map once → re-importStart prefilled GUESSED)', { timeout: 20000 }, async () => {
    const db = await trackedTestDb();
    await setBaseCurrency(new UserSettingsIDBDAO(() => db), 'UAH');

    const client = makeClient();
    const decodeResult = await client.decode(readFixture('mono-like-utf8.csv'), 'mono-like-utf8.csv');

    // First session: map everything (the learning loop fires savePool per column)
    const first = await client.importStart(decodeResult.rows);
    await applyAll(client, first.sessionId, first.stage2, MONO_MAPPINGS);
    await client.importAbort(first.sessionId);

    // savePool is async fire-and-forget — wait for all 9 entries to land
    await waitForPoolEntries(db, 9);

    // Second session: the pool prefills GUESSED over the hop — N-of-M = 9/9
    const second = await client.importStart(decodeResult.rows);
    expect(second.stage2.recognized).toEqual({ n: 9, m: 9 });
    for (const m of MONO_MAPPINGS) {
      const col = findColumn(second.stage2, m.columnName);
      expect(col.definition).toBe(m.definition);
      expect(col.recallState).toBe('guessed');
    }
  });

  it('bad column → ColumnRejectionDTO over the hop; rehydrates as ColumnTransformRejection with cellErrors intact', { timeout: 20000 }, async () => {
    const client = makeClient();
    const decodeResult = await client.decode(readFixture('bad-dates.csv'), 'bad-dates.csv');
    expect(decodeResult.rows).toHaveLength(12);

    const { sessionId, stage2 } = await client.importStart(decodeResult.rows);
    const dateCol = findColumn(stage2, 'Date');

    // Custom format bypasses detection → 5/12 = 41.7% > 30% → the 2.4 gate bites
    const res = await client.importApplyColumn(sessionId, dateCol.id, ColumnDefinition.DATE, {
      format: { custom: 'yyyy-MM-dd' },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');

    const rejection: ColumnRejectionDTO = res.rejection;
    expect(rejection.errorCount).toBe(5);
    expect(rejection.totalCount).toBe(12);
    expect(rejection.threshold).toBe(0.3);
    expect(rejection.cellErrors).toHaveLength(5);
    expect(rejection.cellErrors.map((c) => c.rowIndex).sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
    // message KEYS survive the wire ($t convention — the UI catalog renders at 2.7/2.8)
    for (const ce of rejection.cellErrors) {
      expect('key' in ce.message && ce.message.key.length > 0).toBe(true);
    }

    // Client-side rehydration: the DTO maps onto the wire-error payload shape
    const rehydrated = rehydrateEngineError({
      name: 'ColumnTransformRejection',
      message: 'rejected',
      payload: rejection,
    });
    expect(rehydrated).toBeInstanceOf(ColumnTransformRejection);
    const typed = rehydrated as ColumnTransformRejection;
    expect(typed.errorCount).toBe(5);
    expect(typed.cellErrors).toHaveLength(5);
    expect(typed.cellErrors[0].error.getText().length).toBeGreaterThan(0);

    // The rejected column stays UNKNOWN — the session is alive (per-COLUMN boundary)
    const reset = await client.importResetColumn(sessionId, dateCol.id);
    expect(findColumn(reset, 'Date').definition).toBeNull();
  });

  it('engine-config over the hop: store override 0.05 set via a direct DAO → the 2.4 gate bites in the worker', { timeout: 20000 }, async () => {
    // Seed the override through a DIRECT test-side connection BEFORE the session
    const db = await trackedTestDb();
    const dao = new UserSettingsIDBDAO(() => db);
    await setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 0.05);

    const client = makeClient();
    const decodeResult = await client.decode(readFixture('bad-dates.csv'), 'bad-dates.csv');
    // stage2() hydrates engine config at session start — IN THE WORKER
    const { sessionId, stage2 } = await client.importStart(decodeResult.rows);

    // Amount column: 1/12 = 8.3% bad — passes the 0.3 default, FAILS the 0.05 override
    const amountCol = findColumn(stage2, 'Amount');
    const res = await client.importApplyColumn(sessionId, amountCol.id, ColumnDefinition.AMOUNT, {
      type: 'outcome',
      currency: { code: 'UAH' },
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.rejection.threshold).toBe(0.05);
    expect(res.rejection.errorCount).toBe(1);
    expect(res.rejection.totalCount).toBe(12);
  });
});

// ===========================================================================
// Session pins (founder refinement 1 — over the real hop)
// ===========================================================================

describe('real hop: session pins', () => {
  it('PIN: double importStart → SessionAlreadyActiveError; abort → importStart works again', { timeout: 20000 }, async () => {
    const client = makeClient();
    const rows = syntheticRows(12);

    const first = await client.importStart(rows);

    let caught: unknown = null;
    try {
      await client.importStart(rows);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SessionAlreadyActiveError);
    expect((caught as SessionAlreadyActiveError).activeSessionId).toBe(first.sessionId);

    // importAbort frees the registry — a new session can start
    await client.importAbort(first.sessionId);
    const second = await client.importStart(rows);
    expect(second.sessionId).not.toBe(first.sessionId);

    // and the aborted session is GONE (registry empty for it)
    const col = second.stage2.columns[0];
    await expect(
      client.importApplyColumn(first.sessionId, col.id, ColumnDefinition.IGNORE, null),
    ).rejects.toThrowError(SessionUnknownError);
  });

  it('PIN: post-respawn old sessionId → SessionUnknownError (terminate → transport respawns → fresh registry)', { timeout: 20000 }, async () => {
    const client = makeClient();
    const deadEvents: EngineEventPayload[] = [];
    client.onEvent((e) => {
      if (e.event === 'dead') deadEvents.push(e);
    });

    const { sessionId, stage2 } = await client.importStart(syntheticRows(12));
    expect(rawWorkers).toHaveLength(1);

    // Kill the worker for real: transport drains (dead event) + worker terminates
    killCurrentWorker();
    expect(deadEvents).toHaveLength(1);

    // Next call lazily respawns (workerFactory invoked again — a NEW module graph,
    // empty session registry). Sessions are NOT resurrected (decision 1).
    let caught: unknown = null;
    try {
      await client.importApplyColumn(sessionId, stage2.columns[0].id, ColumnDefinition.IGNORE, null);
    } catch (e) {
      caught = e;
    }
    expect(rawWorkers).toHaveLength(2); // respawned exactly once
    expect(caught).toBeInstanceOf(SessionUnknownError);
    expect((caught as SessionUnknownError).sessionId).toBe(sessionId);

    // importStart is the only way forward — and it works on the fresh worker
    const fresh = await client.importStart(syntheticRows(12));
    expect(typeof fresh.sessionId).toBe('string');
  });
});

// ===========================================================================
// Row-economy pin (founder refinement 2 — over the real hop)
// ===========================================================================

describe('real hop: row-economy pin', () => {
  it('PIN: applyColumn snapshot byte-size for a 10k-row session is within 2× of a 12-row session (equal column counts)', { timeout: 30000 }, async () => {
    const client = makeClient();

    async function snapshotSizeFor(rowCount: number): Promise<number> {
      const { sessionId, stage2 } = await client.importStart(syntheticRows(rowCount));
      expect(stage2.columns).toHaveLength(3); // equal column counts across sizes
      const nameCol = findColumn(stage2, 'Name');
      const res = await client.importApplyColumn(sessionId, nameCol.id, ColumnDefinition.DESCRIPTION, null);
      if (!res.ok) throw new Error('unexpected rejection');
      const size = JSON.stringify(res.snapshot).length;
      await client.importAbort(sessionId);
      return size;
    }

    const small = await snapshotSizeFor(12);
    const large = await snapshotSizeFor(10_000);

    // applyColumn cost does not scale with total row count on the wire
    expect(large).toBeLessThanOrEqual(small * 2);
  });
});

// ===========================================================================
// Mid-job kill atomicity pin (decision 1 — over the real hop)
// ===========================================================================

describe('real hop: mid-job kill atomicity (decision 1)', () => {
  it('PIN: terminate mid-flight while applyColumn writes recall-pool entries → stored entries are none-or-complete, never partial', { timeout: 20000 }, async () => {
    const client = makeClient();
    const decodeResult = await client.decode(readFixture('mono-like-utf8.csv'), 'mono-like-utf8.csv');
    const { sessionId, stage2 } = await client.importStart(decodeResult.rows);

    // Drive applies that fire async savePool writes, then kill WITHOUT waiting
    // for the writes to settle — the kill lands mid-flight relative to the pool.
    const snap = await applyAll(client, sessionId, stage2, MONO_MAPPINGS.slice(0, 4));
    expect(snap.unmapped.length).toBeLessThan(9);
    killCurrentWorker();

    // Reopen the DB directly and validate EVERY stored pool entry against the
    // full entry shape — IDB transaction atomicity is the guarantee (decision 1).
    const db = await trackedTestDb();
    const entries = (await readPoolEntries(db)) as Array<Record<string, unknown>>;
    const validDefinitions = new Set<string>(Object.values(ColumnDefinition));

    for (const entry of entries) {
      // none-or-complete: every entry that exists is a COMPLETE RecallPoolEntry
      expect(Object.keys(entry).sort()).toEqual(['columnName', 'definition', 'params']);
      expect(typeof entry.columnName).toBe('string');
      expect((entry.columnName as string).length).toBeGreaterThan(0);
      expect(validDefinitions.has(entry.definition as string)).toBe(true);
      expect(entry.params === null || typeof entry.params === 'object').toBe(true);
    }
    // 0..4 entries are all legal outcomes — the pin is about SHAPE, not count
    expect(entries.length).toBeLessThanOrEqual(4);
  });
});

// ===========================================================================
// Progress honesty (HC-10 — over the real hop)
// ===========================================================================

describe('real hop: progress honesty (HC-10)', () => {
  it('10k-row decode emits monotone progress with ≥2 intermediate events and final done === total', { timeout: 30000 }, async () => {
    const client = makeClient();
    const progress: ProgressEventPayload[] = [];
    client.onEvent((e) => {
      if (e.event === 'progress') progress.push(e);
    });

    const result = await client.decode(syntheticCsvBytes(10_000), 'big-synthetic.csv');
    expect(result.rows).toHaveLength(10_000);

    const decodeEvents = progress.filter((e) => e.phase === 'decode');
    // ≥2 intermediate events (done < total) + the final one
    const intermediates = decodeEvents.filter((e) => e.done < e.total);
    expect(intermediates.length).toBeGreaterThanOrEqual(2);

    // Monotone: done never decreases; done ≤ total always
    for (let i = 0; i < decodeEvents.length; i++) {
      expect(decodeEvents[i].done).toBeLessThanOrEqual(decodeEvents[i].total);
      if (i > 0) expect(decodeEvents[i].done).toBeGreaterThanOrEqual(decodeEvents[i - 1].done);
    }

    // Final honest count: done === total
    const last = decodeEvents[decodeEvents.length - 1];
    expect(last.done).toBe(last.total);

    // All events of this job carry ONE jobId (the in-flight request id — the
    // transport's progress-liveness key)
    expect(new Set(decodeEvents.map((e) => e.jobId)).size).toBe(1);
  });
});
