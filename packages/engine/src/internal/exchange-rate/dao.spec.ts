/**
 * Tests for IDBExchangeRateDAO
 * Ported from webapp/libs/engine/src/exchange-rate/dao.spec.ts
 * Adaptation: Container/registerDatabase removed; direct construction via openTestDb pattern
 * (mirrors packages/engine/src/internal/store/idb/dao-impl.spec.ts).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EXCHANGE_RATES_STORE_CONFIG,
  type ExchangeRateDAO,
  IDBExchangeRateDAO,
} from './dao';
import type { ExchangeRateEntity } from './types';
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

describe('ExchangeRateDAO', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: ExchangeRateDAO;

  beforeEach(async () => {
    // Create a unique database name for each test to avoid conflicts
    dbName = `test-exchange-rates-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    // Open the database and create a DAO instance
    db = await openTestDb(dbName);
    dao = new IDBExchangeRateDAO(() => db);
  });

  // Cleanup after each test
  afterEach(async () => {
    if (db) {
      db.close();
    }

    // Delete the test database
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve(); // Resolve anyway to continue tests
    });
  });

  it('creates and reads an exchange rate entity', async () => {
    const exchangeRate: ExchangeRateEntity = {
      base: 'USD',
      date: '2023-01-01',
      EUR: 0.85,
      GBP: 0.75,
      JPY: 110.5,
    };

    await dao.create(exchangeRate);
    const retrieved = await dao.read({ base: 'USD', date: '2023-01-01' });

    expect(retrieved).not.toBeNull();
    expect(retrieved?.base).toBe('USD');
    expect(retrieved?.date).toBe('2023-01-01');
    expect(retrieved?.['EUR']).toBe(0.85);
    expect(retrieved?.['GBP']).toBe(0.75);
    expect(retrieved?.['JPY']).toBe(110.5);
  });

  it('updates an exchange rate entity', async () => {
    const exchangeRate: ExchangeRateEntity = {
      base: 'USD',
      date: '2023-01-01',
      EUR: 0.85,
      GBP: 0.75,
      JPY: 110.5,
    };

    await dao.create(exchangeRate);

    const updated: ExchangeRateEntity = {
      ...exchangeRate,
      EUR: 0.86,
      GBP: 0.76,
      CAD: 1.25,
    };

    await dao.update({ base: 'USD', date: '2023-01-01' }, updated);
    const retrieved = await dao.read({ base: 'USD', date: '2023-01-01' });

    expect(retrieved).not.toBeNull();
    expect(retrieved?.['EUR']).toBe(0.86);
    expect(retrieved?.['GBP']).toBe(0.76);
    expect(retrieved?.['CAD']).toBe(1.25);
    expect(retrieved?.['JPY']).toBe(110.5);
  });

  it('deletes an exchange rate entity', async () => {
    const exchangeRate: ExchangeRateEntity = {
      base: 'USD',
      date: '2023-01-01',
      EUR: 0.85,
      GBP: 0.75,
      JPY: 110.5,
    };

    await dao.create(exchangeRate);
    const deleteResult = await dao.delete({ base: 'USD', date: '2023-01-01' });
    const retrieved = await dao.read({ base: 'USD', date: '2023-01-01' });

    expect(deleteResult).toBe(true);
    expect(retrieved).toBeNull();
  });

  it('finds exchange rates by base currency', async () => {
    const exchangeRates: ExchangeRateEntity[] = [
      { base: 'USD', date: '2023-01-01', EUR: 0.85, GBP: 0.75 },
      { base: 'USD', date: '2023-01-02', EUR: 0.86, GBP: 0.76 },
      { base: 'EUR', date: '2023-01-01', USD: 1.18, GBP: 0.88 },
    ];

    await dao.create(exchangeRates[0]);
    await dao.create(exchangeRates[1]);
    await dao.create(exchangeRates[2]);

    const usdRates = await dao.findByBaseCurrency('USD');
    const eurRates = await dao.findByBaseCurrency('EUR');

    expect(usdRates.length).toBe(2);
    expect(usdRates.find((e) => e.date === '2023-01-01')).toBeDefined();
    expect(usdRates.find((e) => e.date === '2023-01-02')).toBeDefined();

    expect(eurRates.length).toBe(1);
    expect(eurRates[0].date).toBe('2023-01-01');
  });

  it('finds exchange rates by date', async () => {
    const exchangeRates: ExchangeRateEntity[] = [
      { base: 'USD', date: '2023-01-01', EUR: 0.85, GBP: 0.75 },
      { base: 'EUR', date: '2023-01-01', USD: 1.18, GBP: 0.88 },
      { base: 'USD', date: '2023-01-02', EUR: 0.86, GBP: 0.76 },
    ];

    await dao.create(exchangeRates[0]);
    await dao.create(exchangeRates[1]);
    await dao.create(exchangeRates[2]);

    const day1Rates = await dao.findByDate('2023-01-01');
    const day2Rates = await dao.findByDate('2023-01-02');

    expect(day1Rates.length).toBe(2);
    expect(day1Rates.find((e) => e.base === 'USD')).toBeDefined();
    expect(day1Rates.find((e) => e.base === 'EUR')).toBeDefined();

    expect(day2Rates.length).toBe(1);
    expect(day2Rates[0].base).toBe('USD');
  });

  it('finds exchange rate by base currency and date', async () => {
    const exchangeRates: ExchangeRateEntity[] = [
      { base: 'USD', date: '2023-01-01', EUR: 0.85, GBP: 0.75 },
      { base: 'EUR', date: '2023-01-01', USD: 1.18, GBP: 0.88 },
    ];

    await dao.create(exchangeRates[0]);
    await dao.create(exchangeRates[1]);

    const usdRate = await dao.findByBaseCurrencyAndDate('USD', '2023-01-01');
    const eurRate = await dao.findByBaseCurrencyAndDate('EUR', '2023-01-01');
    const nonExistentRate = await dao.findByBaseCurrencyAndDate(
      'GBP',
      '2023-01-01'
    );

    expect(usdRate).not.toBeNull();
    expect(usdRate?.base).toBe('USD');
    expect(usdRate?.date).toBe('2023-01-01');
    expect(usdRate?.['EUR']).toBe(0.85);

    expect(eurRate).not.toBeNull();
    expect(eurRate?.base).toBe('EUR');
    expect(eurRate?.date).toBe('2023-01-01');
    expect(eurRate?.['USD']).toBe(1.18);

    expect(nonExistentRate).toBeNull();
  });

  it('supports criteria parameter in findByBaseCurrency', async () => {
    const exchangeRates: ExchangeRateEntity[] = [
      { base: 'USD', date: '2023-01-01', EUR: 0.85, GBP: 0.75 },
      { base: 'USD', date: '2023-01-02', EUR: 0.86, GBP: 0.76 },
    ];

    await dao.create(exchangeRates[0]);
    await dao.create(exchangeRates[1]);

    const filtered = await dao.findByBaseCurrency(
      'USD',
      (entity) => (entity['EUR'] as number) > 0.85
    );

    expect(filtered.length).toBe(1);
    expect(filtered[0].date).toBe('2023-01-02');
  });

  it('supports criteria parameter in findByDate', async () => {
    const exchangeRates: ExchangeRateEntity[] = [
      { base: 'USD', date: '2023-01-01', EUR: 0.85, GBP: 0.75 },
      { base: 'EUR', date: '2023-01-01', USD: 1.18, GBP: 0.88 },
    ];

    await dao.create(exchangeRates[0]);
    await dao.create(exchangeRates[1]);

    const filtered = await dao.findByDate(
      '2023-01-01',
      (entity) => entity.base === 'USD'
    );

    expect(filtered.length).toBe(1);
    expect(filtered[0].base).toBe('USD');
  });
});
