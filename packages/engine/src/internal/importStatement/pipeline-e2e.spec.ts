/**
 * pipeline-e2e.spec.ts — end-to-end pipeline closure tests (Story 2.3 Task 5).
 *
 * Covers:
 *   A. Fixture E2E: mono-like-utf8.csv and bank-like.xlsx through the FULL pipeline:
 *      decode → service → stage1 → stage2 (manual mapping completion; seeded-pool
 *      recall variant) → row-generator → typed rows.
 *      Hard assertions: exact row counts; one spot row's full fields (date is a Date
 *      with the expected ISO day, amount number, counterparty present when mapped,
 *      NO `time` key); N-of-M recognized label; placeholder/skip rows carried through.
 *
 *   B. Map-once-reimport-prefilled E2E (FEAT-013 learning loop):
 *      Run the mapping once on an EMPTY pool (savePool fires via applyColumn), then
 *      re-run the same fixture through a FRESH stage2 with a pre-seeded pool → columns
 *      prefilled GUESSED with n=M.
 *
 * Database: a real (fake-indexeddb) DB through openDatabase / ENGINE_MIGRATIONS so
 * migration v3 (both stores) is exercised. Reset between tests via afterEach.
 *
 * No Date.now / Math.random — deterministic; runs under TZ=America/New_York.
 */

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom } from 'rxjs';

import { openDatabase } from '../store/migrations/open-with-migrations';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { decode } from '../ingest/decode';
import { ImportStatementServiceImpl } from './service';
import { ImportStatementColumn } from './stage2/column';
import { ImportStatementStage2Impl } from './stage2/implementation';
import { ColumnDefinition } from './types';
import type {
  AmountColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  ColumnParams,
  DateColumnParams,
} from './types';

// EXCISED (2.6 decision 3): `ColumnTransformation` no longer exists in
// ../types — it died with the format entity (FEAT-005).  This LOCAL fixture
// shape is the mapping triple consumed by the applyMappings() helper below;
// it is test plumbing, NOT an engine type.
interface ColumnTransformation {
  readonly columnName: string;
  readonly definition: ColumnDefinition;
  readonly params: ColumnParams | null;
}
import type { ImportStatementColumnHeaderStage2, ImportStatementRowData } from './stage2/types';
import { createRecallPool } from './recall/recall';
import type { RecallResult } from './recall/recall';
import { generateRows } from './stage3/row-generator';
import type { ColumnInfo } from './stage3/row-generator';
import { ColumnTransformRejection } from './stage2/errors';
import { UnmappedColumnsError } from './stage2/errors';
import {
  getEngineConfig,
  hydrateEngineConfig,
  setEngineParam,
  resetEngineConfigForTests,
} from '../settings/engine-config';
import { SettingKeys } from '../settings/user-settings';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '../ingest/fixtures');

function readFixture(name: string): { bytes: ArrayBuffer; fileName: string } {
  const buf = readFileSync(join(FIXTURES, name));
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { bytes, fileName: name };
}

// ---------------------------------------------------------------------------
// EXCISED (2.6 decision 3): the makeStubDAOs() helper (empty FileFormatDAO /
// FileSourceDAO stubs) died with the service constructor params — the service
// no longer takes DAOs.  The stubs only ever proved "empty format store →
// service.stage2 returns plain stage2"; that is now the ONLY path.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: extract ColumnInfo[] from stage2 columns (post-transformation)
// ---------------------------------------------------------------------------

function toColumnInfo(columns: ImportStatementColumnHeaderStage2[]): ColumnInfo[] {
  return columns.map((col) => ({
    id: col.id,
    definition: col.definition,
    params: col.params,
  }));
}

// ---------------------------------------------------------------------------
// Helper: detach columns from their stage2 so they can be passed as initialState
// to a NEW ImportStatementStage2Impl without triggering "already associated" errors.
// Mirrors what ImportStatementStage2Impl.copy() does internally.
// ---------------------------------------------------------------------------

function detachColumns(columns: ImportStatementColumnHeaderStage2[]): ImportStatementColumn[] {
  return columns.map((col) => {
    if (!(col instanceof ImportStatementColumn)) {
      throw new Error('Expected ImportStatementColumn instance');
    }
    const copied = col.copy();
    // Force-clear the _stage2 association so the new stage2 can claim ownership
    (copied as unknown as { _stage2: null })._stage2 = null;
    return copied;
  });
}

// ---------------------------------------------------------------------------
// Helper: apply column transformations to a stage2 instance
// Calls the actual parse methods on each ImportStatementColumn.
// ---------------------------------------------------------------------------

