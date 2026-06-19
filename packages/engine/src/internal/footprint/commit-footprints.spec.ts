/**
 * Tests for commitFootprints — Story 3.4 Task 3: the two-phase, fail-loud,
 * all-or-nothing footprint write path.
 *
 * THE HEADLINE PROOF (test "two-phase abort writes ZERO rows"): a single uncached
 * rate must abort the WHOLE commit with ZERO rows written. The pre-flight converts
 * EVERY row BEFORE the first store write, so a RatesUnavailableError propagates out
 * before `putBatch` is ever reached and the store is left empty.
 *
 * Harness (mirrors footprint-dao.spec.ts): open ONE engine DB through the REAL
 * `ENGINE_MIGRATIONS` lineage — that DB carries BOTH the `footprint` store (v4/v5)
 * and the `exchangeRates` store (v2). We construct a FootprintDao and an
 * IDBExchangeRateDAO over the SAME db handle and seed USD-base rate rows directly
 * into the rate cache (the rows `toAmountUSD` reads). `warm` is a stub — NO network.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FootprintDao } from './footprint-dao';
import { commitFootprints } from './commit-footprints';
import { toAmountUSD } from './footprint-usd';
import { IDBExchangeRateDAO } from '../exchange-rate/dao';
import type { ExchangeRateDAO } from '../exchange-rate/dao';
import { RatesUnavailableError } from '../exchange-rate/cache-only-rates-api';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';
import type { TransactionRow } from '../importStatement/stage3/types';

/** Opens a test DB carrying BOTH footprint + exchangeRates stores via the real lineage. */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

/** Builds a minimal TransactionRow; overrides win. */
function rowWith(overrides: Partial<TransactionRow>): TransactionRow {
  return {
    rowIndex: 0,
    hash: 'h',
    date: new Date('2026-06-10T09:00:00Z'),
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
    ...overrides,
  } as TransactionRow;
}

/** USD-base, UNITS-PER-USD: 1 USD = 41 UAH = 0.92 EUR. other→USD DIVIDES. */
const USD_BASE_MAP = { UAH: 41, EUR: 0.92 };

/** A warm stub that resolves (no network); records the dates it was handed. */
function noopWarm(): (dates: Date[]) => Promise<void> {
  return async () => {
    /* best-effort warm — resolves immediately, NO network */
  };
}

