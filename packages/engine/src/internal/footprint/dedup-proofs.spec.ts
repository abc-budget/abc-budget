/**
 * SYNTHETIC DEDUP PROOFS — Story 3.4 Task 4a (the EP-3 payoff).
 *
 * The dedup composition was proven PIECE BY PIECE elsewhere: the 3.2 dup-counter
 * gives true duplicates distinct hashes (dup-counter.spec.ts), pseudo-ops spawn
 * distinct-hash trios (row-generator.spec.ts ENT-013), and the [hash,year,month]
 * store upserts idempotently (commit-footprints.spec.ts). What NO test proved is
 * the WHOLE chain end-to-end on REAL generated rows: that the REAL 3.2 hashes a
 * statement produces — wrapped by the dup-counter, discriminated by pseudoOp —
 * land in the store as the RIGHT COUNT once committed.
 *
 * This spec wires the REAL pieces against SYNTHETIC fixtures:
 *
 *   ImportStatementRowData[] + ColumnInfo[]   (hand-built mock rows)
 *        │  generateRows(rows, columns, BASE_CURRENCY)   ← REAL, no hash mock
 *        ▼                                                  (real WebCrypto SHA-256,
 *   TransactionRow[] carrying FINAL dup-wrapped hashes      real applyDupCounters,
 *        │  commitFootprints(rows, { footprintDao, … })     real pseudoOp expansion)
 *        ▼
 *   footprint store  ── assert getAll().length ── the COUNT is the proof.
 *
 * NOT MOCKED (deliberately, vs row-generator.spec.ts which stubs ./hash): the hash
 * module is REAL here. These proofs hinge on the dup-counter's wrap→re-SHA and the
 * pseudoOp discriminator producing genuinely-distinct 64-hex hashes — stubbing them
 * would prove nothing. WebCrypto is available in the vitest node env.
 *
 * HARNESS (mirrors commit-footprints.spec.ts / warm-convert-seam.spec.ts): one engine
 * DB opened through the REAL ENGINE_MIGRATIONS lineage carries BOTH the `footprint`
 * store (v4/v5) and the `exchangeRates` store (v2). A FootprintDao and an
 * IDBExchangeRateDAO sit over the SAME db handle; USD-base rate rows are seeded
 * directly for every distinct row date (a FLAT rate — the proofs assert COUNTS, not
 * USD values). `warm` is a stub that resolves — NO network. The DB is dropped +
 * reopened between proofs (beforeEach/afterEach) so each proof starts on an empty store.
 *
 * BASE_CURRENCY is 'UAH' and every generated row maps currency UAH, so the single
 * seeded USD-base map (which includes UAH) covers main ops AND `use_base` pseudo-ops.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FootprintDao } from './footprint-dao';
import { commitFootprints } from './commit-footprints';
import { IDBExchangeRateDAO } from '../exchange-rate/dao';
import type { ExchangeRateDAO } from '../exchange-rate/dao';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';
import { generateRows } from '../importStatement/stage3/row-generator';
import type { ColumnInfo } from '../importStatement/stage3/row-generator';
import { ColumnDefinition } from '../importStatement/types';
import type {
  AmountColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
} from '../importStatement/types';
import type { CellData, ImportStatementRowData } from '../importStatement/stage2/types';
import { SupportedDataType } from '../importStatement/stage2/types';

// ---------------------------------------------------------------------------
// Mock-row + column helpers — COPIED from row-generator.spec.ts (lines ~82–135),
// MINUS the `vi.mock('./hash')`: the REAL hash module must run so real 3.2 hashes
// flow through generateRows into the store.
// ---------------------------------------------------------------------------

function createMockCellData(
  value: unknown,
  type: SupportedDataType = SupportedDataType.TEXT,
): CellData {
  return { value, type, error: null, ignore: null };
}

function createMockRow(
  rowIndex: number,
  cellData: Record<string, unknown> = {},
): ImportStatementRowData {
  return {
    rowIndex,
    get: (columnId: string): CellData => {
      const value = cellData[columnId] ?? null;
      let type: SupportedDataType = SupportedDataType.UNKNOWN;
      if (typeof value === 'number') {
        type = SupportedDataType.NUMBER;
      } else if (typeof value === 'string') {
        type = SupportedDataType.TEXT;
      } else if (value instanceof Date) {
        type = SupportedDataType.DATE;
      }
      return createMockCellData(value, type);
    },
    errorMessageAt: () => null,
    ignoreMessageAt: () => null,
    get isIgnored() {
      return false;
    },
    get hasErrors() {
      return false;
    },
  } as ImportStatementRowData;
}

function createColumn(
  id: string,
  definition: ColumnDefinition,
  params: AmountColumnParams | null = null,
): ColumnInfo {
  return { id, definition, params };
}

/** UAH base — every generated row maps currency UAH (so one seeded map covers all). */
const BASE_CURRENCY = 'UAH';