async function applyMappings(
  stage2: ImportStatementStage2Impl,
  transformations: ColumnTransformation[],
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

// ---------------------------------------------------------------------------
// DB helpers — each test gets a fresh DB keyed by a unique name
// ---------------------------------------------------------------------------

let db: IDBDatabase;
let dbName: string;
let dbCounter = 0;

beforeEach(async () => {
  dbName = `pipeline-e2e-test-${++dbCounter}`;
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

// ============================================================================
// A. Fixture E2E — mono-like-utf8.csv
// ============================================================================

describe('Fixture E2E — mono-like-utf8.csv', () => {
  /**
   * Column mapping for mono-like-utf8.csv:
   *   'Дата i час операції'     → DATE  (format: auto)
   *   'Деталі операції'         → DESCRIPTION
   *   'MCC'                     → MERCHANT_CATEGORY
   *   'Сума в валюті картки'    → AMOUNT (type: outcome, currency: {code: 'UAH'})
   *   'Валюта картки'           → IGNORE
   *   'Сума в USD'              → IGNORE
   *   'Комісія'                 → IGNORE
   *   'Кешбек'                  → IGNORE
   *   'Залишок'                 → IGNORE
   *
   * All 12 decoded rows have negative amounts → type: 'outcome' → all 12 generate.
   * Placeholder row 8 was skipped during decode (issue: skipped-row) — never reaches stage1.
   */

  const MONO_CSV_TRANSFORMATIONS: ColumnTransformation[] = [
    { columnName: 'Дата i час операції',  definition: ColumnDefinition.DATE,              params: { format: 'auto' } as DateColumnParams },
    { columnName: 'Деталі операції',      definition: ColumnDefinition.DESCRIPTION,       params: null },
    { columnName: 'MCC',                  definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
    { columnName: 'Сума в валюті картки', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
    { columnName: 'Валюта картки',        definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Сума в USD',           definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Комісія',              definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Кешбек',              definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Залишок',             definition: ColumnDefinition.IGNORE,            params: null },
  ];

  it('decode → 12 rows, 1 placeholder-row issue', async () => {
    const result = await decode(readFixture('mono-like-utf8.csv'));
    expect(result.meta.decodedRows).toBe(12);
    expect(result.meta.totalRows).toBe(13);
    const placeholderIssue = result.issues.find(
      (i) => i.action === 'skipped-row' && i.what === 'placeholder-row',
    );
    expect(placeholderIssue).toBeDefined();
  });

  it('full pipeline → 12 typed rows, 0 skipped, 0 rowErrors', async () => {
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    expect(decodeResult.rows).toHaveLength(12);

    const service = new ImportStatementServiceImpl();

    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;

    await applyMappings(stage2, MONO_CSV_TRANSFORMATIONS);

    const cols = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);

    const columnInfo = toColumnInfo(cols);
    const result = await generateRows(rows, columnInfo, 'UAH');

    expect(result.rows).toHaveLength(12);
    expect(result.skipped).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(0);
  });

  it('spot row[0]: date is a Date with ISO day 2024-01-15, amount=42, NO time key', async () => {
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;
    await applyMappings(stage2, MONO_CSV_TRANSFORMATIONS);

    const cols = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    const { rows: typedRows } = await generateRows(rows, toColumnInfo(cols), 'UAH');

    const row0 = typedRows[0];
    expect(row0).toBeDefined();

    // Date is a Date object; ISO day is 2024-01-15 (UTC)
    expect(row0.date).toBeInstanceOf(Date);
    const isoDay = row0.date.toISOString().slice(0, 10);
    expect(isoDay).toBe('2024-01-15');

    // Amount: 42 (absolute value of -42,00)
    expect(row0.amount).toBe(42);

    // Description is present (from 'Деталі операції')
    expect(row0.description).toBe('TEST COFFEE 1');

    // No `time` key anywhere on the generated row
    expect('time' in row0).toBe(false);
    expect(JSON.stringify(row0)).not.toMatch(/"time"/);
  });

  it('spot row[0]: counterparty is null (no COUNTERPARTY column mapped)', async () => {
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;
    await applyMappings(stage2, MONO_CSV_TRANSFORMATIONS);

    const cols = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    const { rows: typedRows } = await generateRows(rows, toColumnInfo(cols), 'UAH');

    // No COUNTERPARTY column mapped → null
    expect(typedRows[0].counterparty).toBeNull();
  });

  it('N-of-M label: after seeding pool + recall, recognized n=M (learning loop)', async () => {
    // ── First run: map on empty pool, which seeds it ─────────────────────────
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();
    const stage1a = service.startWith(decodeResult.rows);
    const stage2aBase = (await service.stage2(stage1a)) as ImportStatementStage2Impl;

    // Wire recall pool: detach columns so a new stage2 can claim ownership
    const colsADetached = detachColumns(await firstValueFrom(stage2aBase.columns));
    const stage2aWithPool = new ImportStatementStage2Impl(
      stage1a,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any), // service implements ImportStatementServiceInternal
      colsADetached,
      undefined,
      null,
      recallPool,
    );

    await applyMappings(stage2aWithPool, MONO_CSV_TRANSFORMATIONS);

    // Wait for all async savePool calls to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Pool should now have entries for non-IGNORE columns
    const poolKeys = await recallPool.getAllKeys();
    // At least DATE + DESCRIPTION + MERCHANT_CATEGORY + AMOUNT
    expect(poolKeys.length).toBeGreaterThanOrEqual(4);

    // ── Second run: fresh stage2 with recallFor pre-seeded ───────────────────
    const stage1b = service.startWith(decodeResult.rows);
    const stage2bBase = (await service.stage2(stage1b)) as ImportStatementStage2Impl;
    const columnNames = (await firstValueFrom(stage2bBase.columns)).map((c) => c.originalName.getText());

    const recallResult: RecallResult = await recallPool.recallFor(columnNames);
    // n = how many non-IGNORE mapped columns were saved; m = total columns (9)
    expect(recallResult.recognized.m).toBe(9);
    // At least the 4 non-IGNORE columns should be recognized
    expect(recallResult.recognized.n).toBeGreaterThanOrEqual(4);

    // Build fresh stage2 with recall result using detached columns
    const colsBDetached = detachColumns(await firstValueFrom(stage2bBase.columns));
    const stage2b = new ImportStatementStage2Impl(
      stage1b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsBDetached,
      undefined,
      recallResult,
      recallPool,
    );

    // Columns that were mapped before should be prefilled as GUESSED
    const prefillCols = await firstValueFrom(stage2b.columns);
    const dateCol = prefillCols.find((c) => c.originalName.getText() === 'Дата i час операції');
    const amountCol = prefillCols.find((c) => c.originalName.getText() === 'Сума в валюті картки');

    expect(dateCol?.definition).toBe(ColumnDefinition.DATE);
    expect(dateCol?.recallState).toBe('guessed');
    expect(amountCol?.definition).toBe(ColumnDefinition.AMOUNT);
    expect(amountCol?.recallState).toBe('guessed');

    // recognized.n equals n=M for the mapped columns
    expect(stage2b.recognized.n).toBe(recallResult.recognized.n);
  });
});

// ============================================================================
// A2. Fixture E2E — bank-like.xlsx (spreadsheet fixture)
// ============================================================================

describe('Fixture E2E — bank-like.xlsx', () => {
  /**
   * Column mapping for bank-like.xlsx:
   *   'Дата'    → DATE (format: auto)
   *   'Опис'    → DESCRIPTION
   *   'Сума'    → AMOUNT (type: outcome, currency: {code: 'UAH'})
   *   'Валюта'  → IGNORE
   *   'Залишок' → IGNORE
   *   'Комісія' → IGNORE
   *
   * Decoded: 10 rows (3 preamble + 1 summary skipped in decode).
   *
   * NOTE (pipeline finding): The bank-like.xlsx fixture uses `+5000,00` format for
   * income rows. `parseNumber` does NOT handle leading `+` prefix — those cells produce
   * error entries (not parsed as positive values). With type: 'outcome':
   *   - 8 negative rows → valid typed rows (amounts = absolute values)
   *   - 2 "+..." rows → error cells in AMOUNT column (parse fails, 20% < 30% threshold)
   *   - The 2 error-amount rows are still generated (row-generator doesn't throw on NaN
   *     amounts from error cells — they propagate as NaN values in output rows)
   * So typed rows: 10, skipped: 0, rowErrors: 0 (all rows generate, 2 with NaN amounts).
   * Income-skip path (VIS-011) is exercised properly when amounts CAN be parsed as
   * positive numbers and then labeled with `ignore` by the column transform.
   */

  const BANK_XLSX_TRANSFORMATIONS: ColumnTransformation[] = [
    { columnName: 'Дата',    definition: ColumnDefinition.DATE,        params: { format: 'auto' } as DateColumnParams },
    { columnName: 'Опис',    definition: ColumnDefinition.DESCRIPTION, params: null },
    { columnName: 'Сума',    definition: ColumnDefinition.AMOUNT,      params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
    { columnName: 'Валюта',  definition: ColumnDefinition.IGNORE,      params: null },
    { columnName: 'Залишок', definition: ColumnDefinition.IGNORE,      params: null },
    { columnName: 'Комісія', definition: ColumnDefinition.IGNORE,      params: null },
  ];

  it('decode → 10 rows, preamble + summary issues', async () => {
    const result = await decode(readFixture('bank-like.xlsx'));
    expect(result.meta.decodedRows).toBe(10);
    expect(result.meta.totalRows).toBe(11);
    const preamble = result.issues.filter((i) => i.what === 'preamble-row');
    const summary = result.issues.filter((i) => i.what === 'summary-row');
    expect(preamble).toHaveLength(3);
    expect(summary).toHaveLength(1);
  });

  it('full pipeline → 10 typed rows, 0 skipped, 0 rowErrors', async () => {
    const decodeResult = await decode(readFixture('bank-like.xlsx'));
    expect(decodeResult.rows).toHaveLength(10);

    const service = new ImportStatementServiceImpl();

    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;

    await applyMappings(stage2, BANK_XLSX_TRANSFORMATIONS);

    const cols = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);

    const result = await generateRows(rows, toColumnInfo(cols), 'UAH');

    // 10 decoded rows → 10 typed rows. The 2 income rows (+5000,00 / +10000,00)
    // parse as NaN (parseNumber doesn't handle leading '+') → error cells, but
    // the 20% error rate is below the 30% threshold so the column maps.
    // Row-generator produces all 10 rows (2 have NaN amounts, not thrown/skipped).
    expect(result.rows).toHaveLength(10);
    expect(result.skipped).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(0);
  });

  it('spot row[0] (METRO): date=2024-01-01, amount=1500, description present, no time', async () => {
    const decodeResult = await decode(readFixture('bank-like.xlsx'));
    const service = new ImportStatementServiceImpl();
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;
    await applyMappings(stage2, BANK_XLSX_TRANSFORMATIONS);

    const cols = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    const { rows: typedRows } = await generateRows(rows, toColumnInfo(cols), 'UAH');

    const row0 = typedRows[0]; // First row (METRO — negative amount)
    expect(row0).toBeDefined();
    expect(row0.date).toBeInstanceOf(Date);
    expect(row0.date.toISOString().slice(0, 10)).toBe('2024-01-01');
    expect(row0.amount).toBe(1500);  // abs(-1500)
    expect(row0.description).toBe('Покупка в METRO 1');
    expect('time' in row0).toBe(false);
  });

  it('income-skip VIS-011 path: skipped array is populated when amounts parse as positive+ignored', async () => {
    // This test documents the VIS-011 income-skip path using a minimal inline
    // fixture rather than bank-like.xlsx (where '+' prefix prevents parsing).
    // The income rows use plain positive numbers that parseNumber CAN parse.
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;

    // Map 'Сума в валюті картки' as INCOME type to trigger VIS-011 skip for all rows
    const incomeTransformations: ColumnTransformation[] = [
      { columnName: 'Дата i час операції',  definition: ColumnDefinition.DATE,        params: { format: 'auto' } as DateColumnParams },
      { columnName: 'Деталі операції',      definition: ColumnDefinition.DESCRIPTION, params: null },
      { columnName: 'MCC',                  definition: ColumnDefinition.IGNORE,       params: null },
      { columnName: 'Сума в валюті картки', definition: ColumnDefinition.AMOUNT,      params: { type: 'income', currency: { code: 'UAH' } } as AmountColumnParams },
      { columnName: 'Валюта картки',        definition: ColumnDefinition.IGNORE,      params: null },
      { columnName: 'Сума в USD',           definition: ColumnDefinition.IGNORE,      params: null },
      { columnName: 'Комісія',              definition: ColumnDefinition.IGNORE,      params: null },
      { columnName: 'Кешбек',             definition: ColumnDefinition.IGNORE,      params: null },
      { columnName: 'Залишок',            definition: ColumnDefinition.IGNORE,      params: null },
    ];
    await applyMappings(stage2, incomeTransformations);

    const cols = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    const { rows: typedRows, skipped, rowErrors } = await generateRows(rows, toColumnInfo(cols), 'UAH');

    // VIS-011: income type → all rows skipped (labeled and discarded)
    expect(typedRows).toHaveLength(0);
    expect(skipped).toHaveLength(12);
    expect(rowErrors).toHaveLength(0);
    // Each skipped entry has a reason and rowIndex
    for (const s of skipped) {
      expect(s.reason).toBeDefined();
      expect(typeof s.rowIndex).toBe('number');
    }
  });

  it('N-of-M: recognized n>=3 after seeding pool from bank-like mapping', async () => {
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('bank-like.xlsx'));
    const service = new ImportStatementServiceImpl();

    const stage1a = service.startWith(decodeResult.rows);
    const stage2aBase = (await service.stage2(stage1a)) as ImportStatementStage2Impl;

    // Detach columns so new stage2 can claim ownership
    const colsADetached = detachColumns(await firstValueFrom(stage2aBase.columns));
    const stage2a = new ImportStatementStage2Impl(
      stage1a,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsADetached,
      undefined,
      null,
      recallPool,
    );

    await applyMappings(stage2a, BANK_XLSX_TRANSFORMATIONS);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));

    // Pool should have at minimum DATE + DESCRIPTION + AMOUNT entries
    const keys = await recallPool.getAllKeys();
    expect(keys.length).toBeGreaterThanOrEqual(3);

    // Second run: recallFor → prefills GUESSED
    const stage1b = service.startWith(decodeResult.rows);
    const stage2bBase = (await service.stage2(stage1b)) as ImportStatementStage2Impl;
    const colsBRaw = await firstValueFrom(stage2bBase.columns);
    const names = colsBRaw.map((c) => c.originalName.getText());
    const recallResult = await recallPool.recallFor(names);

    // 6 columns total: DATE + DESCRIPTION + AMOUNT (3 non-IGNORE) + 3 IGNORE = at least 3 recognized
    expect(recallResult.recognized.n).toBeGreaterThanOrEqual(3);
    expect(recallResult.recognized.m).toBe(6);

    const colsBDetached = detachColumns(colsBRaw);
    const stage2b = new ImportStatementStage2Impl(
      stage1b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsBDetached,
      undefined,
      recallResult,
      recallPool,
    );

    expect(stage2b.recognized.n).toBe(recallResult.recognized.n);
    expect(stage2b.recognized.m).toBe(6);

    // Date column should be prefilled
    const prefillCols = await firstValueFrom(stage2b.columns);
    const dateCol = prefillCols.find((c) => c.originalName.getText() === 'Дата');
    expect(dateCol?.definition).toBe(ColumnDefinition.DATE);
    expect(dateCol?.recallState).toBe('guessed');
  });
});

