/**
 * Tests for computeRemainderMagnitude — Story 4.6 Task 3 (decision B, fail-soft).
 *
 * The S3c best-effort sum of the remainder into the base currency (ENT-021
 * inform-don't-gate; NO threshold). This spec pins:
 *   - same-currency = base → exact sum, empty tail, no conversion;
 *   - a CACHED cross-currency → converted into `baseTotal`;
 *   - an UNcached currency → its amount in `uncachedTail` (NOT `baseTotal`), and
 *     the call STILL RESOLVES (FAIL-SOFT, no rejection);
 *   - mixed → base + cached in `baseTotal`, uncached in the tail, opCount total;
 *   - OPERATION-DATE pinning → seeding a DIFFERENT date leaves the row uncached
 *     (proves the read uses `row.date`);
 *   - two rows of the same uncached currency → summed in the tail.
 *
 * Harness: the real engine migration lineage (ENGINE_MIGRATIONS) over
 * fake-indexeddb; the service is `new ExchangeRateServiceImpl(new
 * CacheOnlyRatesApi(dao))` (offline). Seeding mirrors footprint-usd.spec.ts:
 * USD-base rate rows (UNITS-PER-USD) written straight to the DAO.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { computeRemainderMagnitude } from './remainder-magnitude';
import { CacheOnlyRatesApi } from '../exchange-rate/cache-only-rates-api';
import {
  type ExchangeRateDAO,
  IDBExchangeRateDAO,
} from '../exchange-rate/dao';
import { ExchangeRateServiceImpl } from '../exchange-rate/service';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/** Opens a test DB through the REAL engine migration lineage. */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

/** A minimal remainder row carrying only the magnitude-relevant fields. */
function row(amount: number, currency: string, date: Date): ImportStatementStage3Row {
  return { amount, currency, date } as ImportStatementStage3Row;
}

describe('computeRemainderMagnitude', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: ExchangeRateDAO;
  let ratesService: ExchangeRateServiceImpl;

  // 1 USD = 41 UAH; 1 USD = 0.92 EUR (UNITS-PER-USD, USD-base).
  const cachedDate = new Date('2026-06-14');
  const cachedKey = cachedDate.toISOString().split('T')[0]; // '2026-06-14'

  beforeEach(async () => {
    dbName = `test-remainder-magnitude-db-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db = await openTestDb(dbName);
    dao = new IDBExchangeRateDAO(() => db);
    await dao.create({ base: 'USD', date: cachedKey, UAH: 41, EUR: 0.92 });
    ratesService = new ExchangeRateServiceImpl(new CacheOnlyRatesApi(dao));
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

  it('single-currency = base: exact sum, empty tail, no conversion', async () => {
    // base = UAH, all rows in UAH → no rate lookup needed at all.
    const rows = [
      row(100, 'UAH', cachedDate),
      row(250, 'UAH', cachedDate),
      row(7, 'UAH', cachedDate),
    ];

    const result = await computeRemainderMagnitude(rows, {
      ratesService,
      base: 'UAH',
    });

    expect(result.opCount).toBe(3);
    expect(result.baseTotal).toBe(357);
    expect(result.uncachedTail.size).toBe(0);
  });

  it('cached cross-currency: converts into baseTotal (USD→UAH and EUR→UAH)', async () => {
    // base = UAH. 10 USD → 10 * 41 = 410 UAH; 10 EUR → (10 / 0.92) * 41 = 445.65 UAH.
    const rows = [
      row(10, 'USD', cachedDate),
      row(10, 'EUR', cachedDate),
    ];

    const result = await computeRemainderMagnitude(rows, {
      ratesService,
      base: 'UAH',
    });

    expect(result.opCount).toBe(2);
    // 410 (USD→UAH) + 445.652 (EUR→UAH) ≈ 855.652
    expect(result.baseTotal).toBeCloseTo(410 + (10 / 0.92) * 41, 3);
    expect(result.uncachedTail.size).toBe(0);
  });

  it('UNcached currency → tail (FAIL-SOFT: still resolves, not in baseTotal)', async () => {
    // GBP is not in the seeded row → currency-level miss → uncached signal.
    const rows = [row(100, 'GBP', cachedDate)];

    const result = await computeRemainderMagnitude(rows, {
      ratesService,
      base: 'UAH',
    });

    expect(result.opCount).toBe(1);
    expect(result.baseTotal).toBe(0); // nothing converted
    expect(result.uncachedTail.get('GBP')).toBe(100); // original amount, original currency
    expect(result.uncachedTail.size).toBe(1);
  });

  it('mixed: base + cached → baseTotal; uncached → tail; opCount = total', async () => {
    const rows = [
      row(100, 'UAH', cachedDate), // base → +100
      row(10, 'USD', cachedDate), // cached → +410
      row(50, 'GBP', cachedDate), // uncached → tail
    ];

    const result = await computeRemainderMagnitude(rows, {
      ratesService,
      base: 'UAH',
    });

    expect(result.opCount).toBe(3);
    expect(result.baseTotal).toBeCloseTo(100 + 10 * 41, 3); // 510
    expect(result.uncachedTail.get('GBP')).toBe(50);
    expect(result.uncachedTail.size).toBe(1);
  });

  it('operation-date pinning: a row dated D2 is uncached when only D1 is seeded', async () => {
    // Rate seeded for cachedDate (D1) only. A USD row dated D2 has NO cached rate
    // at D2 → falls to the tail. Proves the read uses row.date, not D1.
    const d2 = new Date('2026-06-15'); // no row seeded for this date
    const rows = [row(10, 'USD', d2)];

    const result = await computeRemainderMagnitude(rows, {
      ratesService,
      base: 'UAH',
    });

    expect(result.baseTotal).toBe(0); // uncached at D2 → nothing converted
    expect(result.uncachedTail.get('USD')).toBe(10);
    expect(result.uncachedTail.size).toBe(1);
  });

  it('two rows same uncached currency are summed in the tail', async () => {
    const rows = [
      row(30, 'GBP', cachedDate),
      row(70, 'GBP', cachedDate),
    ];

    const result = await computeRemainderMagnitude(rows, {
      ratesService,
      base: 'UAH',
    });

    expect(result.opCount).toBe(2);
    expect(result.baseTotal).toBe(0);
    expect(result.uncachedTail.get('GBP')).toBe(100); // 30 + 70
    expect(result.uncachedTail.size).toBe(1);
  });
});
