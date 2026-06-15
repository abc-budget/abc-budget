/**
 * INTEGRATION: warmRates (WRITE side) ↔ toAmountUSD / CacheOnlyRatesApi (READ side).
 *
 * Story 3.3 Task 8. The two halves of the reserve-bridge cache were unit-tested in
 * ISOLATION: warmRates seeds via the cached read-through; toAmountUSD's unit test
 * seeds the DAO directly. Neither proves the WRITE key matches the READ key.
 *
 * The silent-break risk is a date-key / timezone MISMATCH between the write side
 * (`CachedExchangeRateApi`, keyed `date.toISOString().split('T')[0]`) and the read
 * side (`CacheOnlyRatesApi`, same UTC key). If they ever diverged, a footprint
 * would fail-loud with `RatesUnavailableError` for a date that was JUST cached.
 *
 * This spec wires the REAL pieces against ONE shared fake-indexeddb DB and a
 * STUBBED `global.fetch` (no network), and proves write-key === read-key END TO
 * END — including under a hostile host TZ (`America/New_York`) at a day/month
 * boundary, where derive's UTC year/month and the rate-cache UTC key must NOT
 * diverge.
 *
 * SHARED-DB WIRING (copied from worker-http-rates-api.spec.ts):
 *   - The WRITE side uses `rates-holder.getCachedRatesApi()`, whose cached api is
 *     built over `openEngineDb()` (the memoized `abc-budget` DB, `exchangeRates`
 *     store at migration v2).
 *   - The READ side uses `new IDBExchangeRateDAO(() => db)` over the SAME `db`
 *     handle returned by `openEngineDb()` — opened ONCE in `beforeAll` and left
 *     open so the holder's memo stays valid. ONE database, two ends.
 *   - `setRemoteRatesApi(new WorkerHttpRatesApi())` wires the holder's remote to
 *     the worker http api; `resetRatesHolderForTests()` clears the memoized cache
 *     between tests so each test re-warms from a clean (fetch-stub-served) cache.
 */
import 'fake-indexeddb/auto';

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { WorkerHttpRatesApi } from '../exchange-rate/worker-http-rates-api';
import {
  setRemoteRatesApi,
  resetRatesHolderForTests,
} from '../exchange-rate/rates-holder';
import { IDBExchangeRateDAO } from '../exchange-rate/dao';
import type { ExchangeRateDAO } from '../exchange-rate/dao';
import { RatesUnavailableError } from '../exchange-rate/cache-only-rates-api';
import { openEngineDb } from '../persistence/engine-db';
import { toAmountUSD } from './footprint-usd';
import { deriveFootprint } from './derive-footprint';
import type { TransactionRow } from '../importStatement/stage3/types';

/** Builds an OK JSON `{ rates }` Response — the shape WorkerHttpRatesApi parses. */
function okRatesResponse(rates: Record<string, number>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ rates }),
  } as unknown as Response;
}

/** Realistic USD-base map: UNITS-PER-USD (1 USD = 41 UAH = 0.92 EUR). */
const USD_BASE_MAP = { UAH: 41, EUR: 0.92 };

/** Minimal TransactionRow carrying the operation date + hash for deriveFootprint. */
function rowWith(date: Date): TransactionRow {
  return {
    rowIndex: 0,
    hash: 'seam-hash',
    source: null,
    date,
    amount: 100,
    currency: 'UAH',
    description: null,
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: null,
    isBankCommission: false,
    isCashback: false,
    category: null,
    isManuallySetCategory: false,
  };
}

