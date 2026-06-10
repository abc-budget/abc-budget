/**
 * Tests for the CachedExchangeRateApi implementation
 * Ported from webapp/libs/engine/src/exchange-rate/cached-api.spec.ts
 * Adaptation: Container/IoCKeys/registerDatabase removed; direct construction via openTestDb pattern.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CachedExchangeRateApi } from './cached-api';
import {
  EXCHANGE_RATES_STORE_CONFIG,
  type ExchangeRateDAO,
  IDBExchangeRateDAO,
} from './dao';
import type { ExchangeRateApi } from './api';
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

// Mock implementation of ExchangeRateApi for testing
class MockExchangeRateApi implements ExchangeRateApi {
  // Track calls to getExchangeRate for verification
  public calls: { baseCurrency: string; date: Date }[] = [];

  // Mock data to return
  public mockRates: Record<string, number> = {
    EUR: 0.85,
    GBP: 0.75,
    JPY: 110.5,
  };

  // Custom response for specific calls
  private customResponses: Map<string, Record<string, number>> = new Map();

  // Set a custom response for a specific base currency and date
  setCustomResponse(
    baseCurrency: string,
    date: string,
    rates: Record<string, number>
  ): void {
    const key = `${baseCurrency}-${date}`;
    this.customResponses.set(key, rates);
  }

  async getExchangeRate(
    baseCurrency: string,
    date: Date
  ): Promise<Record<string, number>> {
    // Record this call
    this.calls.push({ baseCurrency, date });

    // Check for custom response
    const formattedDate = date.toISOString().split('T')[0];
    const key = `${baseCurrency}-${formattedDate}`;

    if (this.customResponses.has(key)) {
      const customResponse = this.customResponses.get(key);
      if (!customResponse) {
        throw new Error(
          `Custom response for key '${key}' was expected but not found`
        );
      }
      return customResponse;
    }

    // Return default mock data
    return this.mockRates;
  }
}

describe('CachedExchangeRateApi', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: ExchangeRateDAO;
  let mockApi: MockExchangeRateApi;
  let cachedApi: CachedExchangeRateApi;

  // Setup before each test
  beforeEach(async () => {
    // Create a unique database name for each test to avoid conflicts
    dbName = `test-cached-api-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Open the database and create a DAO instance
    db = await openTestDb(dbName);
    dao = new IDBExchangeRateDAO(() => db);

    // Create mock API and cached API instance
    mockApi = new MockExchangeRateApi();
    cachedApi = new CachedExchangeRateApi(dao, mockApi);
  });

  // Cleanup after each test
  afterEach(async () => {
    // Close the database connection
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

  it('should call target API when cache is empty', async () => {
    // Arrange
    const baseCurrency = 'USD';
    const date = new Date('2023-01-01');

    // Act
    const rates = await cachedApi.getExchangeRate(baseCurrency, date);

    // Assert
    expect(mockApi.calls.length).toBe(1);
    expect(mockApi.calls[0].baseCurrency).toBe(baseCurrency);
    expect(mockApi.calls[0].date).toEqual(date);
    expect(rates).toEqual(mockApi.mockRates);
  });

  it('should return cached data when available', async () => {
    // Arrange
    const baseCurrency = 'USD';
    const date = new Date('2023-01-01');
    const formattedDate = date.toISOString().split('T')[0];

    // First call to populate the cache
    await cachedApi.getExchangeRate(baseCurrency, date);

    // Reset the mock to verify it's not called again
    mockApi.calls = [];

    // Act
    const rates = await cachedApi.getExchangeRate(baseCurrency, date);

    // Assert
    expect(mockApi.calls.length).toBe(0); // Target API should not be called
    expect(rates).toEqual(mockApi.mockRates);

    // Verify data was stored in the cache
    const cachedEntity = await dao.findByBaseCurrencyAndDate(
      baseCurrency,
      formattedDate
    );
    expect(cachedEntity).not.toBeNull();
    expect(cachedEntity?.base).toBe(baseCurrency);
    expect(cachedEntity?.date).toBe(formattedDate);
    expect(cachedEntity?.['EUR']).toBe(0.85);
  });
});
