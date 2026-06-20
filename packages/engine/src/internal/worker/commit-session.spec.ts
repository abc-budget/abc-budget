/**
 * commitSession end-to-end wire spec — Story 5.1, Task 3 (EP-5 commit pipeline).
 *
 * Drives the worker `commitSession` over a REAL composed CategorizationServiceImpl
 * — the same object the direct-client delegates to — across a MULTI-RULE,
 * MULTI-CURRENCY session. NOT a mock: real `autoCategorize` (the L1→L4 ladder) +
 * real `commitFootprints` (the two-phase perf-map + per-row categoryOf) + real
 * `FootprintDao.getAll()` + a seeded `IDBExchangeRateDAO` for the op dates.
 *
 * Harness mirrors auto-other-typicality-wire.spec.ts: a single fake-indexeddb DB
 * opened through the REAL ENGINE_MIGRATIONS lineage; trees persisted via the REAL
 * RulePersistenceService; the session-rows accessor is a test double; rates are
 * seeded into the rate cache DAO directly.
 *
 * The teeth — a MULTI-RULE, MULTI-CURRENCY seed:
 *   R1: description contains 'АТБ' → groceries  (a UAH rule row → categoryId + isManual=0)
 *   R2: amount < -1000 (UAH)       → big         (the second rule, multi-rule requirement)
 *   plus a MANUAL L1 row (isManuallySetCategory) → isManual=1
 *   plus the REMAINDER: a USD row matching no rule (the dump target)
 * Op dates span two distinct calendar days; rates seeded for UAH on both (USD is
 * identity). One asserts the two-phase loud gate by leaving a date's rate uncached.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CategorizationServiceImpl,
  type SessionRowsAccessor,
} from './categorization-service-impl';
import { FootprintDao } from '../footprint/footprint-dao';
import { CategoriesService } from '../categories/categories-service';
import { CategoriesDAO } from '../categories/categories-dao';
import { ComplexRuleDAO } from '../rules/complex-rules-dao';
import { RulePersistenceService } from '../rules/rule-persistence-service';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { setBaseCurrency } from '../settings/base-currency';
import { IDBExchangeRateDAO } from '../exchange-rate/dao';
import type { ExchangeRateDAO } from '../exchange-rate/dao';
import { RatesUnavailableError } from '../exchange-rate/cache-only-rates-api';
import type { ExchangeRateService } from '../exchange-rate/service';
import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/** Opens a test DB through the REAL engine migration lineage. */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

/** A full stage-3 row carrying every field the impl reads. */
function row(over: Partial<ImportStatementStage3Row>): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    hash: 'h0',
    date: new Date(Date.UTC(2026, 5, 15)), // 2026-06-15
    amount: 0,
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
    ...over,
  };
}

/** yyyy-MM-dd key for a Date (the rate-cache key derivation). */
function dateKey(d: Date): string {
  return d.toISOString().split('T')[0];
}

const DAY_A = new Date(Date.UTC(2026, 5, 15)); // 2026-06-15
const DAY_B = new Date(Date.UTC(2026, 5, 20)); // 2026-06-20

const RULE_HASH = 'atb0';
const MANUAL_HASH = 'manual0';
const BIG_HASH = 'big0';
const DUMP_HASH = 'rem-usd';

