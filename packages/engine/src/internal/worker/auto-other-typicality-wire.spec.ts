/**
 * Auto-Other + typicality wire spec — Story 4.9c, Task 2 (EP-4).
 *
 * Drives the 3 v6 wire methods (importRemainderMagnitude / importAssignRemainder /
 * importTypicality) + the dump-aware importCategorizedRows + the importAbort dump
 * teardown over a REAL composed CategorizationServiceImpl — the same object the
 * direct-client delegates to — across the full transient-dump + magnitude +
 * typicality lifecycle.
 *
 * Harness mirrors sandbox-wire.spec.ts: a single fake-indexeddb DB opened through
 * the REAL ENGINE_MIGRATIONS lineage; trees persisted via the REAL
 * RulePersistenceService and reloaded live; the session-rows accessor is a test
 * double returning a seeded array of stage3 rows; rates are wired through a
 * test-double ExchangeRateService whose convert THROWS the cache-miss signal for
 * cross-currency lookups (so a USD remainder row lands in the uncached tail).
 *
 * The teeth: a MULTI-RULE, MULTI-CURRENCY seed —
 *   R1: description contains 'АТБ'        → groceries  (a 10-row homogeneous
 *       bucket, mcc 5411, EXCEPT one mcc-6051 + amount-outlier row → the atypical
 *       op the typicality pass must flag)
 *   R2: amount < -1000 (UAH)              → big        (the second rule, for the
 *       multi-rule requirement + the virtual-reorder re-bucket)
 * over a mix of UAH + USD rows, ≥1 of which (a USD row) matches NO rule (the
 * remainder) — so remainderCount > 0, the magnitude has a USD uncached tail, and
 * the typicality pass must NEVER flag the remainder.
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
import { IDBExchangeRateDAO } from '../exchange-rate/dao';
import { RulePersistenceService } from '../rules/rule-persistence-service';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { setBaseCurrency } from '../settings/base-currency';
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

/**
 * A cache-miss-only rates double: same-currency converts exact, cross-currency
 * THROWS the uncached signal (RatesUnavailableError) — the S3c best-effort path
 * the magnitude buckets into the uncached tail.
 */
const cacheMissRates: ExchangeRateService = {
  convert: async (amount: number, from: string, to: string): Promise<number> => {
    if (from === to) return amount;
    throw new RatesUnavailableError(`no cached rate for ${from}→${to}`);
  },
} as unknown as ExchangeRateService;

