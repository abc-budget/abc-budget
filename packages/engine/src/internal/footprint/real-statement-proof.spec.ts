/**
 * real-statement-proof.spec.ts — GATED-SKIP zero-growth proof on a REAL monobank
 * UA statement (Story 3.4 Task 4b).
 *
 * THE PROOF: drive the FULL import pipeline on a real, LOCAL-ONLY monobank export
 * (decode → service.startWith → stage2 column mapping → generateRows → real
 * TransactionRow[]), then `commitFootprints` TWICE over the SAME rows. The store
 * count after the second commit MUST equal the count after the first — ZERO growth.
 * This is the live-data witness for the native [hash,year,month] idempotent upsert:
 * re-importing the same statement adds nothing.
 *
 * GATED (HC-10 — no silent skip): the statement is real financial data, LOCAL-ONLY,
 * NEVER committed and NEVER copied. CI has no such file. When the local path is
 * absent the suite SKIPS via `describe.skipIf` AND logs a loud SKIPPED line stating
 * why — never a silent green. The spec only READS the path; it writes the contents
 * nowhere.
 *
 * THE FILE: `process.env.ABC_REAL_STATEMENT` if set, else the local default below.
 * Columns (Ukrainian headers; a superset of the committed `mono-like-utf8.csv`
 * fixture — same bank, real export adds `(UAH)` suffixes + secondary/rate/balance
 * columns):
 *   "Дата i час операції"          → DATE
 *   "Деталі операції"              → DESCRIPTION
 *   MCC                            → MERCHANT_CATEGORY
 *   "Сума в валюті картки (UAH)"   → AMOUNT (outcome, UAH)
 *   "Сума в валюті операції"       → IGNORE (secondary amount)
 *   "Валюта"                       → IGNORE
 *   "Курс"                         → IGNORE
 *   "Сума комісій (UAH)"           → BANK_COMMISSION
 *   "Сума кешбеку (UAH)"           → CASHBACK
 *   "Залишок після операції"       → IGNORE
 *
 * MAPPING ADAPTATION vs the fixture: the real header names differ (the fixture has
 * `Сума в валюті картки` / `Валюта картки` / `Сума в USD` / `Комісія` / `Кешбек` /
 * `Залишок`; the real export has `(UAH)`-suffixed names + extra columns). Rather
 * than hardcode every header (brittle against em-dash / suffix drift), the mapping
 * is built DYNAMICALLY from the actual decoded column names: DATE/DESCRIPTION/MCC/
 * AMOUNT/BANK_COMMISSION/CASHBACK matched by stable substrings, everything else
 * IGNORE. The placeholder " - " second row is handled by `decode` (same as the
 * fixture) and never reaches stage1.
 *
 * Rates: this proof asserts COUNT, not USD value — so a flat realistic UAH rate
 * (36.5 per USD) is seeded for EVERY distinct operation date. `warm` is a stub that
 * resolves (the cache-only convert is the loud gate; the seeded rows satisfy it).
 *
 * Database: a real (fake-indexeddb) DB through openDatabase / ENGINE_MIGRATIONS so
 * migration v4/v5 (footprint store + hash index) is exercised. Reset via afterEach.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { firstValueFrom } from 'rxjs';

import { openDatabase } from '../store/migrations/open-with-migrations';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { decode } from '../ingest/decode';
import { ImportStatementServiceImpl } from '../importStatement/service';
import { ImportStatementColumn } from '../importStatement/stage2/column';
import { ImportStatementStage2Impl } from '../importStatement/stage2/implementation';
import { ColumnDefinition } from '../importStatement/types';
import type {
  AmountColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  ColumnParams,
  DateColumnParams,
} from '../importStatement/types';
import type {
  ImportStatementColumnHeaderStage2,
  ImportStatementRowData,
} from '../importStatement/stage2/types';
import { generateRows } from '../importStatement/stage3/row-generator';
import type { ColumnInfo } from '../importStatement/stage3/row-generator';
import type { TransactionRow } from '../importStatement/stage3/types';

import { FootprintDao } from './footprint-dao';
import { commitFootprints } from './commit-footprints';
import type { CommitFootprintsDeps } from './commit-footprints';
import { IDBExchangeRateDAO } from '../exchange-rate/dao';
import type { ExchangeRateEntity } from '../exchange-rate/types';

// ---------------------------------------------------------------------------
// The LOCAL-ONLY real statement. process.env override, else the local default.
// existsSync drives the GATE — present → RUN; absent → loud SKIP (HC-10).
// ---------------------------------------------------------------------------

const REAL_STATEMENT_PATH =
  process.env.ABC_REAL_STATEMENT ?? 'D:\\abc-budget\\mono_07-10-23_14-34-50.csv';
const HAS_FILE = existsSync(REAL_STATEMENT_PATH);

if (!HAS_FILE) {
  // HC-10 — no silent skip. State that we skipped and exactly why.
  console.info(
    `[real-statement-proof] SKIPPED — real monobank statement not found at "${REAL_STATEMENT_PATH}". ` +
      `This proof is LOCAL-ONLY (real financial data, never committed); CI has no such file. ` +
      `Set ABC_REAL_STATEMENT to a local monobank UA export to run it.`
  );
}

// ---------------------------------------------------------------------------
// Local mapping triple (mirrors pipeline-e2e.spec.ts — test plumbing, not an
// engine type; ColumnTransformation died with the format entity in 2.6).
// ---------------------------------------------------------------------------

interface ColumnTransformation {
  readonly columnName: string;
  readonly definition: ColumnDefinition;
  readonly params: ColumnParams | null;
}

// ---------------------------------------------------------------------------
// Helpers — copied verbatim from pipeline-e2e.spec.ts (toColumnInfo, applyMappings).
// ---------------------------------------------------------------------------

function toColumnInfo(columns: ImportStatementColumnHeaderStage2[]): ColumnInfo[] {
  return columns.map((col) => ({
    id: col.id,
    definition: col.definition,
    params: col.params,
  }));
}

async function applyMappings(
  stage2: ImportStatementStage2Impl,
  transformations: ColumnTransformation[]
): Promise<void> {
  const cols = await firstValueFrom(stage2.columns);
  for (const t of transformations) {
    const col = cols.find((c) => c.originalName.getText() === t.columnName);
    if (!col || !(col instanceof ImportStatementColumn)) continue;
    switch (t.definition) {
      case ColumnDefinition.DATE:
        await col.parseAsDate((t.params as DateColumnParams) ?? { format: 'auto' });
        break;
      case ColumnDefinition.AMOUNT:
        await col.parseAsAmount(t.params as AmountColumnParams);
        break;
      case ColumnDefinition.DESCRIPTION:
        await col.parseAsDescription();
        break;
      case ColumnDefinition.COUNTERPARTY:
        await col.parseAsCounterparty();
        break;
      case ColumnDefinition.MERCHANT_CATEGORY:
        await col.parseAsMerchant();
        break;
      case ColumnDefinition.BANK_COMMISSION:
        await col.parseAsBankCommission(t.params as BankCommissionColumnParams);
        break;
      case ColumnDefinition.CASHBACK:
        await col.parseAsCashback(t.params as CashbackColumnParams);
        break;
      case ColumnDefinition.IGNORE:
        await col.ignore();
        break;
      default:
        await col.ignore();
    }
  }
}

/**
 * Builds the mapping DYNAMICALLY from the real decoded column names. Each header
 * is classified by a stable substring (robust against the `(UAH)` suffix / em-dash
 * drift that distinguishes the real export from the committed fixture). Anything
 * not recognized → IGNORE. A bad cell in an IGNORE'd column can never block.
 */