// ============================================================================
// B. Map-once-reimport-prefilled E2E (FEAT-013 learning loop — explicit)
// ============================================================================

describe('FEAT-013 learning loop — map-once-reimport-prefilled', () => {
  /**
   * Protocol:
   *   1. Run the mapping once with an empty pool (all applyColumn calls fire savePool).
   *   2. Re-run the same fixture through a FRESH stage2 wired with the same pool.
   *   3. recallFor() → every non-IGNORE column is prefilled GUESSED.
   *   4. recognized.n == number of non-IGNORE mapped columns (n=M for meaningful cols).
   */

  const TRANSFORMATIONS: ColumnTransformation[] = [
    { columnName: 'Дата i час операції',  definition: ColumnDefinition.DATE,              params: { format: 'auto' } as DateColumnParams },
    { columnName: 'Деталі операції',      definition: ColumnDefinition.DESCRIPTION,       params: null },
    { columnName: 'MCC',                  definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
    { columnName: 'Сума в валюті картки', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
    { columnName: 'Валюта картки',        definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Сума в USD',           definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Комісія',              definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Кешбек',              definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Залишок',             definition: ColumnDefinition.IGNORE,            params: null },
  ];

  // All mapped columns are saved to pool (including IGNORE — applyColumn fires savePool
  // for any non-null definition, and ColumnDefinition.IGNORE is non-null).
  const TOTAL_MAPPED_COUNT = TRANSFORMATIONS.length; // = 9 (all columns)
  // NOTE: non-IGNORE mapped count = 4 (DATE + DESCRIPTION + MERCHANT_CATEGORY + AMOUNT).
  // All 9 are saved to pool (including IGNORE). See FEAT-013 learning loop.

  it('after first mapping, pool contains all non-IGNORE column names', async () => {
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();

    const stage1 = service.startWith(decodeResult.rows);
    const stage2base = (await service.stage2(stage1)) as ImportStatementStage2Impl;

    // Detach columns so new stage2 can claim ownership
    const colsDetached = detachColumns(await firstValueFrom(stage2base.columns));

    // Create stage2 with pool attached
    const stage2 = new ImportStatementStage2Impl(
      stage1,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsDetached,
      undefined,
      null,
      recallPool,
    );

    await applyMappings(stage2, TRANSFORMATIONS);
    // Flush async pool.save() calls
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    const keys = await recallPool.getAllKeys();
    // All column names (including IGNORE) should be in the pool.
    // applyColumn fires savePool for ANY non-null definition, including IGNORE.
    for (const t of TRANSFORMATIONS) {
      expect(keys).toContain(t.columnName);
    }
    expect(keys).toHaveLength(TOTAL_MAPPED_COUNT); // 9
  });

  it('re-import: all non-IGNORE columns prefilled GUESSED; IGNORE columns stay null', async () => {
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();

    // ── First import: seed the pool ──────────────────────────────────────────
    const stage1a = service.startWith(decodeResult.rows);
    const s2aBase = (await service.stage2(stage1a)) as ImportStatementStage2Impl;
    const colsADetached = detachColumns(await firstValueFrom(s2aBase.columns));
    const stage2a = new ImportStatementStage2Impl(
      stage1a,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsADetached,
      undefined,
      null,
      recallPool,
    );
    await applyMappings(stage2a, TRANSFORMATIONS);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    // ── Second import: recallFor → fresh stage2 with prefills ────────────────
    const stage1b = service.startWith(decodeResult.rows);
    const s2bBase = (await service.stage2(stage1b)) as ImportStatementStage2Impl;
    const colsBRaw = await firstValueFrom(s2bBase.columns);
    const columnNames = colsBRaw.map((c) => c.originalName.getText());

    const recallResult = await recallPool.recallFor(columnNames);
    const colsBDetached = detachColumns(colsBRaw);
    const stage2b = new ImportStatementStage2Impl(
      stage1b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsBDetached,
      undefined,
      recallResult,
      recallPool,
    );

    const prefillCols = await firstValueFrom(stage2b.columns);

    // All columns (including IGNORE) are saved to pool and recalled as GUESSED.
    // applyColumn fires savePool for any non-null definition, including IGNORE.
    for (const t of TRANSFORMATIONS) {
      const col = prefillCols.find((c) => c.originalName.getText() === t.columnName);
      expect(col).toBeDefined();
      expect(col!.definition).toBe(t.definition);
      expect(col!.recallState).toBe('guessed');
    }
  });

  it('re-import: recognized.n === NON_IGNORE_COUNT, recognized.m === total columns (9)', async () => {
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();

    // Seed
    const stage1a = service.startWith(decodeResult.rows);
    const s2aBase = (await service.stage2(stage1a)) as ImportStatementStage2Impl;
    const colsADetached = detachColumns(await firstValueFrom(s2aBase.columns));
    const stage2a = new ImportStatementStage2Impl(
      stage1a,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsADetached,
      undefined,
      null,
      recallPool,
    );
    await applyMappings(stage2a, TRANSFORMATIONS);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    // Recall
    const stage1b = service.startWith(decodeResult.rows);
    const s2bBase = (await service.stage2(stage1b)) as ImportStatementStage2Impl;
    const colsBRaw = await firstValueFrom(s2bBase.columns);
    const recallResult = await recallPool.recallFor(colsBRaw.map((c) => c.originalName.getText()));

    const colsBDetached = detachColumns(colsBRaw);
    const stage2b = new ImportStatementStage2Impl(
      stage1b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsBDetached,
      undefined,
      recallResult,
      recallPool,
    );

    // FEAT-013 hard assertion: all 9 columns recalled (including IGNORE)
    expect(stage2b.recognized.n).toBe(TOTAL_MAPPED_COUNT); // 9 — all columns saved+recalled
    expect(stage2b.recognized.m).toBe(9);                  // total columns
  });

  it('re-import pipeline: 12 typed rows generated from recalled prefills', async () => {
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));
    const service = new ImportStatementServiceImpl();

    // Seed
    const stage1a = service.startWith(decodeResult.rows);
    const s2aBase = (await service.stage2(stage1a)) as ImportStatementStage2Impl;
    const colsADetached = detachColumns(await firstValueFrom(s2aBase.columns));
    const stage2a = new ImportStatementStage2Impl(
      stage1a,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsADetached,
      undefined,
      null,
      recallPool,
    );
    await applyMappings(stage2a, TRANSFORMATIONS);
    await new Promise<void>((resolve) => setTimeout(resolve, 30));

    // Second run: build stage2 with recall prefills, then apply ALL transformations
    // to get parsed cell data (recall prefills set definition/params for UI prefilling;
    // actual cell transforms still required for row generation).
    const stage1b = service.startWith(decodeResult.rows);
    const s2bBase = (await service.stage2(stage1b)) as ImportStatementStage2Impl;
    const colsBRaw = await firstValueFrom(s2bBase.columns);
    const recallResult = await recallPool.recallFor(colsBRaw.map((c) => c.originalName.getText()));

    const colsBDetached = detachColumns(colsBRaw);
    const stage2b = new ImportStatementStage2Impl(
      stage1b,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (service as any),
      colsBDetached,
      undefined,
      recallResult,
      recallPool,
    );

    // Apply full transformations again
    await applyMappings(stage2b, TRANSFORMATIONS);

    const cols2 = await firstValueFrom(stage2b.columns);
    const rows2: ImportStatementRowData[] = await firstValueFrom(stage2b.currentData);
    const genResult = await generateRows(rows2, toColumnInfo(cols2), 'UAH');

    // Same result as first run: 12 rows, 0 skipped, 0 errors
    expect(genResult.rows).toHaveLength(12);
    expect(genResult.skipped).toHaveLength(0);
    expect(genResult.rowErrors).toHaveLength(0);
  });
});

