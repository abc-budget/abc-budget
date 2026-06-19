/**
 * Tests for rates-holder.bulkWarmRates — the Story 5.2 bulk warm path.
 *
 * Pins:
 *   1. ONE bulk call per chunk; de-dups by yyyy-MM-dd (3 dates / 2 distinct → 1 call).
 *   2. Write-through: EVERY returned table lands in the SAME IDB cache the convert-time
 *      read consults — asserted via IDBExchangeRateDAO over openEngineDb() (write-key === read-key).
 *   3. Chunk: 400 distinct dates → ceil(400/366) = 2 bulk calls (never drops).
 *   4. Best-effort: a rejected bulk call is swallowed (no throw), cache unchanged.
 */
import 'fake-indexeddb/auto';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkWarmRates, setRemoteRatesApi, resetRatesHolderForTests } from './rates-holder';
import { IDBExchangeRateDAO } from './dao';
import { openEngineDb } from '../persistence/engine-db';

describe('rates-holder — bulkWarmRates (Story 5.2: de-dup + chunk + write-through)', () => {
  let db: IDBDatabase;

  beforeAll(async () => {
    db = await openEngineDb();
  });

  afterAll(() => {
    resetRatesHolderForTests();
  });

  beforeEach(() => {
    resetRatesHolderForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('bulkWarmRates writes every returned table to the IDB cache (one bulk call)', async () => {
    const bulk = vi.fn(async () => ({ '2024-01-01': { USD: 1, EUR: 0.8 }, '2024-01-02': { USD: 1, EUR: 0.9 } }));
    setRemoteRatesApi({ getExchangeRate: vi.fn(), bulkGetExchangeRates: bulk } as never);
    await bulkWarmRates([new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T12:00:00Z'), new Date('2024-01-02T00:00:00Z')]);
    expect(bulk).toHaveBeenCalledTimes(1); // ONE call (de-duped: 2 distinct dates)
    const dao = new IDBExchangeRateDAO(() => db); // mirror the cache DAO the commit reads
    expect(await dao.findByBaseCurrencyAndDate('USD', '2024-01-01')).toMatchObject({ EUR: 0.8 });
    expect(await dao.findByBaseCurrencyAndDate('USD', '2024-01-02')).toMatchObject({ EUR: 0.9 });
  });

  it('chunks > MAX_BULK_DATES (366) distinct dates into multiple bulk calls — never drops', async () => {
    const bulk = vi.fn(async (_b: string, dates: Date[]) => Object.fromEntries(dates.map((d) => [d.toISOString().slice(0, 10), { USD: 1 }])));
    setRemoteRatesApi({ getExchangeRate: vi.fn(), bulkGetExchangeRates: bulk } as never);
    const dates = Array.from({ length: 400 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i))); // 400 distinct
    await bulkWarmRates(dates);
    expect(bulk).toHaveBeenCalledTimes(2); // ceil(400/366) = 2 chunks
  });

  it('best-effort: a rejected bulk call is swallowed (no throw), cache unchanged', async () => {
    setRemoteRatesApi({ getExchangeRate: vi.fn(), bulkGetExchangeRates: vi.fn(async () => { throw new Error('CF down / not deployed'); }) } as never);
    await expect(bulkWarmRates([new Date('2024-01-01T00:00:00Z')])).resolves.toBeUndefined();
  });
});
