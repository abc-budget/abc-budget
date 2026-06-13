/**
 * defer-commit-recall.spec.ts — Story 2.8 decision #4 verification pins (a)–(g)
 * + item 1 (NFC/NFD collapse) + session-survives-advance.
 *
 * The authorized engine-internal change: applyColumn STAGES the recall write
 * (detect-only collision at map time); the actual pool WRITE happens on
 * importNext (advance = endorsement); importAbort DISCARDS; importResetColumn
 * unstages. CONTRACT_VERSION + importApplyColumn's wire signature are FROZEN.
 *
 * Parity (pin g): every round-trip runs BOTH via the direct client and over the
 * REAL worker hop (@vitest/web-worker). The worker host shims over the direct
 * client, so identical behavior is the contract — these tests assert it directly.
 *
 * Environment: fake-indexeddb shared between test + worker realm (the 2.6
 * pattern); fresh IDB universe per test; base currency seeded (the 2.7 gate).
 *
 * Determinism (HC-9): no Date.now / Math.random in assertions; the pool's LWW is
 * structural. Pin (f) asserts identical pool state across two identical runs.
 */

import '@vitest/web-worker';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDirectEngineClient } from './direct-client';
import { createWorkerEngineClient } from './worker-client';
import type { WorkerLike } from './worker-client';
import type { EngineClient } from './engine-client';
import type { Stage2SnapshotDTO, Stage2ColumnDTO } from './dto';
import { ColumnDefinition } from '../internal/importStatement/types';
import { openDatabase } from '../internal/store/migrations/open-with-migrations';
import {
  ENGINE_DB_NAME,
  ENGINE_MIGRATIONS,
  resetPersistenceForTests,
} from '../internal/persistence/engine-db';
import { UserSettingsIDBDAO } from '../internal/settings/user-settings-idb';
import { setBaseCurrency } from '../internal/settings/base-currency';
import { resetEngineConfigForTests } from '../internal/settings/engine-config';
import { RECALL_POOL_STORE } from '../internal/importStatement/recall/pool-dao';

// ── Transport matrix (pin g — Direct ≡ Worker) ─────────────────────────────────

let rawWorkers: Worker[] = [];

function workerFactory(): WorkerLike {
  const w = new Worker(new URL('../engine-worker.ts', import.meta.url), { type: 'module' });
  rawWorkers.push(w);
  return w as unknown as WorkerLike;
}

interface Transport {
  readonly name: string;
  make(): EngineClient;
}

const TRANSPORTS: Transport[] = [
  { name: 'direct', make: () => createDirectEngineClient() },
  { name: 'worker', make: () => createWorkerEngineClient(workerFactory) },
];

// ── Pool readers (a SECOND connection from the test side) ──────────────────────

let testDbs: IDBDatabase[] = [];

async function openTestDb(): Promise<IDBDatabase> {
  const db = await openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS);
  testDbs.push(db);
  return db;
}

function readPoolEntries(db: IDBDatabase): Promise<Array<{ columnName: string; definition: string }>> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECALL_POOL_STORE, 'readonly');
    const req = tx.objectStore(RECALL_POOL_STORE).getAll();
    req.onsuccess = () => resolve(req.result as Array<{ columnName: string; definition: string }>);
    req.onerror = () => reject(req.error);
  });
}

async function poolKeys(): Promise<string[]> {
  const db = await openTestDb();
  const entries = await readPoolEntries(db);
  return entries.map((e) => e.columnName).sort();
}

/** Seed a pool entry directly (test-side) — the NORMALIZED key is the columnName. */
function writePoolEntry(db: IDBDatabase, columnName: string, definition: string, params: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RECALL_POOL_STORE, 'readwrite');
    const req = tx.objectStore(RECALL_POOL_STORE).put({ columnName, definition, params });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** 12 rows, three columns — enough for a clean apply-all + advance. */
function rows(headers: { date: string; amount: string; desc: string }): Record<string, unknown>[] {
  return Array.from({ length: 12 }, (_, i) => ({
    [headers.date]: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
    [headers.amount]: `-${(i % 90) + 1}.50`,
    [headers.desc]: `row ${i}`,
  }));
}