function buildMappingForRealColumns(columnNames: string[]): ColumnTransformation[] {
  return columnNames.map((name): ColumnTransformation => {
    // The card-currency amount column carries the "(UAH)" suffix in the real export;
    // exclude the secondary "Сума в валюті операції" and the commission/cashback
    // amounts (which also start with "Сума") by matching the card-amount marker.
    const isCardAmount = name.includes('валюті картки');
    const isCommission = name.includes('комісій') || name.includes('Комісія');
    const isCashback = name.includes('кешбеку') || name.includes('Кешбек');

    if (name.includes('Дата')) {
      return { columnName: name, definition: ColumnDefinition.DATE, params: { format: 'auto' } as DateColumnParams };
    }
    if (name.includes('Деталі')) {
      return { columnName: name, definition: ColumnDefinition.DESCRIPTION, params: null };
    }
    if (name === 'MCC') {
      return { columnName: name, definition: ColumnDefinition.MERCHANT_CATEGORY, params: null };
    }
    if (isCardAmount) {
      return {
        columnName: name,
        definition: ColumnDefinition.AMOUNT,
        params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams,
      };
    }
    if (isCommission) {
      return { columnName: name, definition: ColumnDefinition.BANK_COMMISSION, params: { currency: { code: 'UAH' } } as BankCommissionColumnParams };
    }
    if (isCashback) {
      return { columnName: name, definition: ColumnDefinition.CASHBACK, params: { currency: { code: 'UAH' } } as CashbackColumnParams };
    }
    // Secondary amount / Валюта / Курс / Залишок after operation, etc.
    return { columnName: name, definition: ColumnDefinition.IGNORE, params: null };
  });
}

// ---------------------------------------------------------------------------
// DB harness — fresh DB per test (mirrors pipeline-e2e + warm-convert-seam).
// ---------------------------------------------------------------------------

let db: IDBDatabase;
let dbName: string;
let dbCounter = 0;

beforeEach(async () => {
  dbName = `real-statement-proof-${++dbCounter}`;
  db = await openDatabase(dbName, ENGINE_MIGRATIONS);
});

afterEach(async () => {
  if (db) db.close();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(dbName);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
  });
});

// ---------------------------------------------------------------------------
// Rate seeding: USD-base, UNITS-PER-USD (toAmountUSD divides). One row per
// distinct UTC operation day. Flat 36.5 UAH/USD — this proof asserts COUNT.
// ---------------------------------------------------------------------------

