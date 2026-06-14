/**
 * Tests for toAmountUSD — Story 3.3 Task 6 (the ENT-020 reserve bridge).
 *
 * HIGHEST-RISK: a deterministic-but-WRONG USD is a SILENT money error, so this
 * spec pins the conversion DIRECTION with known values, not just "it runs".
 *
 * CONVENTION (the single tested source of truth, from exchange-rate/service.ts
 * `tryUsdDirectConversion`): the stored rate is units-of-target-currency per USD;
 * other→USD DIVIDES (amount / rates[from]). A multiply/divide swap is the money
 * bug we are guarding against.
 *
 * Harness mirrors internal/exchange-rate/cached-api.spec.ts: seed the cache by
 * writing USD-base rate rows directly to the DAO (fake-indexeddb).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toAmountUSD } from './footprint-usd';
import { RatesUnavailableError } from '../exchange-rate/cache-only-rates-api';
import {
  EXCHANGE_RATES_STORE_CONFIG,
  type ExchangeRateDAO,
  IDBExchangeRateDAO,
} from '../exchange-rate/dao';
import type { MigrationStep } from '../store/migrations/migration';
import { openDatabase } from '../store/migrations/open-with-migrations';

/** Opens a test DB with the exchangeRates store via the migration framework. */
function openTestDb(name: string): Promise<IDBDatabase> {
  const { name: storeName, ...spec } = EXCHANGE_RATES_STORE_CONFIG;
  const step: MigrationStep = {
    toVersion: 1,
    migrate: (ctx) => ctx.createStore(storeName, spec),
  };
  return openDatabase(name, [step]);
}

describe('toAmountUSD', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: ExchangeRateDAO;

  // 1 USD = 41 UAH; 1 USD = 0.92 EUR (UNITS-PER-USD, USD-base).
  const cachedDate = new Date('2026-06-14');
  const cachedKey = cachedDate.toISOString().split('T')[0]; // '2026-06-14'

  beforeEach(async () => {
    dbName = `test-footprint-usd-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = await openTestDb(dbName);
    dao = new IDBExchangeRateDAO(() => db);
    await dao.create({ base: 'USD', date: cachedKey, UAH: 41, EUR: 0.92 });
  });

  afterEach(async () => {
    if (db) {
      db.close();
    }
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve();
    });
  });

  // THE KNOWN-VALUE DIRECTION TEST — the point of this task.
  // stored rate is units-of-target-currency per USD; other→USD divides.
  describe('known-value direction (the money pin)', () => {
    it('UAH→USD divides by the rate (100 UAH / 41 = 2.4390), NOT 4100, NOT 100', async () => {
      const usd = await toAmountUSD(100, 'UAH', cachedDate, dao);

      // 100 / 41 — other→USD divides.
      expect(usd).toBeCloseTo(2.439, 3);
      // The wrong-direction multiply (100 * 41) would be 4100 — explicitly NOT this.
      expect(usd).not.toBeCloseTo(4100, 3);
      // The no-conversion identity bug — explicitly NOT this.
      expect(usd).not.toBeCloseTo(100, 3);
    });

    it('EUR→USD with a sub-1 rate (100 EUR / 0.92 = 108.6957) — locks the divide against a swap', async () => {
      // This rate is < 1, so a multiply/divide swap that "passes" UAH FAILS here:
      // a wrong multiply would give 92, not 108.6957.
      const usd = await toAmountUSD(100, 'EUR', cachedDate, dao);

      expect(usd).toBeCloseTo(108.6957, 3);
      expect(usd).not.toBeCloseTo(92, 3); // the wrong-direction multiply (100 * 0.92)
      expect(usd).not.toBeCloseTo(100, 3);
    });

    it('USD→USD is identity (no division): 100 stays 100', async () => {
      const usd = await toAmountUSD(100, 'USD', cachedDate, dao);
      expect(usd).toBe(100);
    });
  });

  it('is deterministic: same inputs → byte-identical output across repeated calls', async () => {
    const a = await toAmountUSD(100, 'UAH', cachedDate, dao);
    const b = await toAmountUSD(100, 'UAH', cachedDate, dao);
    expect(a).toBe(b);
  });

  describe('fail-loud (RatesUnavailableError)', () => {
    it('rejects on an uncached date, with the missing date string in the message', async () => {
      const uncached = new Date('2099-01-01');

      await expect(
        toAmountUSD(100, 'UAH', uncached, dao)
      ).rejects.toBeInstanceOf(RatesUnavailableError);
      await expect(toAmountUSD(100, 'UAH', uncached, dao)).rejects.toThrow(
        '2099-01-01'
      );
    });

    it('rejects on a currency-level miss (row present, currency absent), naming the currency', async () => {
      // Row exists for cachedDate, but GBP is not in it.
      await expect(
        toAmountUSD(100, 'GBP', cachedDate, dao)
      ).rejects.toBeInstanceOf(RatesUnavailableError);
      await expect(toAmountUSD(100, 'GBP', cachedDate, dao)).rejects.toThrow(
        'GBP'
      );
    });
  });

  it('is offline-safe: no global fetch is invoked on hit or miss', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await toAmountUSD(100, 'UAH', cachedDate, dao); // hit
      await toAmountUSD(100, 'USD', cachedDate, dao); // identity
      await expect(
        toAmountUSD(100, 'UAH', new Date('2099-01-01'), dao)
      ).rejects.toBeInstanceOf(RatesUnavailableError); // miss
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