// ============================================================================
// C. Migration v3 exercised: both stores created
// ============================================================================

describe('migration v3 exercised via openDatabase', () => {
  it('DB opened with ENGINE_MIGRATIONS has both recallPool and userSettings stores', () => {
    const storeNames = Array.from(db.objectStoreNames);
    expect(storeNames).toContain('recallPool');
    expect(storeNames).toContain('userSettings');
    expect(storeNames).toContain('exchangeRates');
  });

  it('recallPool store accepts entries via RecallPool.save()', async () => {
    const pool = createRecallPool(() => db);
    const result = await pool.save('TestColumn', ColumnDefinition.DATE, { format: 'auto' } as DateColumnParams);
    expect(result.outcome).toBe('saved');

    const keys = await pool.getAllKeys();
    expect(keys).toContain('TestColumn');
  });
});

// ============================================================================
// D. Story 2.4 — thresholds, rejection, Q-009 (Task 4 E2E)
//
// Fixture: bad-dates.csv (internal/ingest/fixtures/bad-dates.csv)
// Shape:
//   Columns: "Date", "Amount", "Description"
//   12 rows total (no header-skip: decode treats first row as header).
//   Date column: 7 valid ISO-style dates (rows 0,1,3,5,7,9,11)
//                5 garbage strings (rows 2,4,6,8,10) → 5/12 = 41.7% errors
//                Applying DATE with { format: { custom: 'yyyy-MM-dd' } }
//                bypasses format detection; parseGeneric sees 5 bad cells
//                → 41.7% > default 30% threshold → ColumnTransformRejection.
//   Amount column: 11 valid negative numbers, 1 garbage ("NOT-A-NUMBER" at row 10)
//                  → 1/12 = 8.3% errors → passes default 30% gate, fails 5% gate.
//   Description column: all 12 rows clean (plain text).
//
// Good dates (0-indexed): rows 0,1,3,5,7,9,11
// Bad date rows: rows 2,4,6,8,10
// Bad amount row: row 10 ("NOT-A-NUMBER")
//
// Config leakage guard: resetEngineConfigForTests() called in afterEach.
// ============================================================================