const FLAT_UAH_PER_USD = 36.5;

async function seedRatesForDates(dao: IDBExchangeRateDAO, rows: TransactionRow[]): Promise<number> {
  const seen = new Set<string>();
  for (const row of rows) {
    const day = row.date.toISOString().split('T')[0];
    if (seen.has(day)) continue;
    seen.add(day);
    const entity: ExchangeRateEntity = {
      base: 'USD',
      date: day,
      UAH: FLAT_UAH_PER_USD,
    };
    await dao.upsert(entity);
  }
  return seen.size;
}

// ---------------------------------------------------------------------------
// THE PROOF
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_FILE)('REAL monobank statement — zero-growth re-import (Task 4b)', () => {
  it('full pipeline → commitFootprints TWICE → store count UNCHANGED on the second commit', async () => {
    // 1. Read the LOCAL file and run the FULL pipeline (decode → service → stage2
    //    mapping → generateRows). The contents are READ only — written nowhere.
    const buf = readFileSync(REAL_STATEMENT_PATH);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const decodeResult = await decode({ bytes, fileName: 'real-statement.csv' });

    const service = new ImportStatementServiceImpl();
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;

    const colNames = (await firstValueFrom(stage2.columns)).map((c) => c.originalName.getText());
    const mapping = buildMappingForRealColumns(colNames);
    await applyMappings(stage2, mapping);

    const cols = await firstValueFrom(stage2.columns);
    const rowData: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    const genResult = await generateRows(rowData, toColumnInfo(cols), 'UAH');
    const rows: TransactionRow[] = genResult.rows;

    // Sanity: the real export must yield real rows (otherwise the mapping broke and
    // a "zero-growth" of 0→0 would be a hollow pass).
    expect(rows.length).toBeGreaterThan(0);
    expect(genResult.structuralErrors).toHaveLength(0);

    // 2. Seed USD-base rates for every distinct operation date. warm is a stub.
    const ratesDao = new IDBExchangeRateDAO(() => db);
    const distinctDays = await seedRatesForDates(ratesDao, rows);

    const footprintDao = new FootprintDao(() => db);
    const deps: CommitFootprintsDeps = {
      footprintDao,
      ratesDao,
      warm: async () => {
        /* stub — resolves; the seeded cache satisfies the loud convert gate */
      },
    };

    // 3. FIRST commit → record the store count.
    const commit1 = await commitFootprints(rows, deps);
    const count1 = (await footprintDao.getAll()).length;

    // 4. SECOND commit of the SAME rows → ZERO growth (native upsert overwrites).
    const commit2 = await commitFootprints(rows, deps);
    const count2 = (await footprintDao.getAll()).length;

    // 5. Informational (NOT asserted): in-month true-duplicate groups. The 3.2
    //    dup-counter wraps genuinely-repeated operations so that rows with identical
    //    BASE content within the same calendar month are kept as DISTINCT records
    //    (distinct final hashes). The witness for that wrapping is: how many footprint
    //    KEYS [hash,year,month] appear more than once across the generated rows — i.e.
    //    how many rows would otherwise have collapsed onto a shared key but were kept
    //    apart. We compare total rows against distinct [hash,year,month] keys; the
    //    surplus is the count of in-month duplicate survivors. Real data legitimately
    //    has some (or zero). Logged, never asserted.
    const keyCounts = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.hash}|${row.date.getUTCFullYear()}|${row.date.getUTCMonth() + 1}`;
      keyCounts.set(key, (keyCounts.get(key) ?? 0) + 1);
    }
    const distinctKeys = keyCounts.size;
    // # of rows beyond the first that share a footprint key (would overwrite in-store).
    const inMonthDupSurvivors = rows.length - distinctKeys;
    // # of distinct keys that host more than one row (the "duplicate groups").
    let inMonthDupGroups = 0;
    for (const n of keyCounts.values()) {
      if (n > 1) inMonthDupGroups++;
    }

    console.info(
      `[real-statement-proof] RAN LIVE on "${REAL_STATEMENT_PATH}":\n` +
        `  pipeline rows          = ${rows.length}\n` +
        `  distinct op-dates      = ${distinctDays} (rates seeded)\n` +
        `  distinct footprint keys= ${distinctKeys} ([hash,year,month])\n` +
        `  commit1.written        = ${commit1.written}\n` +
        `  commit2.written        = ${commit2.written}\n` +
        `  store count after #1   = ${count1}\n` +
        `  store count after #2   = ${count2}  (ZERO growth ⇒ ${count2 === count1})\n` +
        `  in-month duplicate groups   = ${inMonthDupGroups} (distinct keys hosting >1 row)\n` +
        `  in-month duplicate survivors= ${inMonthDupSurvivors} (rows beyond first per key)\n` +
        `  ^ informational — real data legitimately has some (or zero); NOT asserted`
    );

    // THE ASSERTION: zero growth on the second commit (idempotent upsert).
    expect(count2).toBe(count1);
    expect(count1).toBeGreaterThan(0);
    expect(commit2.written).toBe(commit1.written);
  });
});