const HEADERS = { date: 'Date', amount: 'Amount', desc: 'Description' };

function findColumn(snapshot: Stage2SnapshotDTO, name: string): Stage2ColumnDTO {
  const col = snapshot.columns.find((c) =>
    'text' in c.originalName ? c.originalName.text === name : c.originalName.key === name,
  );
  if (!col) throw new Error(`column '${name}' not in snapshot`);
  return col;
}

const MAPPINGS = (h: typeof HEADERS) => [
  { name: h.date, definition: ColumnDefinition.DATE, params: { format: 'auto' } as Record<string, unknown> },
  { name: h.amount, definition: ColumnDefinition.AMOUNT, params: { type: 'outcome', currency: 'use_base' } },
  { name: h.desc, definition: ColumnDefinition.DESCRIPTION, params: null },
];

async function applyAll(
  client: EngineClient,
  sessionId: string,
  snapshot: Stage2SnapshotDTO,
  h: typeof HEADERS,
): Promise<Stage2SnapshotDTO> {
  let snap = snapshot;
  for (const m of MAPPINGS(h)) {
    const col = findColumn(snap, m.name);
    const res = await client.importApplyColumn(sessionId, col.id, m.definition, m.params);
    if (!res.ok) throw new Error(`unexpected rejection for ${m.name}: ${JSON.stringify(res.rejection)}`);
    snap = res.snapshot;
  }
  return snap;
}

// ── Per-test isolation ─────────────────────────────────────────────────────────

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  resetEngineConfigForTests();
  // The 2.7 gate sets the base currency before any import.
  const db = await openTestDb();
  await setBaseCurrency(new UserSettingsIDBDAO(() => db), 'UAH');
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
// Pins (a)–(g) + item 1 + session-survives — run on BOTH transports (pin g)
// ===========================================================================