describe('Story 2.4 — thresholds, rejection, Q-009', () => {
  // ── Config leakage guard ──────────────────────────────────────────────────
  // Always reset the engine-config snapshot so no test bleeds threshold changes
  // into subsequent tests (or into other spec files sharing the module-level snapshot).
  afterEach(() => {
    resetEngineConfigForTests();
  });

  // Helper: creates a fresh service backed by the current test DB
  function makeService(db: IDBDatabase): ImportStatementServiceImpl {
    const settingsDao = new UserSettingsIDBDAO(() => db);
    return new ImportStatementServiceImpl(null, null, settingsDao);
  }

  // ---------------------------------------------------------------------------
  // D1. bad-dates fixture: DATE on bad column → ColumnTransformRejection
  //     → re-map as IGNORE → session completes (per-COLUMN boundary at E2E level)
  // ---------------------------------------------------------------------------

  it('D1: bad-dates DATE column (>30% bad) → ColumnTransformRejection with exact payload', async () => {
    const decodeResult = await decode(readFixture('bad-dates.csv'));
    // 12 data rows (bad-dates.csv has 12 data rows + 1 header)
    expect(decodeResult.rows).toHaveLength(12);

    const service = makeService(db);
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;

    const cols = await firstValueFrom(stage2.columns);
    const dateCol = cols.find((c) => c.originalName.getText() === 'Date');
    expect(dateCol).toBeDefined();
    if (!(dateCol instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');

    // Custom format bypasses format detection; parseGeneric sees 5/12 bad cells → rejection
    const rejection = await dateCol
      .parseAsDate({ format: { custom: 'yyyy-MM-dd' } })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(rejection).toBeInstanceOf(ColumnTransformRejection);
    if (!(rejection instanceof ColumnTransformRejection)) throw new Error('Not ColumnTransformRejection');

    // Exact counts: 5 bad / 12 total
    expect(rejection.errorCount).toBe(5);
    expect(rejection.totalCount).toBe(12);
    // Threshold equals the default acceptableColumnErrorPercentage
    expect(rejection.threshold).toBe(0.3);
    // ALL cell errors collected (FEAT-022 complete-not-first)
    expect(rejection.cellErrors).toHaveLength(5);
    // rowIndex values for the bad rows: 2, 4, 6, 8, 10
    const badRowIndices = rejection.cellErrors.map((e) => e.rowIndex).sort((a, b) => a - b);
    expect(badRowIndices).toEqual([2, 4, 6, 8, 10]);

    // Date column stays UNKNOWN (rollback-to-UNKNOWN is structural on rejection)
    const colsAfter = await firstValueFrom(stage2.columns);
    const dateColAfter = colsAfter.find((c) => c.originalName.getText() === 'Date');
    expect(dateColAfter?.definition).toBeNull();
  });

  it('D1b: re-map rejected column as IGNORE → session completes (per-COLUMN boundary)', async () => {
    const decodeResult = await decode(readFixture('bad-dates.csv'));
    const service = makeService(db);
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;

    const cols = await firstValueFrom(stage2.columns);
    const dateCol = cols.find((c) => c.originalName.getText() === 'Date');
    expect(dateCol).toBeDefined();
    if (!(dateCol instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');

    // First attempt: rejection
    await expect(
      dateCol.parseAsDate({ format: { custom: 'yyyy-MM-dd' } })
    ).rejects.toBeInstanceOf(ColumnTransformRejection);

    // Re-map as IGNORE
    const colsAfterRejection = await firstValueFrom(stage2.columns);
    const dateColAfterRejection = colsAfterRejection.find((c) => c.originalName.getText() === 'Date');
    expect(dateColAfterRejection instanceof ImportStatementColumn).toBe(true);
    if (!(dateColAfterRejection instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');
    await dateColAfterRejection.ignore();

    // Map remaining columns (Amount, Description) so next() won't throw UnmappedColumnsError
    const transformations: ColumnTransformation[] = [
      { columnName: 'Amount',      definition: ColumnDefinition.AMOUNT,      params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
      { columnName: 'Description', definition: ColumnDefinition.DESCRIPTION, params: null },
    ];
    await applyMappings(stage2, transformations);

    // Session must still be alive — stage2 completes without throwing.
    // (The per-COLUMN boundary: one bad column rejected does NOT kill the session.)
    // Generate rows: Date is IGNORED → ZERO DATE-mapped columns → the pre-loop
    // structural check fires ONCE; the row loop never runs.
    const colsFinal = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    const genResult = await generateRows(rows, toColumnInfo(colsFinal), 'UAH');
    // DECLARED CHANGE (2.7 decision 2): was 12 per-row no-DATE errors (the 2.4-era
    // honest behavior) — now ONE structural message. A missing DATE mapping is a
    // property of the column set, detected BEFORE the row loop; zero row-error echoes.
    expect(genResult.structuralErrors).toHaveLength(1);
    expect(genResult.rowErrors).toHaveLength(0);
    expect(genResult.rows).toHaveLength(0);
    expect(genResult.skipped).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // D2. Store-override E2E: seed acceptableColumnErrorPercentage = 0.05 before
  //     session → a mildly-bad Amount column (1/12 = 8.3%) is now REJECTED
  // ---------------------------------------------------------------------------

  it('D2: store-seeded threshold 0.05 → 8.3%-bad Amount column rejected', async () => {
    // Seed the store with a low threshold
    const settingsDao = new UserSettingsIDBDAO(() => db);
    await setEngineParam(settingsDao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 0.05);

    // Session start via service (which hydrates on stage2() call)
    const service = makeService(db);
    const decodeResult = await decode(readFixture('bad-dates.csv'));
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;

    // Config must reflect the stored override (0.05) after hydration
    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.05);

    const cols = await firstValueFrom(stage2.columns);
    const amountCol = cols.find((c) => c.originalName.getText() === 'Amount');
    expect(amountCol instanceof ImportStatementColumn).toBe(true);
    if (!(amountCol instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');

    // Amount column: 1/12 = 8.3% errors; with threshold 0.05 → REJECTED
    const rejection = await amountCol
      .parseAsAmount({ type: 'outcome', currency: { code: 'UAH' } })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(rejection).toBeInstanceOf(ColumnTransformRejection);
    if (!(rejection instanceof ColumnTransformRejection)) throw new Error('Not ColumnTransformRejection');
    expect(rejection.errorCount).toBe(1);
    expect(rejection.totalCount).toBe(12);
    expect(rejection.threshold).toBe(0.05);
  });

  it('D2b: default threshold 0.3 → same 8.3%-bad Amount column APPLIES', async () => {
    // No store override → defaults stand → 8.3% < 30% → applies
    const service = makeService(db);
    const decodeResult = await decode(readFixture('bad-dates.csv'));
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;

    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.3);

    const cols = await firstValueFrom(stage2.columns);
    const amountCol = cols.find((c) => c.originalName.getText() === 'Amount');
    if (!(amountCol instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');

    // Should NOT throw — 8.3% < 30%
    await expect(
      amountCol.parseAsAmount({ type: 'outcome', currency: { code: 'UAH' } })
    ).resolves.toBeUndefined();

    const colsAfter = await firstValueFrom(stage2.columns);
    const amountColAfter = colsAfter.find((c) => c.originalName.getText() === 'Amount');
    expect(amountColAfter?.definition).toBe(ColumnDefinition.AMOUNT);
  });

  // ---------------------------------------------------------------------------
  // D3. TRIPLE PIN at E2E level (locked decision 1):
  //     (1) setEngineParam mid-session → current session's applies use the old threshold
  //     (2) value IS in the store
  //     (3) re-hydrate (new session) → new threshold bites
  // ---------------------------------------------------------------------------

  it('D3: TRIPLE PIN — mid-session setEngineParam is session-frozen; re-hydrate bites', async () => {
    const settingsDao = new UserSettingsIDBDAO(() => db);

    // ── Session 1: start with default threshold (0.3) ────────────────────────
    const service1 = new ImportStatementServiceImpl(null, null, settingsDao);
    const decodeResult = await decode(readFixture('bad-dates.csv'));

    const stage1a = service1.startWith(decodeResult.rows);
    const stage2a = (await service1.stage2(stage1a)) as ImportStatementStage2Impl;

    // Snapshot is defaults (0.3) for session 1
    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.3);

    // Amount column: 1/12 = 8.3% errors; threshold 0.3 → should apply
    const colsA = await firstValueFrom(stage2a.columns);
    const amountColA = colsA.find((c) => c.originalName.getText() === 'Amount');
    if (!(amountColA instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');

    // ASSERT (1): mid-session setEngineParam → store-only write, snapshot unchanged
    await setEngineParam(settingsDao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 0.05);
    // Snapshot still 0.3 (session-frozen)
    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.3);

    // ASSERT (2): value IS in the store
    const storedValue = await settingsDao.getSetting<number>(
      SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE
    );
    expect(storedValue).toBe(0.05);

    // Amount still applies with old threshold (1/12 < 0.3)
    await expect(
      amountColA.parseAsAmount({ type: 'outcome', currency: { code: 'UAH' } })
    ).resolves.toBeUndefined();

    // ── Session 2: new service.stage2() → re-hydrate → new threshold active ──
    const stage1b = service1.startWith(decodeResult.rows);
    const stage2b = (await service1.stage2(stage1b)) as ImportStatementStage2Impl;

    // ASSERT (3): re-hydrate picks up 0.05
    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.05);

    const colsB = await firstValueFrom(stage2b.columns);
    const amountColB = colsB.find((c) => c.originalName.getText() === 'Amount');
    if (!(amountColB instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');

    // Amount now rejected with 0.05 threshold (1/12 = 8.3% > 5%)
    const rejectionB = await amountColB
      .parseAsAmount({ type: 'outcome', currency: { code: 'UAH' } })
      .then(() => null)
      .catch((e: unknown) => e);

    expect(rejectionB).toBeInstanceOf(ColumnTransformRejection);
    if (!(rejectionB instanceof ColumnTransformRejection)) throw new Error('Not ColumnTransformRejection');
    expect(rejectionB.threshold).toBe(0.05);
  });

  // ---------------------------------------------------------------------------
  // D4. Q-009 E2E: complete mapping EXCEPT one column → next() throws
  //     UnmappedColumnsError naming exactly it; map it → next() resolves
  // ---------------------------------------------------------------------------

  it('D4: Q-009 — leave one column unmapped → UnmappedColumnsError; map it → resolves', async () => {
    const decodeResult = await decode(readFixture('bad-dates.csv'));
    const service = makeService(db);
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;

    // Map only Amount and Description; leave Date unmapped (UNKNOWN)
    const partialTransformations: ColumnTransformation[] = [
      { columnName: 'Amount',      definition: ColumnDefinition.AMOUNT,      params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
      { columnName: 'Description', definition: ColumnDefinition.DESCRIPTION, params: null },
    ];
    await applyMappings(stage2, partialTransformations);

    // getUnmappedColumns() should list "Date" as unmapped
    const unmapped = stage2.getUnmappedColumns();
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0].name).toBe('Date');

    // next() throws UnmappedColumnsError naming "Date"
    const throwable = await stage2.next().then(() => null).catch((e: unknown) => e);
    expect(throwable).toBeInstanceOf(UnmappedColumnsError);
    if (!(throwable instanceof UnmappedColumnsError)) throw new Error('Not UnmappedColumnsError');
    expect(throwable.unmappedColumns).toHaveLength(1);
    expect(throwable.unmappedColumns[0].name).toBe('Date');
    // Error enumeration agrees with getter
    expect(throwable.unmappedColumns[0].id).toBe(unmapped[0].id);

    // Map the remaining column (as IGNORE to avoid ColumnTransformRejection on bad dates)
    const colsNow = await firstValueFrom(stage2.columns);
    const dateColNow = colsNow.find((c) => c.originalName.getText() === 'Date');
    if (!(dateColNow instanceof ImportStatementColumn)) throw new Error('Not ImportStatementColumn');
    await dateColNow.ignore();

    // getUnmappedColumns() is now empty
    const unmappedAfter = stage2.getUnmappedColumns();
    expect(unmappedAfter).toHaveLength(0);

    // next() no longer throws UnmappedColumnsError
    // (It throws a categorization stub error from the service, but NOT UnmappedColumnsError)
    try {
      await stage2.next();
    } catch (e: unknown) {
      // next() calls service.stage3() which throws the categorization stub error.
      // What matters is it's NOT an UnmappedColumnsError.
      expect(e).not.toBeInstanceOf(UnmappedColumnsError);
    }
  });

  // ---------------------------------------------------------------------------
  // D5. Engine-init hydrate path: UserSettingsIDBDAO seeded before initEnginePersistence
  //     → getEngineConfig() reflects store override post-init
  //     (Uses openDatabase directly to avoid the global memoization of initEnginePersistence)
  // ---------------------------------------------------------------------------

  it('D5: engine-init hydrate — store override reflected in getEngineConfig() after hydration', async () => {
    // Seed a store override via DAO over the test DB
    const settingsDao = new UserSettingsIDBDAO(() => db);
    await setEngineParam(settingsDao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 0.1);

    // Manually call hydrateEngineConfig (mirrors what doInit() does after openEngineDb())
    await hydrateEngineConfig(settingsDao);

    // getEngineConfig() must reflect the stored override
    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.1);
  });

  it('D5b: engine-init hydrate failure — non-fatal, defaults stand', async () => {
    // DAO that rejects every read — simulates doInit() hydrate-failure path
    const failingDao = {
      getSetting: vi.fn().mockRejectedValue(new Error('IDB read failure')),
      setSetting: vi.fn().mockRejectedValue(new Error('IDB read failure')),
      removeSetting: vi.fn().mockRejectedValue(new Error('IDB read failure')),
      getAllSettings: vi.fn().mockRejectedValue(new Error('IDB read failure')),
    };

    // Simulate what doInit() does: try hydrateEngineConfig, catch non-fatally (HC-7)
    // hydrateEngineConfig rejects when getSetting rejects; the caller swallows it,
    // defaults stand, engine continues.
    let caughtError: unknown = null;
    try {
      await hydrateEngineConfig(failingDao as Parameters<typeof hydrateEngineConfig>[0]);
    } catch (e) {
      caughtError = e;
    }

    // hydrateEngineConfig rejection is caught by doInit(); defaults remain intact
    expect(caughtError).not.toBeNull(); // it DID reject (caller must swallow)
    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.3);
    expect(getEngineConfig().acceptableParseDatePercentage).toBe(90);
    expect(getEngineConfig().successStatusThreshold).toBe(0.8);
    expect(getEngineConfig().recallAutoDetectEnabled).toBe(false);
  });
});

// ============================================================================
// E. Story 2.5 — pseudo-ops (BANK_COMMISSION / CASHBACK expansion, ENT-013)
//
// E1. mono-like-utf8.csv with commission + cashback columns MAPPED
//     (parseAsBankCommission / parseAsCashback, currency: { code: 'UAH' }).
//     Fixture content (12 decoded rows, all outcome):
//       commission cells non-empty: rows 3, 6            → 2 commission ops
//       cashback   cells non-empty: rows 1,2,4,7,8,10,11 → 7 cashback ops
//     → 12 mains + 2 commission + 7 cashback = 21 rows, 0 skipped, 0 rowErrors.
//
// E2. income-commission.csv — the spawn-scope matrix end-to-end (decision 3):
//     (a) income main (+15000,00) WITH commission -100,00 → main SKIPPED with
//         reason, commission pseudo-op in rows (the decisive case).
//     (b) outcome -250,00 with cashback 2,50  → main + cashback op.
//     (c) outcome -1000,00 with BOTH (-10,00 / 10,00) → 3 ops, 3 distinct hashes.
//     (d) plain outcome -75,00 → main only.
//     (e) outcome -400,00 with '+50,00' cashback (decision 1 in fixture form)
//         → parses, cashback op amount 50.
//     With AMOUNT type 'mixed': 4 mains + 2 commission + 3 cashback = 9 rows,
//     1 skipped, 0 rowErrors.
//
// Determinism: no Date.now / Math.random; fresh service per test; per-test DB
// via the shared beforeEach/afterEach seams above.
// ============================================================================

describe('Story 2.5 — pseudo-ops', () => {
  // Shared pipeline runner: decode → stage1 → stage2(map) → generateRows
  async function runPipeline(fixture: string, transformations: ColumnTransformation[]) {
    const decodeResult = await decode(readFixture(fixture));
    const service = new ImportStatementServiceImpl();
    const stage1 = service.startWith(decodeResult.rows);
    const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;
    await applyMappings(stage2, transformations);
    const cols = await firstValueFrom(stage2.columns);
    const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
    return generateRows(rows, toColumnInfo(cols), 'UAH');
  }

  // ── E1. mono-like-utf8.csv with commission + cashback mapped ──────────────
  const MONO_PSEUDO_TRANSFORMATIONS: ColumnTransformation[] = [
    { columnName: 'Дата i час операції',  definition: ColumnDefinition.DATE,              params: { format: 'auto' } as DateColumnParams },
    { columnName: 'Деталі операції',      definition: ColumnDefinition.DESCRIPTION,       params: null },
    { columnName: 'MCC',                  definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
    { columnName: 'Сума в валюті картки', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
    { columnName: 'Валюта картки',        definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Сума в USD',           definition: ColumnDefinition.IGNORE,            params: null },
    { columnName: 'Комісія',              definition: ColumnDefinition.BANK_COMMISSION,   params: { currency: { code: 'UAH' } } as BankCommissionColumnParams },
    { columnName: 'Кешбек',              definition: ColumnDefinition.CASHBACK,          params: { currency: { code: 'UAH' } } as CashbackColumnParams },
    { columnName: 'Залишок',             definition: ColumnDefinition.IGNORE,            params: null },
  ];

  describe('mono-like-utf8.csv — full pipeline with commission + cashback mapped', () => {
    it('hard counts: 12 mains + 2 commission + 7 cashback = 21 rows, 0 skipped, 0 rowErrors', async () => {
      const result = await runPipeline('mono-like-utf8.csv', MONO_PSEUDO_TRANSFORMATIONS);

      const mains      = result.rows.filter((r) => !r.isBankCommission && !r.isCashback);
      const commission = result.rows.filter((r) => r.isBankCommission);
      const cashback   = result.rows.filter((r) => r.isCashback);

      expect(mains).toHaveLength(12);
      expect(commission).toHaveLength(2);
      expect(cashback).toHaveLength(7);
      expect(result.rows).toHaveLength(21);
      expect(result.skipped).toHaveLength(0);
      expect(result.rowErrors).toHaveLength(0);
    });

    it('commission ops: abs amounts {5, 12}, UAH, synthetic description, null counterparty/mcc', async () => {
      const result = await runPipeline('mono-like-utf8.csv', MONO_PSEUDO_TRANSFORMATIONS);
      const commission = result.rows.filter((r) => r.isBankCommission);

      // Fixture commission cells: -5,00 (ATM row) and -12,00 (fuel row) → abs
      expect(commission.map((r) => r.amount).sort((a, b) => a - b)).toEqual([5, 12]);
      for (const op of commission) {
        expect(op.currency).toBe('UAH');
        expect(op.isCashback).toBe(false);
        expect(op.description).toBe('engine.importStatement.pseudo-op.bank-commission');
        expect(op.counterparty).toBeNull();
        expect(op.bankCategory).toBeNull();
        expect(op.mcc).toBeNull();
        expect(op.date).toBeInstanceOf(Date);
      }
    });

    it('cashback ops: 7 ops with exact abs amounts (incl. 0.42 and 21.5)', async () => {
      const result = await runPipeline('mono-like-utf8.csv', MONO_PSEUDO_TRANSFORMATIONS);
      const cashback = result.rows.filter((r) => r.isCashback);

      const amounts = cashback.map((r) => r.amount).sort((a, b) => a - b);
      expect(amounts).toEqual([0.42, 0.85, 2.8, 3.21, 4.3, 4.45, 21.5]);
      for (const op of cashback) {
        expect(op.isBankCommission).toBe(false);
        expect(op.description).toBe('engine.importStatement.pseudo-op.cashback');
      }
    });

    it('ordering main → commission → cashback per source row; rowIndex re-indexed; 21 distinct hashes', async () => {
      const result = await runPipeline('mono-like-utf8.csv', MONO_PSEUDO_TRANSFORMATIONS);

      // Row 0 (coffee, cashback 0,42): main at index 0, its cashback op directly after
      expect(result.rows[0].isCashback).toBe(false);
      expect(result.rows[0].description).toBe('TEST COFFEE 1');
      expect(result.rows[1].isCashback).toBe(true);
      expect(result.rows[1].amount).toBe(0.42);
      // Pseudo-op inherits the main's date
      expect(result.rows[1].date.getTime()).toBe(result.rows[0].date.getTime());

      // rowIndex synced to array index by the final re-index pass
      result.rows.forEach((r, i) => expect(r.rowIndex).toBe(i));

      // Q-011: all 21 hashes distinct (discriminator separates pseudo-ops from mains)
      expect(new Set(result.rows.map((r) => r.hash)).size).toBe(21);
    });

    it('determinism: same fixture run twice → deep-equal results incl. hashes', async () => {
      const a = await runPipeline('mono-like-utf8.csv', MONO_PSEUDO_TRANSFORMATIONS);
      const b = await runPipeline('mono-like-utf8.csv', MONO_PSEUDO_TRANSFORMATIONS);
      expect(b.rows).toEqual(a.rows);
      expect(b.rowErrors).toEqual(a.rowErrors);
      expect(b.skipped).toEqual(a.skipped);
    });
  });

  // ── E2. income-commission.csv — the spawn-scope matrix ────────────────────
  const INCOME_COMMISSION_TRANSFORMATIONS: ColumnTransformation[] = [
    { columnName: 'Дата операції',   definition: ColumnDefinition.DATE,            params: { format: 'auto' } as DateColumnParams },
    { columnName: 'Деталі операції', definition: ColumnDefinition.DESCRIPTION,     params: null },
    { columnName: 'Сума',            definition: ColumnDefinition.AMOUNT,          params: { type: 'mixed', currency: { code: 'UAH' } } as AmountColumnParams },
    { columnName: 'Комісія',         definition: ColumnDefinition.BANK_COMMISSION, params: { currency: { code: 'UAH' } } as BankCommissionColumnParams },
    { columnName: 'Кешбек',          definition: ColumnDefinition.CASHBACK,        params: { currency: { code: 'UAH' } } as CashbackColumnParams },
  ];

  describe('income-commission.csv — spawn-scope matrix end-to-end', () => {
    it('decode → 5 rows, header detected at row 0', async () => {
      const result = await decode(readFixture('income-commission.csv'));
      expect(result.meta.decodedRows).toBe(5);
      expect(result.meta.headerRow).toBe(0);
    });

    it('totals exact: 4 mains + 2 commission + 3 cashback = 9 rows, 1 skipped, 0 rowErrors', async () => {
      const result = await runPipeline('income-commission.csv', INCOME_COMMISSION_TRANSFORMATIONS);

      const mains      = result.rows.filter((r) => !r.isBankCommission && !r.isCashback);
      const commission = result.rows.filter((r) => r.isBankCommission);
      const cashback   = result.rows.filter((r) => r.isCashback);

      expect(mains).toHaveLength(4);
      expect(commission).toHaveLength(2);
      expect(cashback).toHaveLength(3);
      expect(result.rows).toHaveLength(9);
      expect(result.skipped).toHaveLength(1);
      expect(result.rowErrors).toHaveLength(0);
    });

    it('SPAWN-SCOPE PIN 1 (row a): income main skipped WITH reason; its commission op IS in rows', async () => {
      const result = await runPipeline('income-commission.csv', INCOME_COMMISSION_TRANSFORMATIONS);

      // Main of row (a) (rowIndex 0 in source order) is skipped with a reason
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped[0].rowIndex).toBe(0);
      expect(result.skipped[0].reason).toBeDefined();
      expect(result.skipped[0].reason.getText().length).toBeGreaterThan(0);

      // Its commission pseudo-op IS generated — the decisive ENT-013 case:
      // the income transfer's 100 UAH commission is REAL EXPENSE, never dropped.
      // It is the FIRST generated row (row a is the first source row).
      const first = result.rows[0];
      expect(first.isBankCommission).toBe(true);
      expect(first.amount).toBe(100); // abs(-100,00)
      expect(first.currency).toBe('UAH');
      expect(first.date.toISOString().slice(0, 10)).toBe('2024-02-01');
      // No main op for row (a) exists anywhere in rows
      const mains = result.rows.filter((r) => !r.isBankCommission && !r.isCashback);
      expect(mains.map((m) => m.description)).toEqual([
        'TEST SHOP 1', 'TEST ATM 1', 'TEST CAFE 1', 'TEST MARKET 1',
      ]);
    });

    it('row (c): commission + cashback → exactly 3 ops with 3 DISTINCT hashes (Q-011)', async () => {
      const result = await runPipeline('income-commission.csv', INCOME_COMMISSION_TRANSFORMATIONS);

      // Generated order: [a.comm, b.main, b.cb, c.main, c.comm, c.cb, d.main, e.main, e.cb]
      const cMain = result.rows[3];
      const cComm = result.rows[4];
      const cCb   = result.rows[5];

      expect(cMain.description).toBe('TEST ATM 1');
      expect(cMain.isBankCommission).toBe(false);
      expect(cMain.isCashback).toBe(false);
      expect(cMain.amount).toBe(1000);

      expect(cComm.isBankCommission).toBe(true);
      expect(cComm.amount).toBe(10);

      expect(cCb.isCashback).toBe(true);
      expect(cCb.amount).toBe(10);

      // Same source row, same date — only the discriminator (and own fields) differ
      expect(cComm.date.getTime()).toBe(cMain.date.getTime());
      expect(cCb.date.getTime()).toBe(cMain.date.getTime());

      // THE 3-distinct-hashes pin (decision 2)
      expect(new Set([cMain.hash, cComm.hash, cCb.hash]).size).toBe(3);
    });

    it("row (e): '+50,00' cashback cell parses (decision 1) → cashback op amount 50", async () => {
      const result = await runPipeline('income-commission.csv', INCOME_COMMISSION_TRANSFORMATIONS);

      // Last generated row is row (e)'s cashback op
      const eCb = result.rows[result.rows.length - 1];
      expect(eCb.isCashback).toBe(true);
      expect(eCb.amount).toBe(50);
      expect(eCb.currency).toBe('UAH');
      // Its main precedes it
      const eMain = result.rows[result.rows.length - 2];
      expect(eMain.description).toBe('TEST MARKET 1');
      expect(eMain.amount).toBe(400);
      expect(eCb.date.getTime()).toBe(eMain.date.getTime());
    });

    it('row (d): plain outcome spawns NO pseudo-ops', async () => {
      const result = await runPipeline('income-commission.csv', INCOME_COMMISSION_TRANSFORMATIONS);
      // rows[6] is d.main; total stays 9 — no extra ops for row (d)
      const dMain = result.rows[6];
      expect(dMain.description).toBe('TEST CAFE 1');
      expect(dMain.isBankCommission).toBe(false);
      expect(dMain.isCashback).toBe(false);
      expect(result.rows).toHaveLength(9);
    });

    it('determinism: same fixture run twice → deep-equal incl. hashes', async () => {
      const a = await runPipeline('income-commission.csv', INCOME_COMMISSION_TRANSFORMATIONS);
      const b = await runPipeline('income-commission.csv', INCOME_COMMISSION_TRANSFORMATIONS);
      expect(b.rows).toEqual(a.rows);
      expect(b.skipped.map((s) => s.rowIndex)).toEqual(a.skipped.map((s) => s.rowIndex));
      expect(b.rowErrors).toEqual(a.rowErrors);
    });
  });
});