/** USD-base, UNITS-PER-USD. Flat; proofs assert COUNTS, not USD values. */
const USD_BASE_MAP = { UAH: 41, EUR: 0.92 };

/** A warm stub that resolves — best-effort, NO network. */
const noopWarm = async (): Promise<void> => {
  /* resolves immediately */
};

/** Opens a test DB carrying BOTH footprint + exchangeRates stores via the real lineage. */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

describe('SYNTHETIC dedup proofs (real generateRows → commitFootprints → store COUNTS)', () => {
  let dbName: string;
  let db: IDBDatabase;
  let footprintDao: FootprintDao;
  let ratesDao: ExchangeRateDAO;
  /** UTC days already seeded this proof — guards the unique [base,date] key against a
   *  re-seed when two batches (e.g. PROOF 2's A and B) share a date. */
  let seededDays: Set<string>;

  /** Seeds USD-base rates for every DISTINCT, not-yet-seeded UTC day across the rows. */
  async function seedRatesForRows(
    rows: readonly { date: Date }[],
  ): Promise<void> {
    const days = new Set(rows.map((r) => r.date.toISOString().split('T')[0]));
    for (const day of days) {
      if (seededDays.has(day)) {
        continue;
      }
      await ratesDao.create({ base: 'USD', date: day, ...USD_BASE_MAP });
      seededDays.add(day);
    }
  }

  beforeEach(async () => {
    dbName = `test-dedup-proofs-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
    db = await openTestDb(dbName);
    footprintDao = new FootprintDao(() => db);
    ratesDao = new IDBExchangeRateDAO(() => db);
    seededDays = new Set<string>();
  });

  afterEach(async () => {
    if (db) {
      db.close();
    }
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(dbName);
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
    });
  });

  // -------------------------------------------------------------------------
  // PROOF 1 — zero-growth re-import (native idempotent upsert)
  // -------------------------------------------------------------------------
  it('PROOF 1 — zero-growth re-import: committing the SAME generated rows twice keeps count = N', async () => {
    // A small statement: 3 DISTINCT ops (distinct descriptions → distinct hashes).
    const date = new Date('2026-06-10T09:00:00Z');
    const sourceRows = [
      createMockRow(0, { col1: date, col2: 100, col3: 'UAH', col4: 'Coffee' }),
      createMockRow(1, { col1: date, col2: 200, col3: 'UAH', col4: 'Groceries' }),
      createMockRow(2, { col1: date, col2: 300, col3: 'UAH', col4: 'Fuel' }),
    ];
    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.DESCRIPTION),
    ];

    const { rows, rowErrors, skipped } = await generateRows(sourceRows, columns, BASE_CURRENCY);
    expect(rowErrors).toHaveLength(0);
    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(3);

    await seedRatesForRows(rows);

    // First commit → N records.
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm });
    const N = (await footprintDao.getAll()).length;
    expect(N).toBe(3);

    // Re-import the SAME rows → native [hash,year,month] upsert; count STILL N.
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm });
    expect(await footprintDao.getAll()).toHaveLength(N);
    expect(N).toBe(3); // pinned: zero growth, not "some growth that happens to equal N"
  });

  // -------------------------------------------------------------------------
  // PROOF 2 — overlap is a UNION, not a SUM
  // -------------------------------------------------------------------------
  it('PROOF 2 — overlap (union, not sum): batch A (3) then batch B that re-includes A + 3 new → count = 6, not 9', async () => {
    const date = new Date('2026-06-10T09:00:00Z');

    // Batch A: 3 distinct ops.
    const aSources = [
      createMockRow(0, { col1: date, col2: 100, col3: 'UAH', col4: 'A-one' }),
      createMockRow(1, { col1: date, col2: 200, col3: 'UAH', col4: 'A-two' }),
      createMockRow(2, { col1: date, col2: 300, col3: 'UAH', col4: 'A-three' }),
    ];
    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.DESCRIPTION),
    ];

    const batchA = await generateRows(aSources, columns, BASE_CURRENCY);
    expect(batchA.rows).toHaveLength(3);
    await seedRatesForRows(batchA.rows);
    await commitFootprints(batchA.rows, { footprintDao, ratesDao, warm: noopWarm });
    expect(await footprintDao.getAll()).toHaveLength(3);

    // Batch B RE-INCLUDES A's 3 source rows VERBATIM plus 3 NEW ones.
    // Because the dup-counter is BATCH-deterministic (a pure function of THIS batch's
    // base hashes, never the store), A's three rows regenerate to the SAME final
    // hashes they had in batch A → they upsert in place, not append.
    const bSources = [
      createMockRow(0, { col1: date, col2: 100, col3: 'UAH', col4: 'A-one' }),
      createMockRow(1, { col1: date, col2: 200, col3: 'UAH', col4: 'A-two' }),
      createMockRow(2, { col1: date, col2: 300, col3: 'UAH', col4: 'A-three' }),
      createMockRow(3, { col1: date, col2: 400, col3: 'UAH', col4: 'B-four' }),
      createMockRow(4, { col1: date, col2: 500, col3: 'UAH', col4: 'B-five' }),
      createMockRow(5, { col1: date, col2: 600, col3: 'UAH', col4: 'B-six' }),
    ];
    const batchB = await generateRows(bSources, columns, BASE_CURRENCY);
    expect(batchB.rows).toHaveLength(6);
    await seedRatesForRows(batchB.rows);
    await commitFootprints(batchB.rows, { footprintDao, ratesDao, warm: noopWarm });

    // The UNION: A's 3 ∪ B's 6 (3 shared + 3 new) = 6 distinct records, NOT 3 + 6 = 9.
    expect(await footprintDao.getAll()).toHaveLength(6);

    // Structural proof of the union: A's three hashes are a SUBSET of B's six.
    const aHashes = new Set(batchA.rows.map((r) => r.hash));
    const bHashes = new Set(batchB.rows.map((r) => r.hash));
    for (const h of aHashes) {
      expect(bHashes.has(h)).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // PROOF 3 — in-month true duplicate (FEAT-008): NOT merged
  // -------------------------------------------------------------------------
  it('PROOF 3 — in-month true-duplicate: two BYTE-IDENTICAL rows → 2 distinct hashes → 2 records (NOT merged)', async () => {
    const date = new Date('2026-06-10T09:00:00Z');

    // Two BYTE-IDENTICAL source rows: same date, amount, currency, description.
    // The 3.2 dup-counter must give them DISTINCT final hashes; the store must keep BOTH.
    const sourceRows = [
      createMockRow(0, { col1: date, col2: 100, col3: 'UAH', col4: 'Subway ride' }),
      createMockRow(1, { col1: date, col2: 100, col3: 'UAH', col4: 'Subway ride' }),
    ];
    const columns = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.DESCRIPTION),
    ];

    const { rows, rowErrors, skipped } = await generateRows(sourceRows, columns, BASE_CURRENCY);
    expect(rowErrors).toHaveLength(0);
    expect(skipped).toHaveLength(0);
    expect(rows).toHaveLength(2);

    // The dup-counter wrapped the identical base hash with {dup:0} vs {dup:1} → DISTINCT.
    expect(rows[0].hash).not.toBe(rows[1].hash);

    await seedRatesForRows(rows);
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm });

    // TWO records — the same-month true duplicate is preserved (FEAT-008), not merged.
    const all = await footprintDao.getAll();
    expect(all).toHaveLength(2);
    // And the two stored hashes are the two distinct row hashes.
    expect(new Set(all.map((r) => r.hash)).size).toBe(2);
  });

  // -------------------------------------------------------------------------
  // PROOF 4 — pseudo-op trio: one source row → 3 records
  // -------------------------------------------------------------------------
  it('PROOF 4 — pseudo-op trio: one row with BANK_COMMISSION + CASHBACK → 3 distinct-hash ops → 3 records', async () => {
    const date = new Date('2026-06-10T09:00:00Z');

    // One source row carrying non-zero commission + cashback cells.
    const sourceRows = [
      createMockRow(0, {
        col1: date,
        col2: 1000,
        col3: 'UAH',
        col4: 'Card purchase',
        colComm: 50,
        colCb: 10,
      }),
    ];
    const columns: ColumnInfo[] = [
      createColumn('col1', ColumnDefinition.DATE),
      createColumn('col2', ColumnDefinition.AMOUNT, { currency: 'auto' } as AmountColumnParams),
      createColumn('col3', ColumnDefinition.CURRENCY),
      createColumn('col4', ColumnDefinition.DESCRIPTION),
      // 'use_base' (UAH) so the pseudo-ops' currency has a seeded rate too.
      { id: 'colComm', definition: ColumnDefinition.BANK_COMMISSION, params: { currency: 'use_base' } as BankCommissionColumnParams },
      { id: 'colCb', definition: ColumnDefinition.CASHBACK, params: { currency: 'use_base' } as CashbackColumnParams },
    ];

    const { rows, rowErrors, skipped } = await generateRows(sourceRows, columns, BASE_CURRENCY);
    expect(rowErrors).toHaveLength(0);
    expect(skipped).toHaveLength(0);

    // THREE ops: main + commission + cashback, each with a distinct pseudoOp → distinct hash.
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.hash)).size).toBe(3);

    await seedRatesForRows(rows);
    await commitFootprints(rows, { footprintDao, ratesDao, warm: noopWarm });

    // THREE records — the trio is preserved end-to-end.
    const all = await footprintDao.getAll();
    expect(all).toHaveLength(3);
    expect(new Set(all.map((r) => r.hash)).size).toBe(3);
  });
});