describe('commitSession (autoCategorize → commitFootprints, end-to-end)', () => {
  const SESSION = 'session-1';
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let ratesDao: ExchangeRateDAO;
  let categoriesService: CategoriesService;
  let rulePersistence: RulePersistenceService;
  let settingsDao: UserSettingsIDBDAO;
  let svc: CategorizationServiceImpl;
  let sessionRows: ImportStatementStage3Row[];
  let groceries: Category;
  let big: Category;
  let other: Category;

  /** Seeds the USD-base rate for UAH on a given op date (units-per-USD). */
  async function seedRate(date: Date, uah: number): Promise<void> {
    await (ratesDao as IDBExchangeRateDAO).upsert({
      base: 'USD',
      date: dateKey(date),
      UAH: uah,
    });
  }

  beforeEach(async () => {
    dbName = `test-commit-session-db-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    db = await openTestDb(dbName);
    const provider = () => db;
    settingsDao = new UserSettingsIDBDAO(provider);
    await setBaseCurrency(settingsDao, 'UAH');

    footprintDao = new FootprintDao(provider);
    ratesDao = new IDBExchangeRateDAO(provider);
    categoriesService = new CategoriesService(new CategoriesDAO(provider), settingsDao);
    rulePersistence = new RulePersistenceService(new ComplexRuleDAO(provider), categoriesService);

    sessionRows = [];
    const accessor: SessionRowsAccessor = async (id) => {
      if (id !== SESSION) throw new Error(`unknown session ${id}`);
      return sessionRows;
    };

    svc = new CategorizationServiceImpl({
      getSessionRows: accessor,
      footprintDao,
      categoriesService,
      rulePersistence,
      userSettings: settingsDao,
      ratesProvider: async (): Promise<ExchangeRateService | null> => null,
      ratesDao,
      warmRates: async () => {}, // best-effort no-op (the loud gate is the cache-only convert)
      getSessionReview: async () => ({ rows: [], rowErrors: [], skipped: [], stage2Rows: [], columns: [] }),
    });

    // ── the multi-rule seed ─────────────────────────────────────────────────────
    groceries = await categoriesService.create({ name: 'Groceries', icon: 'glyph-cart', currency: 'UAH' });
    big = await categoriesService.create({ name: 'Big', icon: 'glyph-coin', currency: 'UAH' });
    other = await categoriesService.create({ name: 'Other', icon: 'glyph-dots', currency: 'UAH' });

    // R1: description contains 'АТБ' → groceries
    await svc.rulesCreate(
      [{ field: 'description', operator: 'contains', value: 'АТБ' }],
      groceries.id!,
    );
    // R2: amount < -1000 (UAH) → big
    await svc.rulesCreate(
      [{ field: 'amount', operator: 'lessThan', value: -1000, currency: 'UAH' }],
      big.id!,
    );

    sessionRows = [
      // A rule row (R1 → groceries), DAY_A, UAH.
      row({ rowIndex: 0, hash: RULE_HASH, description: 'АТБ магазин', amount: 100, currency: 'UAH', date: DAY_A }),
      // A second rule row (R2 → big), DAY_A, UAH.
      row({ rowIndex: 1, hash: BIG_HASH, description: 'ВЕЛИКА', amount: -2000, currency: 'UAH', date: DAY_A }),
      // A MANUAL L1 pick row → isManual=1; lands on its in-session category.
      row({
        rowIndex: 2,
        hash: MANUAL_HASH,
        description: 'РУЧНА',
        amount: 500,
        currency: 'UAH',
        date: DAY_B,
        isManuallySetCategory: true,
        category: big,
      }),
      // The REMAINDER: a USD row matching no rule (the dump target), DAY_B, USD (identity convert).
      row({ rowIndex: 3, hash: DUMP_HASH, description: 'COFFEE', amount: -50, currency: 'USD', date: DAY_B }),
    ];

    // Seed UAH rates for BOTH op dates (USD rows convert identity, no lookup).
    await seedRate(DAY_A, 40);
    await seedRate(DAY_B, 41);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (db) db.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
    });
  });

  it('commitSession writes 7-field categorized footprints (rule + manual + dump) for the session', async () => {
    const res = await svc.commitSession(SESSION);
    expect(res.rowsCommitted).toBe(sessionRows.length);

    const fps = await footprintDao.getAll();
    expect(fps).toHaveLength(sessionRows.length);

    // every footprint has the 7 fields: day (number) + amountUSD set.
    for (const fp of fps) {
      expect(typeof fp.day).toBe('number');
      expect(typeof fp.amountUSD).toBe('number');
    }

    // a rule-matched row → its categoryId, isManual=0.
    expect(fps.find((f) => f.hash === RULE_HASH)).toMatchObject({
      categoryId: groceries.id,
      isManual: 0,
    });
    // the day matches the op date day-of-month.
    expect(fps.find((f) => f.hash === RULE_HASH)?.day).toBe(DAY_A.getUTCDate());

    // a manual L1 pick → isManual=1, its overridden category.
    expect(fps.find((f) => f.hash === MANUAL_HASH)).toMatchObject({
      categoryId: big.id,
      isManual: 1,
    });

    // the second rule row → big, isManual=0.
    expect(fps.find((f) => f.hash === BIG_HASH)).toMatchObject({
      categoryId: big.id,
      isManual: 0,
    });
  });

  it("dump'd rows commit isManual=0 → re-import sees them uncategorized", async () => {
    await svc.importAssignRemainder(SESSION, other.id!); // dump the remainder
    await svc.commitSession(SESSION);
    const dumped = (await footprintDao.getAll()).find((f) => f.hash === DUMP_HASH);
    expect(dumped).toMatchObject({ categoryId: other.id, isManual: 0 }); // DERIVED, not manual
    // isManual=0 → getManualByPeriods skips it → re-import uncategorized (4.6 transient).
  });

  it('two-phase loud gate: one uncached op date → ZERO footprints + RatesUnavailableError', async () => {
    // leave DAY_B's UAH rate uncached (the MANUAL_HASH row is UAH on DAY_B).
    await (ratesDao as IDBExchangeRateDAO).delete({ base: 'USD', date: dateKey(DAY_B) });
    await expect(svc.commitSession(SESSION)).rejects.toBeInstanceOf(RatesUnavailableError);
    expect((await footprintDao.getAll()).length).toBe(0);
  });
});
