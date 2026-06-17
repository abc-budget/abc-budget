/**
 * recall-cell-parse.spec.ts — Story 4.9a.1 regression guard (BLOCKER).
 *
 * THE BUG: on a RE-IMPORT, columns recall from the pool as `guessed`. The recall
 * MOUNT (stage2 constructor `applyRecall`) does `col.copy({ definition, params,
 * recallState })` — it sets the DEFINITION but NEVER runs the cell PARSE. So
 * recalled DATE cells stay raw strings (not `Date`), recalled AMOUNT cells stay
 * raw strings (not `number`). `extractDate` casts `.value as Date` (a runtime
 * lie) → `footprintYearMonth → row.date.getUTCFullYear()` crashes, and
 * `amountUSD` math (EP-5) multiplies a string.
 *
 * The parse only runs via the `definition → col.parseAsX(params)` dispatcher,
 * invoked ONLY by the interactive `importApplyColumn` — recalled columns never
 * went through it.
 *
 * This guard seeds the recall pool from a first mapping pass (decode → map →
 * flushRecallWrites = the advance), then starts a FRESH import of the SAME
 * statement THROUGH `service.stage2` (the sole recall-mount entry, with the pool
 * wired). It asserts:
 *   1. the columns recall as `guessed` (recall fired),
 *   2. EACH generated `row.date instanceof Date` AND `typeof row.amount ===
 *      'number'` (the cells were actually parsed at the mount),
 *   3. `footprintYearMonth(row.date)` does NOT throw (the original crash),
 *   4. a small `autoCategorize` run completes with NO throw,
 *   5. recalled columns STAY `guessed` after the mount-time parse (the parse
 *      must NOT confirm them),
 *   6. the recall mount stages NO pool write (the learning loop still fires on
 *      the NEXT advance — `flushRecallWrites` — unchanged).
 *
 * Harness mirrors pipeline-e2e.spec.ts (real fake-indexeddb, real migrations).
 * Deterministic: no Date.now / Math.random in assertions.
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
import { ImportStatementColumn } from './stage2/column';
import { ImportStatementStage2Impl } from './stage2/implementation';
import { ColumnDefinition } from './types';
import type {
  AmountColumnParams,
  ColumnParams,
  DateColumnParams,
} from './types';
import type { ImportStatementColumnHeaderStage2, ImportStatementRowData } from './stage2/types';
import { createRecallPool } from './recall/recall';
import { generateRows } from './stage3/row-generator';
import type { ColumnInfo } from './stage3/row-generator';
import { footprintYearMonth } from '../footprint/derive-footprint';
import { autoCategorize, type AutoCategorizeDeps } from '../rules/auto-categorize';
import { FootprintDao } from '../footprint/footprint-dao';
import { CategoriesService } from '../categories/categories-service';
import { CategoriesDAO } from '../categories/categories-dao';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { DecisionTreeBuilder } from '../rules/decision-tree-builder';

// ── Path helpers ───────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, '../ingest/fixtures');

function readFixture(name: string): { bytes: ArrayBuffer; fileName: string } {
  const buf = readFileSync(join(FIXTURES, name));
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { bytes, fileName: name };
}

// ── Mapping fixture (mono-like-utf8.csv — DATE + AMOUNT + DESCRIPTION + MCC) ─────

interface Mapping {
  readonly columnName: string;
  readonly definition: ColumnDefinition;
  readonly params: ColumnParams | null;
}

const MONO_MAPPINGS: Mapping[] = [
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

function toColumnInfo(columns: ImportStatementColumnHeaderStage2[]): ColumnInfo[] {
  return columns.map((col) => ({ id: col.id, definition: col.definition, params: col.params }));
}

/** Detach columns from their stage2 so a new stage2 can claim ownership. */
function detachColumns(columns: ImportStatementColumnHeaderStage2[]): ImportStatementColumn[] {
  return columns.map((col) => {
    if (!(col instanceof ImportStatementColumn)) throw new Error('Expected ImportStatementColumn');
    const copied = col.copy();
    (copied as unknown as { _stage2: null })._stage2 = null;
    return copied;
  });
}

/** Apply the interactive parse path on a stage2 (run A — warms the pool). */
async function applyMappings(stage2: ImportStatementStage2Impl, mappings: Mapping[]): Promise<void> {
  const cols = await firstValueFrom(stage2.columns);
  for (const m of mappings) {
    const col = cols.find((c) => c.originalName.getText() === m.columnName);
    if (!col || !(col instanceof ImportStatementColumn)) continue;
    switch (m.definition) {
      case ColumnDefinition.DATE:
        await col.parseAsDate((m.params as DateColumnParams) ?? { format: 'auto' });
        break;
      case ColumnDefinition.AMOUNT:
        await col.parseAsAmount(m.params as AmountColumnParams);
        break;
      case ColumnDefinition.DESCRIPTION:
        await col.parseAsDescription();
        break;
      case ColumnDefinition.MERCHANT_CATEGORY:
        await col.parseAsMerchant();
        break;
      default:
        await col.ignore();
    }
  }
}

// ── DB lifecycle ─────────────────────────────────────────────────────────────

let db: IDBDatabase;
let dbName: string;
let dbCounter = 0;