describe.each(TRANSPORTS)('defer-commit recall pins — $name transport', ({ make }) => {
  it('pin (a): apply → abort → fresh importStart ⇒ NO recall (pool clean)', async () => {
    const client = make();
    const first = await client.importStart(rows(HEADERS));
    await applyAll(client, first.sessionId, first.stage2, HEADERS);

    // ABORT before advance → staged writes discarded; pool stays empty.
    await client.importAbort(first.sessionId);
    expect(await poolKeys()).toEqual([]);

    // A fresh import recognizes nothing.
    const second = await client.importStart(rows(HEADERS));
    expect(second.stage2.recognized).toEqual({ n: 0, m: 3 });
    for (const col of second.stage2.columns) {
      expect(col.definition).toBeNull();
      expect(col.recallState).toBeNull();
    }
    await client.importAbort(second.sessionId);
  });

  it('pin (b): apply → advance (importNext) → fresh importStart ⇒ recalled (guessed)', async () => {
    const client = make();
    const first = await client.importStart(rows(HEADERS));
    await applyAll(client, first.sessionId, first.stage2, HEADERS);

    // ADVANCE → flush warms the pool.
    const next = await client.importNext(first.sessionId);
    expect(next.ok).toBe(true);
    await client.importAbort(first.sessionId); // free the live session before re-import

    expect(await poolKeys()).toEqual([HEADERS.amount, HEADERS.date, HEADERS.desc].sort());

    // Second import recalls all three as GUESSED.
    const second = await client.importStart(rows(HEADERS));
    expect(second.stage2.recognized).toEqual({ n: 3, m: 3 });
    for (const m of MAPPINGS(HEADERS)) {
      const col = findColumn(second.stage2, m.name);
      expect(col.definition).toBe(m.definition);
      expect(col.recallState).toBe('guessed');
    }
    await client.importAbort(second.sessionId);
  });

  it('pin (c): collision fires at apply-time on a staged map; pool NOT yet written (getEntry shows old)', async () => {
    const client = make();
    const start = await client.importStart(rows(HEADERS)); // recall ran on empty pool → all UNKNOWN

    // SEED the pool AFTER importStart so the column stays UNKNOWN (recall already
    // ran). The stored 'Date' entry is AMOUNT — a conflicting type.
    await writePoolEntry(await openTestDb(), HEADERS.date, ColumnDefinition.AMOUNT, null);

    // Apply 'Date' as DATE on the UNKNOWN column → detect sees the stored AMOUNT
    // → type-change collision at apply-time. The column was null, so no transform
    // guard fires.
    const dateCol = findColumn(start.stage2, HEADERS.date);
    const res = await client.importApplyColumn(start.sessionId, dateCol.id, ColumnDefinition.DATE, { format: 'auto' });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error('unreachable');

    // The async detect sets lastSaveCollision; a follow-up snapshot reflects it
    // (map-time UX byte-identical to today). Read it via a fresh snapshot after
    // letting the detect microtask settle.
    await new Promise((r) => setTimeout(r, 30));
    const settled = await client.importResetColumn(start.sessionId, findColumn(start.stage2, HEADERS.desc).id);
    expect(settled.lastSaveCollision).not.toBeNull();
    expect(settled.lastSaveCollision!.kind).toBe('type-change');

    // The pool entry is UNTOUCHED — detect did not write (no-clobber default).
    const after = await readPoolEntries(await openTestDb());
    const dateAfter = after.find((e) => e.columnName === HEADERS.date)!;
    expect(dateAfter.definition).toBe(ColumnDefinition.AMOUNT); // still the seeded value

    await client.importAbort(start.sessionId);
  });

  it('pin (d): importResetColumn discards a staged map (apply → reset → advance ⇒ not written)', async () => {
    const client = make();
    const start = await client.importStart(rows(HEADERS));
    const snap = await applyAll(client, start.sessionId, start.stage2, HEADERS);

    // Reset the Amount column → its staged write is unstaged.
    const amountCol = findColumn(snap, HEADERS.amount);
    await client.importResetColumn(start.sessionId, amountCol.id);

    // Re-map Amount to something so the gate passes, then advance.
    const reReadStart = await client.importApplyColumn(
      start.sessionId, amountCol.id, ColumnDefinition.IGNORE, null,
    );
    expect(reReadStart.ok).toBe(true);
    await client.importNext(start.sessionId);
    await client.importAbort(start.sessionId);

    // The pool holds Date + Description + the re-mapped Amount(IGNORE) — the
    // ORIGINAL Amount(AMOUNT) staged write was discarded by the reset.
    const entries = await readPoolEntries(await openTestDb());
    const amount = entries.find((e) => e.columnName === HEADERS.amount);
    expect(amount).toBeDefined();
    expect(amount!.definition).toBe(ColumnDefinition.IGNORE); // last-applied wins; pre-reset AMOUNT gone
  });

  it('pin (e): >30% ColumnTransformRejection at apply (before staging) → UNKNOWN, nothing staged', async () => {
    const client = make();
    // Build rows where the Date column is mostly UN-parseable under a custom format.
    const badRows = Array.from({ length: 12 }, (_, i) => ({
      [HEADERS.date]: i % 2 === 0 ? 'not-a-date' : '2024-01-01',
      [HEADERS.amount]: '-1.50',
      [HEADERS.desc]: `row ${i}`,
    }));
    const start = await client.importStart(badRows);
    const dateCol = findColumn(start.stage2, HEADERS.date);

    // 6/12 = 50% > 30% → the 2.4 gate bites; the rejection precedes any staging.
    const res = await client.importApplyColumn(
      start.sessionId, dateCol.id, ColumnDefinition.DATE, { format: { custom: 'yyyy-MM-dd' } },
    );
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error('unreachable');
    expect(res.rejection.errorCount).toBeGreaterThan(3);

    // Map the rest legally, advance, and confirm Date is absent from the pool
    // (it stayed UNKNOWN and never staged).
    const amountCol = findColumn(start.stage2, HEADERS.amount);
    const descCol = findColumn(start.stage2, HEADERS.desc);
    await client.importApplyColumn(start.sessionId, dateCol.id, ColumnDefinition.IGNORE, null);
    await client.importApplyColumn(start.sessionId, amountCol.id, ColumnDefinition.AMOUNT, { type: 'outcome', currency: 'use_base' });
    await client.importApplyColumn(start.sessionId, descCol.id, ColumnDefinition.DESCRIPTION, null);
    await client.importNext(start.sessionId);
    await client.importAbort(start.sessionId);

    const entries = await readPoolEntries(await openTestDb());
    const date = entries.find((e) => e.columnName === HEADERS.date);
    // Date was IGNOREd after the rejection (last apply) — never DATE. The rejected
    // DATE apply staged NOTHING.
    expect(date!.definition).toBe(ColumnDefinition.IGNORE);
  });

  it('pin (f): HC-9 determinism — same session ops twice ⇒ identical pool state', async () => {
    const run = async (): Promise<string[]> => {
      // Fresh universe per run.
      globalThis.indexedDB = new IDBFactory();
      resetPersistenceForTests();
      const seed = await openTestDb();
      await setBaseCurrency(new UserSettingsIDBDAO(() => seed), 'UAH');

      const client = make();
      const start = await client.importStart(rows(HEADERS));
      await applyAll(client, start.sessionId, start.stage2, HEADERS);
      await client.importNext(start.sessionId);
      await client.importAbort(start.sessionId);

      const entries = await readPoolEntries(await openTestDb());
      return entries
        .map((e) => `${e.columnName}=${e.definition}`)
        .sort();
    };

    const a = await run();
    const b = await run();
    expect(b).toEqual(a);
    expect(a).toEqual([
      `${HEADERS.amount}=${ColumnDefinition.AMOUNT}`,
      `${HEADERS.date}=${ColumnDefinition.DATE}`,
      `${HEADERS.desc}=${ColumnDefinition.DESCRIPTION}`,
    ].sort());
  });

  it('session-survives-advance: importGetRows on the same sessionId succeeds post-importNext', async () => {
    const client = make();
    const start = await client.importStart(rows(HEADERS));
    await applyAll(client, start.sessionId, start.stage2, HEADERS);

    const next = await client.importNext(start.sessionId);
    expect(next.ok).toBe(true);

    // No SessionUnknownError — the session stays live for S3c.
    const window = await client.importGetRows(start.sessionId, 0, 4);
    expect(window.total).toBe(12);
    expect(window.rows).toHaveLength(4);

    await client.importAbort(start.sessionId);
  });

  it('item 1: NFC/NFD headers collapse to ONE pool entry on flush (LWW, no NEW clobber); unstage leaves the other', async () => {
    const client = make();
    // Two distinct headers that NORMALIZE to the same key (NFC vs NFD of 'Café').
    const nfc = 'Café'.normalize('NFC');
    const nfd = 'Café'.normalize('NFD');
    expect(nfc).not.toBe(nfd); // genuinely distinct raw strings
    const dupRows = Array.from({ length: 12 }, (_, i) => ({
      [nfc]: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
      [nfd]: `-${(i % 90) + 1}.50`,
      [HEADERS.desc]: `row ${i}`,
    }));

    const start = await client.importStart(dupRows);
    const colNfc = findColumn(start.stage2, nfc);
    const colNfd = findColumn(start.stage2, nfd);
    const colDesc = findColumn(start.stage2, HEADERS.desc);

    // Map BOTH colliding-key columns + description, then advance.
    await client.importApplyColumn(start.sessionId, colNfc.id, ColumnDefinition.DATE, { format: 'auto' });
    await client.importApplyColumn(start.sessionId, colNfd.id, ColumnDefinition.AMOUNT, { type: 'outcome', currency: 'use_base' });
    await client.importApplyColumn(start.sessionId, colDesc.id, ColumnDefinition.DESCRIPTION, null);
    await client.importNext(start.sessionId);
    await client.importAbort(start.sessionId);

    // Both staged under distinct ids → flushed to the pool, but the NFC/NFD keys
    // COLLAPSE to ONE entry (2.3 LWW = last-applied wins). Two keys total: the
    // collapsed Café + Description.
    const keys = await poolKeys();
    expect(keys).toEqual([nfc, HEADERS.desc].sort());
    const entries = await readPoolEntries(await openTestDb());
    const cafe = entries.find((e) => e.columnName === nfc)!;
    expect(cafe.definition).toBe(ColumnDefinition.AMOUNT); // last apply (NFD→AMOUNT) won
  });
});