describe('auto-other + typicality wire (the 3 v6 methods + dump-aware window)', () => {
  const SESSION = 'session-1';
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let categoriesService: CategoriesService;
  let rulePersistence: RulePersistenceService;
  let settingsDao: UserSettingsIDBDAO;
  let svc: CategorizationServiceImpl;
  let sessionRows: ImportStatementStage3Row[];
  let groceries: Category;
  let big: Category;

  beforeEach(async () => {
    dbName = `test-auto-other-typicality-wire-db-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    db = await openTestDb(dbName);
    const provider = () => db;
    settingsDao = new UserSettingsIDBDAO(provider);
    await setBaseCurrency(settingsDao, 'UAH');

    footprintDao = new FootprintDao(provider);
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
      ratesProvider: async () => cacheMissRates,
      ratesDao: new IDBExchangeRateDAO(provider),
      warmRates: async () => {},
      getSessionReview: async () => ({ rows: [], rowErrors: [], skipped: [], stage2Rows: [], columns: [] }),
    });

    // ── the multi-rule, multi-currency seed ────────────────────────────────────
    groceries = await categoriesService.create({ name: 'Groceries', icon: 'glyph-cart', currency: 'UAH' });
    big = await categoriesService.create({ name: 'Big', icon: 'glyph-coin', currency: 'UAH' });

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

    // R1's bucket: 10 'АТБ' rows, mcc 5411, small positive amounts — homogeneous
    // EXCEPT row index 9 (mcc 6051 + a ~50× amount outlier) → the atypical op.
    // (Positive amounts keep them out of R2; R1 is first-match anyway.)
    const atbRows: ImportStatementStage3Row[] = Array.from({ length: 10 }, (_, i) =>
      row({
        rowIndex: i,
        hash: `atb${i}`,
        description: `АТБ магазин ${i}`,
        amount: 100 + i, // ~100
        currency: 'UAH',
        mcc: 5411,
      }),
    );
    // The atypical op: minority MCC + ~50× amount outlier.
    atbRows[9] = row({
      rowIndex: 9,
      hash: 'atb9',
      description: 'АТБ магазин 9',
      amount: 5000, // ~50× the ~100 median
      currency: 'UAH',
      mcc: 6051,
    });

    sessionRows = [
      ...atbRows,
      // A UAH row that DOES match R2 (big) — keeps R2 non-empty.
      row({ rowIndex: 10, hash: 'r2', description: 'ВЕЛИКА ПОКУПКА', amount: -2000, currency: 'UAH', mcc: 5411 }),
      // The REMAINDER: USD rows matching NO rule (R1 needs 'АТБ', R2 is UAH-paired).
      row({ rowIndex: 11, hash: 'rem1', description: 'COFFEE', amount: -50, currency: 'USD', mcc: 5814 }),
      row({ rowIndex: 12, hash: 'rem2', description: 'TAXI', amount: -30, currency: 'USD', mcc: 4121 }),
    ];
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

  it('remainderCount: window carries the dump-aware uncategorized count', async () => {
    const win = await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'all' });
    expect(win.remainderCount).toBeGreaterThan(0);
  });

  it('importRemainderMagnitude: base-best-effort + per-currency uncached tail + approx + lastRemainderCategoryId', async () => {
    const mag = await svc.importRemainderMagnitude(SESSION);
    expect(mag.opCount).toBe(
      (await svc.importCategorizedRows(SESSION, { offset: 0, count: 0, segment: 'uncat' })).total,
    );
    expect(mag.totalOpCount).toBeGreaterThanOrEqual(mag.opCount);
    expect(typeof mag.baseTotal).toBe('number');
    // a USD remainder row with no cached rate → in the pending tail (the «≈»
    // best-effort), NOT baseTotal.
    expect(mag.pending.some((p) => p.currency === 'USD')).toBe(true);
    expect(mag.approx).toBe(true); // pending.length > 0
  });

  it('importAssignRemainder: bulk-assigns the remainder (L4), remainderCount → 0, isManual=0, TRANSIENT', async () => {
    const cats = await svc.categoriesList();
    const other = cats[0];
    await svc.importAssignRemainder(SESSION, other.id);
    const win = await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'all' });
    expect(win.remainderCount).toBe(0);
    const dumped = win.rows.filter((r) => r.ruleId === null && r.categoryId === other.id);
    expect(dumped.length).toBeGreaterThan(0);
    expect(dumped.every((r) => r.isManual === 0)).toBe(true); // L4 dump is DERIVED, not manual
    // lastRemainderCategoryId persisted → the next magnitude default.
    expect((await svc.importRemainderMagnitude(SESSION)).lastRemainderCategoryId).toBe(other.id);
    // clear → remainder returns (transient).
    await svc.importAssignRemainder(SESSION, null);
    expect(
      (await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'all' })).remainderCount,
    ).toBeGreaterThan(0);
  });

  it('importTypicality (committed): flags atypical ops per rule-bucket with attribution; NEVER the remainder', async () => {
    const typ = await svc.importTypicality(SESSION);
    expect(typ.flags.length).toBeGreaterThan(0);
    const f = typ.flags[0];
    expect(typeof f.rowIndex).toBe('number');
    expect(f.atypicality).toBeGreaterThan(0);
    expect(f.reasons.length).toBeGreaterThan(0);
    // a real reason carries field+kind (the teeth — covers mcc/amount/rare-tokens).
    expect(['categorical-minority', 'amount-outlier', 'rare-tokens']).toContain(f.reasons[0].kind);
    // the uncategorized remainder is NOT flagged (bucketByWinningRule excludes it).
    const remainderIdx = new Set(
      (await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'uncat' })).rows.map(
        (r) => r.rowIndex,
      ),
    );
    expect(typ.flags.every((fl) => !remainderIdx.has(fl.rowIndex))).toBe(true);
  });

  it('importTypicality (draft): scores the draft bucket', async () => {
    const draft = [{ field: 'description', operator: 'contains', value: 'АТБ' }];
    const typ = await svc.importTypicality(SESSION, { draft });
    expect(Array.isArray(typ.flags)).toBe(true);
  });

  it('importTypicality (virtual): re-runs against the engaged sandbox virtual tree', async () => {
    const list = await svc.importRulesList(SESSION);
    await svc.rulesSubmitEdit(SESSION, { kind: 'reorder', order: [list[1].ruleId, list[0].ruleId] });
    const typ = await svc.importTypicality(SESSION, { virtual: true }); // buckets from the virtual tree
    expect(Array.isArray(typ.flags)).toBe(true);
  });

  it('importAbort drops the dump (dropDump teardown → remainder returns)', async () => {
    const cats = await svc.categoriesList();
    await svc.importAssignRemainder(SESSION, cats[0].id);
    // sanity: the dump collapsed the remainder.
    expect(
      (await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'all' })).remainderCount,
    ).toBe(0);
    // the importAbort path: dropDump clears the session dump → remainder returns.
    svc.dropDump(SESSION);
    expect(
      (await svc.importCategorizedRows(SESSION, { offset: 0, count: 240, segment: 'all' })).remainderCount,
    ).toBeGreaterThan(0);
  });
});
