/**
 * importNext → bulk rate-warm trigger end-to-end spec — Story 5.2, Task 4 (EP-5).
 *
 * Drives `client.importNext(sessionId)` over a REAL `createDirectEngineClient`
 * backed by fake-indexeddb (the same object the worker host shims over), with a
 * fake `ExchangeRateApi` injected through `EngineInitOptions.exchangeRateApi`
 * (which the composition root forwards into `setRemoteRatesApi`). The fake's
 * `bulkGetExchangeRates` returns the op-dates' USD tables, so the S3b→S3c warm
 * trigger populates the SAME IDB cache the commit's cache-only convert reads.
 *
 * Exercises:
 *   (a) importNext fires `bulkWarmRates` with the rows' distinct op-dates,
 *       FIRE-AND-FORGET — importNext resolves WITHOUT awaiting the warm (asserted
 *       by spying the fake `bulkGetExchangeRates`).
 *   (b) COLD cache → importNext warm → after the warm settles, the IDB cache has
 *       the op-date USD tables → `importCommit` (5.1) resolves WITHOUT
 *       RatesUnavailableError (the footprints' amountUSD set).
 *   (c) A warm FAILURE (fake `bulkGetExchangeRates` throws — CF down/not deployed)
 *       → importNext STILL resolves ok (the `.catch` swallows); a later
 *       `importCommit` on an uncached date → RatesUnavailableError (loud gate holds).
 *
 * Mirrors import-commit.spec.ts (the composed direct-client + fake-indexeddb
 * harness): a minimal two-column (DATE + AMOUNT/UAH) import over two synthetic
 * rows on distinct op dates; base currency = 'UAH'; the commit needs USD→UAH per
 * op date, so the fake's USD tables carry `UAH`.
 */
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDirectEngineClient } from './direct-client';
import type { EngineClient } from './engine-client';
import type { ExchangeRateApi } from '../internal/exchange-rate/api';
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
import { resetRatesHolderForTests } from '../internal/exchange-rate/rates-holder';
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

/** USD→UAH rate per op date (the fake's bulk tables); identity-ish values keep the math simple. */
const USD_UAH: Record<string, number> = {
  [dateKey(DAY_A)]: 40,
  [dateKey(DAY_B)]: 41,
};

/**
 * Minimal raw rows for importStart: two UAH rows on distinct op dates.
 */
const RAW_ROWS: Record<string, unknown>[] = [
  { Date: dateKey(DAY_A), Amount: '-100.00', Desc: 'test-a' },
  { Date: dateKey(DAY_B), Amount: '-200.00', Desc: 'test-b' },
];

// ── Fake remote ExchangeRateApi ─────────────────────────────────────────────────

/**
 * Build a fake `ExchangeRateApi` whose `bulkGetExchangeRates` returns the
 * requested dates' USD tables (carrying UAH). `bulk` is a vi spy so the test can
 * assert it was invoked (fire-and-forget evidence) and with which dates.
 *
 * @param opts.throwOnBulk - when true the bulk method REJECTS (CF down / 404),
 *   exercising the swallowed-rejection path.
 * @param opts.omitDates - yyyy-MM-dd keys to OMIT from the returned tables (a
 *   cap-cut/failed date → cache gap → the commit's loud gate).
 */
function makeFakeApi(opts?: { throwOnBulk?: boolean; omitDates?: string[] }): {
  api: ExchangeRateApi;
  bulk: ReturnType<typeof vi.fn>;
} {
  const omit = new Set(opts?.omitDates ?? []);
  const bulk = vi.fn(
    async (
      _base: string,
      dates: Date[],
    ): Promise<Record<string, Record<string, number>>> => {
      if (opts?.throwOnBulk) {
        throw new Error('CF getUSDRatesBulk not deployed (simulated 404)');
      }
      const out: Record<string, Record<string, number>> = {};
      for (const d of dates) {
        const key = dateKey(d);
        if (omit.has(key)) continue;
        const uah = USD_UAH[key];
        if (uah !== undefined) {
          out[key] = { UAH: uah };
        }
      }
      return out;
    },
  );
  const api: ExchangeRateApi = {
    // The single-date path is unused in these tests (warm uses bulk; commit reads
    // cache-only). Keep it loud so an unexpected single-date remote hit surfaces.
    async getExchangeRate(): Promise<Record<string, number>> {
      throw new Error('single-date getExchangeRate not expected in warm e2e');
    },
    bulkGetExchangeRates: bulk as unknown as ExchangeRateApi['bulkGetExchangeRates'],
  };
  return { api, bulk };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract original-name text from a Stage2ColumnDTO. */
function nameOf(col: Stage2ColumnDTO): string {
  return 'text' in col.originalName ? col.originalName.text : col.originalName.key;
}

/** Apply Date → DATE, Amount → AMOUNT(UAH), Desc → DESCRIPTION onto the session. */
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

/**
 * Drive importStart → mappings → importNext over `client`. Returns the sessionId
 * AND the importNext result (so the caller can assert ok without awaiting warm).
 */
async function startAndAdvance(client: EngineClient): Promise<string> {
  await client.setBaseCurrency('UAH');
  const { sessionId, stage2 } = await client.importStart(RAW_ROWS);
  await applyMinimalMappings(client, sessionId, stage2);
  const nextRes = await client.importNext(sessionId);
  if (!nextRes.ok) {
    throw new Error(`importNext failed: ${JSON.stringify(nextRes.unmapped)}`);
  }
  return sessionId;
}

/** Spin a microtask flush so a fire-and-forget warm chain settles before asserting. */
async function settle(): Promise<void> {
  // The warm chain awaits openEngineDb + the fake bulk + the DAO upserts — a few
  // promise hops. Await several macro/microtask turns to let it run to completion.
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
}

// ── Test infrastructure ───────────────────────────────────────────────────────

let testDbs: IDBDatabase[] = [];

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  resetEngineConfigForTests();
  resetRatesHolderForTests();
  testDbs = [];
});

