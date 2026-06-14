/**
 * Tests for CacheOnlyRatesApi — Story 3.3 Task 6.
 *
 * Cache-only, fail-loud rate reader: it reads ONLY from the local DAO (the same
 * rows `warmRates` writes) and NEVER delegates to a remote / fetches. A row miss
 * is a loud `RatesUnavailableError`, not a silent zero/empty map.
 *
 * Harness mirrors internal/exchange-rate/cached-api.spec.ts (direct construction
 * via an openTestDb opened through the migration framework, fake-indexeddb).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CacheOnlyRatesApi,
  RatesUnavailableError,
} from './cache-only-rates-api';
import {
  EXCHANGE_RATES_STORE_CONFIG,
  type ExchangeRateDAO,
  IDBExchangeRateDAO,
} from './dao';
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

describe('CacheOnlyRatesApi', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: ExchangeRateDAO;
  let api: CacheOnlyRatesApi;

  beforeEach(async () => {
    dbName = `test-cache-only-api-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = await openTestDb(dbName);
    dao = new IDBExchangeRateDAO(() => db);
    api = new CacheOnlyRatesApi(dao);
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

  it('returns the stored rate map on a row hit (USD-base, UNITS-PER-USD)', async () => {
    // Seed the cache exactly as warmRates would: USD-base row, units-per-USD.
    const date = new Date('2026-06-14');
    const formattedDate = date.toISOString().split('T')[0]; // '2026-06-14'
    await dao.create({
      base: 'USD',
      date: formattedDate,
      UAH: 41,
      EUR: 0.92,
    });

    const rates = await api.getExchangeRate('USD', date);

    expect(rates).toEqual({ UAH: 41, EUR: 0.92 });
  });

  it('throws RatesUnavailableError on a row miss, naming the missing date', async () => {
    const date = new Date('2026-06-14'); // nothing seeded

    await expect(api.getExchangeRate('USD', date)).rejects.toBeInstanceOf(
      RatesUnavailableError
    );
    await expect(api.getExchangeRate('USD', date)).rejects.toThrow('2026-06-14');
  });

  it('reads the IDENTICAL UTC key that the cached writer uses (date.toISOString().split(T)[0])', async () => {
    // Seed under the UTC yyyy-MM-dd key; read with the same Date instance.
    const date = new Date('2026-01-02T23:30:00.000Z');
    const formattedDate = date.toISOString().split('T')[0]; // '2026-01-02'
    await dao.create({ base: 'USD', date: formattedDate, UAH: 41 });

    const rates = await api.getExchangeRate('USD', date);
    expect(rates).toEqual({ UAH: 41 });
  });

  it('never touches a remote: no global fetch is invoked', async () => {
    const date = new Date('2026-06-14');
    await dao.create({ base: 'USD', date: '2026-06-14', UAH: 41 });

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      await api.getExchangeRate('USD', date); // hit
      await expect(
        api.getExchangeRate('USD', new Date('2099-01-01'))
      ).rejects.toBeInstanceOf(RatesUnavailableError); // miss
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
