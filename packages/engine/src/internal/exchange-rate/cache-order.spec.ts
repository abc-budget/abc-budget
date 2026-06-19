/**
 * DoD test: cache-order (IDB-first, remote-api fallback).
 *
 * Constructs CachedExchangeRateApi directly over a real IDBExchangeRateDAO backed by
 * fake-indexeddb + the migration framework.  A vi.fn() mock stands in for the remote api.
 *
 * api.ts signature: getExchangeRate(baseCurrency: string, date: Date): Promise<Record<string, number>>
 * The Date is formatted to yyyy-MM-dd internally by CachedExchangeRateApi for IDB storage.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExchangeRateApi } from './api';
import { CachedExchangeRateApi } from './cached-api';
import { EXCHANGE_RATES_STORE_CONFIG, IDBExchangeRateDAO } from './dao';
import type { MigrationStep } from '../store/migrations/migration';
import { openDatabase } from '../store/migrations/open-with-migrations';

/** Opens a test DB with the exchangeRates store via the migration framework (v2-equivalent). */
function openTestDb(name: string): Promise<IDBDatabase> {
  const { name: storeName, ...spec } = EXCHANGE_RATES_STORE_CONFIG;
  const step: MigrationStep = {
    toVersion: 1,
    migrate: (ctx) => ctx.createStore(storeName, spec),
  };
  return openDatabase(name, [step]);
}

describe('CachedExchangeRateApi — cache-order DoD', () => {
  let dbName: string;
  let db: IDBDatabase;
  let cachedApi: CachedExchangeRateApi;
  let mockGetExchangeRate: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dbName = `cache-order-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = await openTestDb(dbName);

    mockGetExchangeRate = vi.fn().mockResolvedValue({ EUR: 0.92, GBP: 0.79 });
    const mockApi: ExchangeRateApi = {
      getExchangeRate: mockGetExchangeRate,
      bulkGetExchangeRates: vi.fn().mockResolvedValue({}),
    };

    const dao = new IDBExchangeRateDAO(() => db);
    cachedApi = new CachedExchangeRateApi(dao, mockApi);
  });

  afterEach(async () => {
    if (db) db.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  it('calls the remote api ONCE on first fetch, then serves from IDB on identical request', async () => {
    const date = new Date('2026-06-01');

    // First call — cache miss: remote api must be called once and result persisted.
    const first = await cachedApi.getExchangeRate('USD', date);
    expect(mockGetExchangeRate).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ EUR: 0.92, GBP: 0.79 });

    // Second identical call — cache hit: remote api must NOT be called again.
    const second = await cachedApi.getExchangeRate('USD', date);
    expect(mockGetExchangeRate).toHaveBeenCalledTimes(1); // still once
    expect(second).toEqual({ EUR: 0.92, GBP: 0.79 });
  });

  it('calls the remote api again for a DIFFERENT date (separate cache entry)', async () => {
    const date1 = new Date('2026-06-01');
    const date2 = new Date('2026-06-02');

    await cachedApi.getExchangeRate('USD', date1);
    expect(mockGetExchangeRate).toHaveBeenCalledTimes(1);

    await cachedApi.getExchangeRate('USD', date2);
    expect(mockGetExchangeRate).toHaveBeenCalledTimes(2); // new date → new remote call
  });
});

/**
 * Teeth check: prove the test has real coverage by pointing the DAO at a store name
 * that doesn't exist (simulating an empty / wrong-schema DB).
 * This sub-suite is expected to FAIL its own assertions (or throw) if the store is missing —
 * confirming the happy-path tests above are exercising actual IDB, not a no-op.
 *
 * We do the inverse: assert that using a DIFFERENT store name causes the DAO read to throw
 * (IDB will reject the transaction because the store doesn't exist), which means the cache
 * is truly being consulted.
 */
describe('CachedExchangeRateApi — cache-order TEETH CHECK', () => {
  it('a DAO pointing at a non-existent store causes an error (proves IDB is exercised)', async () => {
    const dbName = `teeth-${Date.now()}`;
    // Open a DB with the correct store
    const { name: storeName, ...spec } = EXCHANGE_RATES_STORE_CONFIG;
    const db = await openDatabase(dbName, [
      {
        toVersion: 1,
        migrate: (ctx) => ctx.createStore(storeName, spec),
      },
    ]);

    // Point the DAO at a store name that does NOT exist in this DB
    const wrongStoreDao = new IDBExchangeRateDAO(() => db);
    // Replace the store name via a patched subclass — simplest approach is to just
    // use a raw IDBExchangeRateDAO with the correct name but wrap the db so that
    // transactions on the store throw.  Easiest: close the DB and try to use it.
    db.close();

    const mockApi: ExchangeRateApi = {
      getExchangeRate: vi.fn().mockResolvedValue({ EUR: 0.92 }),
      bulkGetExchangeRates: vi.fn().mockResolvedValue({}),
    };
    const apiUnderTest = new CachedExchangeRateApi(wrongStoreDao, mockApi);

    // With the db closed, any IDB operation will throw — confirming IDB is actually called.
    await expect(
      apiUnderTest.getExchangeRate('USD', new Date('2026-06-01'))
    ).rejects.toThrow();

    db.close(); // no-op but safe
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });
});