afterEach(() => {
  for (const db of testDbs) {
    try { db.close(); } catch { /* already closed */ }
  }
  testDbs = [];
});

// ── importNext warm trigger ─────────────────────────────────────────────────────

describe('importNext bulk rate-warm trigger (Story 5.2 Task 4 — EP-5)', () => {
  it('fires bulkWarmRates with the rows op-dates, FIRE-AND-FORGET (spy invoked; importNext resolves)', async () => {
    const { api, bulk } = makeFakeApi();
    const client = createDirectEngineClient({ exchangeRateApi: api });

    // importNext resolves WITHOUT awaiting the warm — but the warm IS triggered.
    await startAndAdvance(client);

    // Let the fire-and-forget warm chain reach the fake bulk call.
    await settle();

    expect(bulk).toHaveBeenCalledTimes(1);
    const [, datesArg] = bulk.mock.calls[0] as [string, Date[]];
    const calledKeys = (datesArg as Date[]).map(dateKey).sort();
    expect(calledKeys).toEqual([dateKey(DAY_A), dateKey(DAY_B)].sort());
  });

  it('COLD cache → importNext warm → importCommit reads warm (no RatesUnavailableError; amountUSD set)', async () => {
    const { api } = makeFakeApi();
    const client = createDirectEngineClient({ exchangeRateApi: api });

    const sessionId = await startAndAdvance(client);

    // COLD: nothing seeded into the cache by the test. The ONLY source of the
    // op-date USD tables is the importNext warm trigger. Await it settling.
    await settle();

    // The warm populated the IDB cache → cache-only commit succeeds (loud gate clears).
    const res = await client.importCommit(sessionId);
    expect(res.rowsCommitted).toBe(RAW_ROWS.length);

    // Footprints persisted with a numeric amountUSD (the warm-read convert ran).
    const db = await openTestDb();
    testDbs.push(db);
    const footprintDao = new FootprintDao(() => db);
    const fps = await footprintDao.getAll();
    expect(fps).toHaveLength(RAW_ROWS.length);
    for (const fp of fps) {
      expect(typeof fp.amountUSD).toBe('number');
    }

    // Cross-check: the warm wrote-through the op-date tables to the SAME cache the
    // commit read (write-key === read-key).
    const ratesDao = new IDBExchangeRateDAO(() => db);
    expect(await ratesDao.findByBaseCurrencyAndDate('USD', dateKey(DAY_A))).toMatchObject({ UAH: 40 });
    expect(await ratesDao.findByBaseCurrencyAndDate('USD', dateKey(DAY_B))).toMatchObject({ UAH: 41 });
  });

  it('a warm FAILURE (CF down) is swallowed — importNext resolves ok; a later commit on an uncached date loud-gates', async () => {
    const { api, bulk } = makeFakeApi({ throwOnBulk: true });
    const client = createDirectEngineClient({ exchangeRateApi: api });

    // importNext STILL resolves ok even though the warm rejects (the `.catch`
    // swallows — no unhandled rejection, no thrown importNext).
    const sessionId = await startAndAdvance(client);
    await settle();
    expect(bulk).toHaveBeenCalled(); // the warm WAS attempted and threw

    // The cache is empty (warm failed) → the commit's cache-only loud gate fires.
    await expect(client.importCommit(sessionId)).rejects.toBeInstanceOf(RatesUnavailableError);
  });
});