beforeEach(async () => {
  dbName = `recall-cell-parse-test-${++dbCounter}`;
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
// Regression guard — recalled DATE/AMOUNT cells must be parsed at the mount
// ============================================================================

describe('Story 4.9a.1 — recalled columns parse their cells at the recall mount', () => {
  /**
   * Seed the pool from a first mapping pass, then re-import the SAME statement
   * through `service.stage2` (pool wired) so the real recall mount runs.
   * Returns the recalled stage2 + the service + pool for assertions.
   */
  async function reimportWithRecall(): Promise<{
    stage2: ImportStatementStage2Impl;
    rows: ImportStatementRowData[];
    cols: ImportStatementColumnHeaderStage2[];
  }> {
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));

    // ── Run A: map on an empty pool (warm it), then flush (the advance) ───────
    const serviceA = new ImportStatementServiceImpl();
    const stage1a = serviceA.startWith(decodeResult.rows);
    const stage2aBase = (await serviceA.stage2(stage1a)) as ImportStatementStage2Impl;
    const colsADetached = detachColumns(await firstValueFrom(stage2aBase.columns));
    const stage2a = new ImportStatementStage2Impl(
      stage1a,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceA as any,
      colsADetached,
      undefined,
      null,
      recallPool,
    );
    await applyMappings(stage2a, MONO_MAPPINGS);
    await stage2a.flushRecallWrites(); // the advance commits the staged writes

    // ── Run B: fresh import THROUGH service.stage2 with the pool wired ────────
    // This exercises the SOLE recall-mount entry (recallFor + the stage2 factory).
    const serviceB = new ImportStatementServiceImpl(null, null, null, recallPool);
    const stage1b = serviceB.startWith(decodeResult.rows);
    const stage2b = (await serviceB.stage2(stage1b)) as ImportStatementStage2Impl;

    const cols = await firstValueFrom(stage2b.columns);
    const rows = await firstValueFrom(stage2b.currentData);
    return { stage2: stage2b, rows, cols };
  }

  it('recalls DATE + AMOUNT as guessed AND parses their cells (date is a Date, amount is a number)', async () => {
    const { rows, cols } = await reimportWithRecall();

    // 1. The columns recalled (guessed) — recall actually fired.
    const dateCol = cols.find((c) => c.originalName.getText() === 'Дата i час операції');
    const amountCol = cols.find((c) => c.originalName.getText() === 'Сума в валюті картки');
    expect(dateCol?.definition).toBe(ColumnDefinition.DATE);
    expect(dateCol?.recallState).toBe('guessed');
    expect(amountCol?.definition).toBe(ColumnDefinition.AMOUNT);
    expect(amountCol?.recallState).toBe('guessed');

    // 2. Drive generateRows and assert RUNTIME types per row — the heart of the bug.
    const { rows: typedRows, structuralErrors } = await generateRows(rows, toColumnInfo(cols), 'UAH');
    expect(structuralErrors).toHaveLength(0);
    expect(typedRows.length).toBeGreaterThan(0);

    for (const row of typedRows) {
      expect(row.date).toBeInstanceOf(Date);
      expect(typeof row.amount).toBe('number');
      expect(Number.isNaN(row.amount)).toBe(false);
    }

    // 3. footprintYearMonth must NOT throw (the original getUTCFullYear crash).
    for (const row of typedRows) {
      expect(() => footprintYearMonth(row.date)).not.toThrow();
    }
  });

  it('a small autoCategorize run completes with NO throw on the recalled rows', async () => {
    const { rows, cols } = await reimportWithRecall();
    const { rows: typedRows } = await generateRows(rows, toColumnInfo(cols), 'UAH');

    const deps: AutoCategorizeDeps = {
      tree: new DecisionTreeBuilder().withName('empty').build(),
      footprintDao: new FootprintDao(() => db),
      categoriesService: new CategoriesService(
        new CategoriesDAO(() => db),
        new UserSettingsIDBDAO(() => db),
      ),
    };

    // distinctPeriods → row.date.getUTCFullYear() runs here; a raw-string date throws.
    await expect(autoCategorize(typedRows, deps)).resolves.toBeDefined();
  });

  it('recalled columns STAY guessed after the mount-time parse (parse must not confirm)', async () => {
    const { cols } = await reimportWithRecall();
    for (const m of MONO_MAPPINGS) {
      if (m.definition === ColumnDefinition.IGNORE) continue;
      const col = cols.find((c) => c.originalName.getText() === m.columnName);
      expect(col?.definition).toBe(m.definition);
      expect(col?.recallState).toBe('guessed');
    }
  });

  it('the recall mount stages NO pool write; the learning loop still fires on the next advance', async () => {
    const recallPool = createRecallPool(() => db);
    const decodeResult = await decode(readFixture('mono-like-utf8.csv'));

    // Warm the pool (run A) + flush.
    const serviceA = new ImportStatementServiceImpl();
    const stage1a = serviceA.startWith(decodeResult.rows);
    const stage2aBase = (await serviceA.stage2(stage1a)) as ImportStatementStage2Impl;
    const colsADetached = detachColumns(await firstValueFrom(stage2aBase.columns));
    const stage2a = new ImportStatementStage2Impl(
      stage1a,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      serviceA as any,
      colsADetached,
      undefined,
      null,
      recallPool,
    );
    await applyMappings(stage2a, MONO_MAPPINGS);
    await stage2a.flushRecallWrites();

    const keysBefore = (await recallPool.getAllKeys()).sort();

    // Re-import through service.stage2 (recall mount). The mount must stage NO write.
    const serviceB = new ImportStatementServiceImpl(null, null, null, recallPool);
    const stage1b = serviceB.startWith(decodeResult.rows);
    const stage2b = (await serviceB.stage2(stage1b)) as ImportStatementStage2Impl;

    // A flush right after the recall mount (no interactive apply) must NOT change
    // the pool — the mount-time parse stages nothing.
    await stage2b.flushRecallWrites();
    const keysAfterMount = (await recallPool.getAllKeys()).sort();
    expect(keysAfterMount).toEqual(keysBefore);
  });
});
