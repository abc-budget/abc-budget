/**
 * Tests for WorkerHttpRatesApi — the worker-side remote rates source.
 *
 * Pins (Story 3.3, Task 5):
 *   1. Request parity with the app HttpRatesApi: POST /api/rates with JSON { date: 'yyyy-MM-dd' }.
 *   2. Non-OK response THROWS (fail-loud, HC-7 — never returns empty/zero).
 *   3. Network rejection THROWS (propagated loudly).
 *   4. warmRates([d1, d1, d2]) fetches ONCE per DISTINCT date and leaves both USD
 *      rate rows in the IDB cache (real DAO over fake-indexeddb, the cached read-through).
 *   5. Warming an already-cached date does NOT re-fetch (idempotent).
 *
 * warmRates writes through the SAME CachedExchangeRateApi the convert-time service reads
 * through (rates-holder.getCachedRatesApi) — so write-key === read-key by construction.
 */
import 'fake-indexeddb/auto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerHttpRatesApi } from './worker-http-rates-api';
import { setRemoteRatesApi, resetRatesHolderForTests } from './rates-holder';
import { IDBExchangeRateDAO } from './dao';
import { openEngineDb } from '../persistence/engine-db';

/** Builds a fetch stub that returns an OK JSON { rates } response. */
function okRatesResponse(rates: Record<string, number>): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ rates }),
  } as unknown as Response;
}

describe('WorkerHttpRatesApi — getExchangeRate (request parity + fail-loud)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('issues POST /api/rates with JSON { date: "yyyy-MM-dd" } — parity with app HttpRatesApi', async () => {
    fetchMock.mockResolvedValue(okRatesResponse({ EUR: 0.92, UAH: 41 }));
    const api = new WorkerHttpRatesApi();

    const rates = await api.getExchangeRate('USD', new Date('2026-06-01T12:00:00Z'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/rates');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ date: '2026-06-01' });
    expect(rates).toEqual({ EUR: 0.92, UAH: 41 });
  });

  it('THROWS on a non-OK response (fail-loud, HC-7 — never returns empty)', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    } as unknown as Response);
    const api = new WorkerHttpRatesApi();

    await expect(
      api.getExchangeRate('USD', new Date('2026-06-01'))
    ).rejects.toThrow(/503/);
  });

  it('THROWS on a network rejection (propagated loudly)', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const api = new WorkerHttpRatesApi();

    await expect(
      api.getExchangeRate('USD', new Date('2026-06-01'))
    ).rejects.toThrow(/Failed to fetch/);
  });
});

describe('WorkerHttpRatesApi — warmRates (distinct-date prefetch + idempotency)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let db: IDBDatabase;

  // The shared engine DB is memoized (openEngineDb) and the holder's cached api reads
  // through it — open it ONCE and leave it open so the memo stays valid across tests.
  beforeAll(async () => {
    db = await openEngineDb();
  });

  afterAll(() => {
    resetRatesHolderForTests();
  });

  beforeEach(() => {
    fetchMock = vi.fn().mockImplementation(async () => okRatesResponse({ UAH: 41, EUR: 0.92 }));
    vi.stubGlobal('fetch', fetchMock);
    resetRatesHolderForTests();
    // The worker-side remote IS the WorkerHttpRatesApi; wire it as the holder's remote
    // so the cached read-through warmRates drives is the one convert-time reads.
    setRemoteRatesApi(new WorkerHttpRatesApi());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches ONCE per DISTINCT date and leaves both USD rows in the cache', async () => {
    const d1 = new Date('2026-06-01T08:00:00Z');
    const d1Dup = new Date('2026-06-01T20:00:00Z'); // same yyyy-MM-dd as d1
    const d2 = new Date('2026-06-02T08:00:00Z');

    const api = new WorkerHttpRatesApi();
    await api.warmRates([d1, d1Dup, d2]);

    // Two DISTINCT date strings → exactly two fetches.
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Both USD rows are present in the IDB cache under the operation-date key.
    const dao = new IDBExchangeRateDAO(() => db);
    const row1 = await dao.findByBaseCurrencyAndDate('USD', '2026-06-01');
    const row2 = await dao.findByBaseCurrencyAndDate('USD', '2026-06-02');
    expect(row1).not.toBeNull();
    expect(row1?.['UAH']).toBe(41);
    expect(row2).not.toBeNull();
    expect(row2?.['UAH']).toBe(41);
  });

  it('is idempotent — warming an already-cached date does NOT re-fetch', async () => {
    const d = new Date('2026-06-03T08:00:00Z');
    const api = new WorkerHttpRatesApi();

    await api.warmRates([d]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second warm of the same date — served from cache, no second fetch.
    await api.warmRates([d]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('WorkerHttpRatesApi — bulkGetExchangeRates (Story 5.2: ONE bulk CF call)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bulkGetExchangeRates POSTs { dates } and returns the merged rates map', async () => {
    const body = { rates: { '2024-01-01': { USD: 1, EUR: 0.8 }, '2024-01-02': { USD: 1, EUR: 0.9 } } };
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
    const api = new WorkerHttpRatesApi();
    const out = await api.bulkGetExchangeRates('USD', [new Date('2024-01-01T00:00:00Z'), new Date('2024-01-02T00:00:00Z')]);
    expect(out).toEqual(body.rates);
    const sent = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(sent.dates.sort()).toEqual(['2024-01-01', '2024-01-02']);
  });

  it('THROWS on a non-OK bulk response (fail-loud)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 500 }));
    const api = new WorkerHttpRatesApi();
    await expect(api.bulkGetExchangeRates('USD', [new Date('2024-01-01T00:00:00Z')])).rejects.toThrow(/500/);
  });
});