describe('warm↔convert seam (write-key === read-key, ONE shared DB)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let db: IDBDatabase;
  let dao: ExchangeRateDAO;

  // openEngineDb is memoized; open ONCE so the holder's cached writer and the
  // read DAO share the identical IDBDatabase, and the memo stays valid across tests.
  beforeAll(async () => {
    db = await openEngineDb();
    dao = new IDBExchangeRateDAO(() => db);
  });

  afterAll(() => {
    resetRatesHolderForTests();
  });

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => okRatesResponse(USD_BASE_MAP));
    vi.stubGlobal('fetch', fetchMock);
    // Clean memoized cache so each test re-warms from the fetch stub (not a prior test's rows).
    resetRatesHolderForTests();
    setRemoteRatesApi(new WorkerHttpRatesApi());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('SEAM (positive): warmRates then toAmountUSD hits the cache — read NEVER re-fetches', async () => {
    // Use a date string nothing else in this describe warms, to isolate the fetch count.
    const opDate = new Date('2026-06-10T09:00:00Z');
    const api = new WorkerHttpRatesApi();

    // WRITE side: warm seeds the cache via the holder's CachedExchangeRateApi.
    await api.warmRates([opDate]);

    // Exactly one fetch so far — warm's single read-through miss.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // READ side: SAME opDate, over a DAO on the SAME db. Must hit the warmed row.
    const usd = await expect(
      toAmountUSD(100, 'UAH', opDate, dao)
    ).resolves.toBeCloseTo(2.439, 3); // 100 / 41 (UNITS-PER-USD divide direction)
    void usd;

    // The read hit the cache that warm wrote → still EXACTLY ONE fetch total.
    // (A second fetch here would prove a write-key/read-key MISMATCH.)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('NEGATIVE CONTROL: an UNWARMED date REJECTS with RatesUnavailableError', async () => {
    // No warmRates for this date → the read MUST fail loud, proving the positive
    // hit above is a real cache hit and not an always-pass.
    const unwarmed = new Date('2026-07-15T09:00:00Z');

    await expect(
      toAmountUSD(100, 'UAH', unwarmed, dao)
    ).rejects.toBeInstanceOf(RatesUnavailableError);
  });
});

/**
 * HOSTILE-TZ boundary variant — ISOLATED describe with strict TZ save/restore.
 *
 * Host TZ is America/New_York (UTC-5 in winter). The operation instant
 * 2026-03-01T02:00:00Z is Feb 28 21:00 LOCAL — a day AND month boundary between
 * local and UTC. deriveFootprint MUST use the UTC calendar date (year 2026,
 * month 3) and the rate cache MUST key on the SAME UTC day, so a warm of this
 * instant is hit by a read of the same instant. If derive used local accessors,
 * its year/month (Feb 2026) would diverge from the UTC rate-cache key (Mar 2026)
 * — the exact desync this variant rules out.
 */
describe('warm↔convert seam — hostile-TZ day/month boundary (UTC key cannot diverge)', () => {
  let originalTZ: string | undefined;
  let fetchMock: ReturnType<typeof vi.fn>;
  let db: IDBDatabase;
  let dao: ExchangeRateDAO;

  beforeAll(async () => {
    originalTZ = process.env['TZ'];
    process.env['TZ'] = 'America/New_York';
    db = await openEngineDb();
    dao = new IDBExchangeRateDAO(() => db);
  });

  afterAll(() => {
    resetRatesHolderForTests();
    // Restore TZ — must NOT bleed into any other spec.
    if (originalTZ === undefined) {
      delete process.env['TZ'];
    } else {
      process.env['TZ'] = originalTZ;
    }
  });

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => okRatesResponse(USD_BASE_MAP));
    vi.stubGlobal('fetch', fetchMock);
    resetRatesHolderForTests();
    setRemoteRatesApi(new WorkerHttpRatesApi());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derive lands UTC year=2026/month=3 AND the same-instant read HITS the warmed cache', async () => {
    // Feb 28 21:00 LOCAL (America/New_York) = Mar 1 02:00 UTC.
    const opDate = new Date('2026-03-01T02:00:00Z');
    const api = new WorkerHttpRatesApi();

    // WRITE: warm the rate cache for this instant.
    await api.warmRates([opDate]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // (a) derive uses the UTC calendar date — March 2026, NOT local February.
    const footprint = deriveFootprint(rowWith(opDate), 7.77);
    expect(footprint.year).toBe(2026);
    expect(footprint.month).toBe(3);

    // (b) the rate read keys on the SAME UTC day → HIT, no RatesUnavailableError.
    await expect(
      toAmountUSD(100, 'UAH', opDate, dao)
    ).resolves.toBeCloseTo(2.439, 3);

    // Read served from the warmed row → still exactly one fetch (derive's UTC
    // calendar date and the rate-cache key provably did NOT diverge across the TZ boundary).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('TZ is America/New_York within this spec (sanity)', () => {
    expect(process.env['TZ']).toBe('America/New_York');
  });
});