describe('commitFootprints (two-phase, fail-loud, all-or-nothing)', () => {
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let ratesDao: ExchangeRateDAO;

  /** Seeds a USD-base rate row for the given UTC yyyy-MM-dd (so toAmountUSD hits cache). */
  async function seedRates(dateKey: string): Promise<void> {
    await ratesDao.create({ base: 'USD', date: dateKey, ...USD_BASE_MAP });
  }

  beforeEach(async () => {
    dbName = `test-commit-footprints-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    footprintDao = new FootprintDao(() => db);
    ratesDao = new IDBExchangeRateDAO(() => db);
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

  it('HAPPY PATH: distinct rows + seeded rates → {written:N}, getAll length N, amountUSD matches toAmountUSD', async () => {
    await seedRates('2026-06-10');
    await seedRates('2026-07-15');

    const rows: readonly TransactionRow[] = [
      rowWith({ hash: 'h-a', amount: 100, currency: 'UAH', date: new Date('2026-06-10T09:00:00Z') }),
      rowWith({ hash: 'h-b', amount: 820, currency: 'EUR', date: new Date('2026-07-15T09:00:00Z') }),
      rowWith({ hash: 'h-c', amount: 410, currency: 'UAH', date: new Date('2026-07-15T12:00:00Z') }),
    ];

    const result = await commitFootprints(rows, {
      footprintDao,
      ratesDao,
      warm: noopWarm(),
    });

    expect(result).toEqual({ written: 3 });

    const all = await footprintDao.getAll();
    expect(all).toHaveLength(3);

    // Direction sanity for a spot row: h-a is 100 UAH / 41 = 2.439… USD.
    const spotExpected = await toAmountUSD(100, 'UAH', new Date('2026-06-10T09:00:00Z'), ratesDao);
    const spotStored = all.find((r) => r.hash === 'h-a');
    expect(spotStored?.amountUSD).toBeCloseTo(spotExpected, 6);
    expect(spotStored?.amountUSD).toBeCloseTo(2.439, 3);
  });

  it('HEADLINE two-phase proof: one UNCACHED rate → REJECTS RatesUnavailableError AND store is EMPTY (zero writes)', async () => {
    // Seed rates for the first date only; the second row's date is UNCACHED.
    await seedRates('2026-06-10');

    const rows: readonly TransactionRow[] = [
      rowWith({ hash: 'h-a', amount: 100, currency: 'UAH', date: new Date('2026-06-10T09:00:00Z') }),
      // UNCACHED date — pre-flight convert throws here, BEFORE any putBatch.
      rowWith({ hash: 'h-b', amount: 100, currency: 'UAH', date: new Date('2026-08-01T09:00:00Z') }),
    ];

    await expect(
      commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() })
    ).rejects.toBeInstanceOf(RatesUnavailableError);

    // ZERO writes — the abort happened in the pure pre-flight, before the single putBatch tx.
    expect(await footprintDao.getAll()).toHaveLength(0);
  });

  it('IDEMPOTENT re-commit: committing the same rows twice leaves the count unchanged', async () => {
    await seedRates('2026-06-10');
    const rows: readonly TransactionRow[] = [
      rowWith({ hash: 'h-a', amount: 100, currency: 'UAH', date: new Date('2026-06-10T09:00:00Z') }),
      rowWith({ hash: 'h-b', amount: 200, currency: 'UAH', date: new Date('2026-06-10T10:00:00Z') }),
    ];

    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() });
    expect(await footprintDao.getAll()).toHaveLength(2);

    // Second commit of the SAME rows → native [hash,year,month] upsert, count unchanged.
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() });
    expect(await footprintDao.getAll()).toHaveLength(2);
  });

  it('WARM best-effort: a warm that REJECTS (simulated network failure) but cache pre-seeded → STILL succeeds', async () => {
    await seedRates('2026-06-10');
    const rows: readonly TransactionRow[] = [
      rowWith({ hash: 'h-a', amount: 100, currency: 'UAH', date: new Date('2026-06-10T09:00:00Z') }),
    ];

    const failingWarm = async (): Promise<void> => {
      throw new Error('simulated network failure (offline)');
    };

    const result = await commitFootprints(rows, {
      footprintDao,
      ratesDao,
      warm: failingWarm,
    });

    // warm failure swallowed; the cache-only convert hit the pre-seeded row.
    expect(result).toEqual({ written: 1 });
    expect(await footprintDao.getAll()).toHaveLength(1);
  });

  it('DETERMINISM: same inputs → same stored records across two runs (store reset between)', async () => {
    const rows: readonly TransactionRow[] = [
      rowWith({ hash: 'h-a', amount: 100, currency: 'UAH', date: new Date('2026-06-10T09:00:00Z') }),
      rowWith({ hash: 'h-b', amount: 820, currency: 'EUR', date: new Date('2026-06-10T09:00:00Z') }),
    ];

    // Run 1.
    await seedRates('2026-06-10');
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() });
    const run1 = (await footprintDao.getAll()).sort((a, b) => a.hash.localeCompare(b.hash));

    // Reset the store between runs (drop + reopen a fresh DB).
    db.close();
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(dbName);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
    });
    db = await openTestDb(dbName);
    footprintDao = new FootprintDao(() => db);
    ratesDao = new IDBExchangeRateDAO(() => db);

    // Run 2 — identical inputs.
    await seedRates('2026-06-10');
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() });
    const run2 = (await footprintDao.getAll()).sort((a, b) => a.hash.localeCompare(b.hash));

    expect(run2).toEqual(run1);
  });
});

// ---------------------------------------------------------------------------
// Story 5.1 — Task 2: perf-map M-reads + categoryOf tests
// ---------------------------------------------------------------------------

describe('commitFootprints 5.1 — perf-map + categoryOf', () => {
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let ratesDao: ExchangeRateDAO;

  /** Builds a minimal UAH TransactionRow for the 5.1 perf-map tests. */
  function opRow(dateStr: string, amount: number, hash?: string): TransactionRow {
    return rowWith({
      hash: hash ?? `h-${dateStr}-${amount}`,
      date: new Date(`${dateStr}T00:00:00.000Z`),
      amount,
      currency: 'UAH',
    });
  }

  beforeEach(async () => {
    dbName = `test-commit-fp-51-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    footprintDao = new FootprintDao(() => db);
    ratesDao = new IDBExchangeRateDAO(() => db);
    // Seed only 2023-09-30; 2023-10-01 is intentionally absent (see two-phase test).
    await ratesDao.create({ base: 'USD', date: '2023-09-30', ...USD_BASE_MAP });
  });

  afterEach(async () => {
    if (db) db.close();
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(dbName);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
    });
  });

  it('PERF-MAP: distinct-date rates read ONCE (M reads, not N)', async () => {
    // 4 rows over 2 distinct dates; seed both so the commit succeeds.
    await ratesDao.create({ base: 'USD', date: '2023-10-01', ...USD_BASE_MAP });
    const rows = [
      opRow('2023-09-30', -10),
      opRow('2023-09-30', -20),
      opRow('2023-10-01', -30),
      opRow('2023-09-30', -40),
    ];
    const spy = vi.spyOn(ratesDao, 'findByBaseCurrencyAndDate');
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() });
    // preload reads each DISTINCT date once (2), NOT once per row (4).
    expect(spy).toHaveBeenCalledTimes(2);
    expect((await footprintDao.getAll()).length).toBe(4);
  });

  it('convert-from-map matches per-op toAmountUSD', async () => {
    const rows = [opRow('2023-09-30', -100)];
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() });
    const direct = await toAmountUSD(-100, 'UAH', new Date('2023-09-30T00:00:00.000Z'), ratesDao);
    expect((await footprintDao.getAll())[0].amountUSD).toBe(direct);
  });

  it('categoryOf threads categoryId/isManual into each footprint', async () => {
    const rows = [opRow('2023-09-30', -10, 'h1'), opRow('2023-09-30', -20, 'h2')];
    await commitFootprints(rows, {
      footprintDao,
      ratesDao,
      warm: noopWarm(),
      categoryOf: (r) =>
        r.hash === 'h1' ? { categoryId: 'groceries', isManual: 1 } : { categoryId: null, isManual: 0 },
    });
    const all = await footprintDao.getAll();
    expect(all.find((f) => f.hash === 'h1')).toMatchObject({ categoryId: 'groceries', isManual: 1 });
    expect(all.find((f) => f.hash === 'h2')).toMatchObject({ categoryId: null, isManual: 0 });
  });

  it('two-phase ATOMIC: one uncached date among N → ZERO writes + RatesUnavailableError', async () => {
    // 2023-09-30 is seeded; 2023-10-01 is NOT seeded in this suite's beforeEach.
    const rows = [opRow('2023-09-30', -10), opRow('2023-10-01', -20)];
    await expect(
      commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm() })
    ).rejects.toBeInstanceOf(RatesUnavailableError);
    expect((await footprintDao.getAll()).length).toBe(0); // not partial
  });
});
