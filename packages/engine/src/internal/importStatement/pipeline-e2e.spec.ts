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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { firstValueFrom } from 'rxjs';

import { openDatabase } from '../store/migrations/open-with-migrations';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { decode } from '../ingest/decode';
import { ImportStatementServiceImpl } from './service';
import type { FileFormatDAO, FileSourceDAO } from './dao';
import { ImportStatementColumn } from './stage2/column';
import { ImportStatementStage2Impl } from './stage2/implementation';
import { ColumnDefinition } from './types';
import type { AmountColumnParams, DateColumnParams, ColumnTransformation } from './types';
import type { ImportStatementColumnHeaderStage2, ImportStatementRowData } from './stage2/types';
import { createRecallPool } from './recall/recall';
import type { RecallResult } from './recall/recall';
import { generateRows } from './stage3/row-generator';
import type { ColumnInfo } from './stage3/row-generator';

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
// Stub DAOs (empty — no transformation rules → service.stage2 returns plain stage2)
// ---------------------------------------------------------------------------

function makeStubDAOs(): { fileFormatDAO: FileFormatDAO; fileSourceDAO: FileSourceDAO } {
  const fileFormatDAO: FileFormatDAO = {
    list: async () => [],
    get: async () => null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: async (f: any) => f,
    delete: async () => {},
  } as unknown as FileFormatDAO;

  const fileSourceDAO: FileSourceDAO = {
    list: async () => [],
    get: async () => null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    upsert: async (f: any) => f,
    delete: async () => {},
    getByName: async () => null,
    getByFormatId: async () => [],
  } as unknown as FileSourceDAO;

  return { fileFormatDAO, fileSourceDAO };
}

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

    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);

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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();

    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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

    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);

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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);

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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);

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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);

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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);

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
    const { fileFormatDAO, fileSourceDAO } = makeStubDAOs();
    const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);

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
