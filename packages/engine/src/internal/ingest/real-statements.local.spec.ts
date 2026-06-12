/**
 * real-statements.local.spec.ts
 *
 * Founder's hard-count requirement: assert EXACT decoded row counts, exact
 * header key lists, and 2-3 spot cell values per real bank-statement file.
 * Assertions FAIL on regression — snapshot churn cannot silently absorb it.
 *
 * AUTO-SKIPS in CI because the real files are NOT committed to the repo.
 * The guard below (existsSync) makes the suite disappear in any environment
 * where the files are absent.
 *
 * HOW TO RUN LOCALLY:
 *   pnpm --filter @abc-budget/engine test src/internal/ingest/real-statements.local.spec.ts
 *   — or —
 *   pnpm test (runs everything including this suite when files are present)
 *
 * FILES REQUIRED (must exist at these exact Windows paths):
 *   D:/abc-budget/mono_07-10-23_14-34-50.csv
 *   D:/abc-budget/mono_en_21-11-23_10-34-42.csv
 *   D:/abc-budget/ukrsib.xlsx
 *
 * SECURITY NOTE:
 *   Real file content is NEVER copied into this repo.  Only aggregate counts,
 *   header key lists, and ≤3 spot cell values (amounts + one merchant prefix)
 *   per file are baked here — per the founder's instruction.
 */

import '@vitest/web-worker';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { firstValueFrom } from 'rxjs';
import { decode } from './decode';
import type { DecodeResult } from './types';
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

// EXCISED (2.6 decision 3): `ColumnTransformation` no longer exists in
// ../importStatement/types — it died with the format entity (FEAT-005).
// This LOCAL fixture shape is the mapping triple consumed by the
// applyMappings_e2e() helper below; it is test plumbing, NOT an engine type.
interface ColumnTransformation {
  readonly columnName: string;
  readonly definition: ColumnDefinition;
  readonly params: ColumnParams | null;
}
import type { ImportStatementColumnHeaderStage2, ImportStatementRowData } from '../importStatement/stage2/types';
import { generateRows } from '../importStatement/stage3/row-generator';
import type { ColumnInfo } from '../importStatement/stage3/row-generator';

// ── Worker-E2E infrastructure ─────────────────────────────────────────────────
// (reused from engine-worker-host.spec.ts pattern)
import { createWorkerEngineClient } from '../../client/worker-client';
import type { WorkerLike } from '../../client/worker-client';
import type { EngineClient, EngineEventPayload, ProgressEventPayload } from '../../client/engine-client';
import type { Stage2SnapshotDTO, Stage2ColumnDTO } from '../../client/dto';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { setBaseCurrency } from '../settings/base-currency';
import { openDatabase } from '../store/migrations/open-with-migrations';
import { ENGINE_DB_NAME, ENGINE_MIGRATIONS, resetPersistenceForTests } from '../persistence/engine-db';
import { resetEngineConfigForTests } from '../settings/engine-config';

// ---------------------------------------------------------------------------
// File paths (forward-slash Windows-safe)
// ---------------------------------------------------------------------------

const PATH_MONO_UA  = 'D:/abc-budget/mono_07-10-23_14-34-50.csv';
const PATH_MONO_EN  = 'D:/abc-budget/mono_en_21-11-23_10-34-42.csv';
const PATH_UKRSIB   = 'D:/abc-budget/ukrsib.xlsx';

// Guard: skip entire suite if the anchor file is absent (CI / other machines).
const HAVE_REAL_FILES = existsSync(PATH_MONO_UA);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readRealFile(p: string): { bytes: ArrayBuffer; fileName: string } {
  const buf = readFileSync(p);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { bytes, fileName: p.split('/').pop()! };
}

// ---------------------------------------------------------------------------
// Hard constants (observed 2026-06-11, decoder v2.1)
// ---------------------------------------------------------------------------

// ── mono_07-10-23_14-34-50.csv (Monobank UA, Ukrainian headers) ────────────
const MONO_UA = {
  decodedRows: 181,
  totalRows:   182,          // 182 physical data rows; 1 placeholder skipped
  format:      'csv'   as const,
  encoding:    'utf-8' as const,
  delimiter:   ','     as const,
  headerRow:   0,
  // Full ordered key list — adding/removing/renaming a column fails this test
  keys: [
    'Дата i час операції',    // NOTE: the 'i' is LATIN i (U+0069) — real Mono quirk
    'Деталі операції',
    'MCC',
    'Сума в валюті картки (UAH)',
    'Сума в валюті операції',
    'Валюта',
    'Курс',
    'Сума комісій (UAH)',
    'Сума кешбеку (UAH)',
    'Залишок після операції',
  ],
  // Spot values: row[0] (most-recent transaction in file)
  spot_row0_amount:      '-465.0',             // 'Сума в валюті картки (UAH)'
  spot_row0_merchant_prefix: 'BOWLING CLUB',   // prefix of 'Деталі операції'
  spot_row0_date:        '30.09.2023 14:55:43',
} as const;

// ── mono_en_21-11-23_10-34-42.csv (Monobank EN, English headers) ───────────
const MONO_EN = {
  decodedRows: 12,
  totalRows:   12,
  format:      'csv'   as const,
  encoding:    'utf-8' as const,
  delimiter:   ','     as const,
  headerRow:   0,
  keys: [
    'Date and time',
    'Description',
    'MCC',
    'Card currency amount, (UAH)',  // NOTE: trailing comma in column name — real quirk
    'Operation amount',
    'Operation currency',
    'Exchange rate',
    'Commission (UAH)',
    'Cashback amount (UAH)',
    'Balance',
  ],
  // Spot values: row[0] (founder's confirmed value)
  spot_row0_amount:      '-10780.32',  // 'Card currency amount, (UAH)'
  spot_row0_date:        '20.11.2023 20:06:01',
  spot_row0_balance:     '1649.13',   // 'Balance'
} as const;

// ── ukrsib.xlsx (UkrSibbank, XLSX, Ukrainian headers) ──────────────────────
const UKRSIB = {
  decodedRows: 997,
  totalRows:   997,
  format:      'xlsx'              as const,
  sheet:       'Останні операції',
  headerRow:   0,
  // NOTE: first key 'Cтатус' uses Cyrillic С (U+0421) as first char per SheetJS decode
  keys: [
    'Cтатус',          // Cyrillic С + тaтус — raw key as decoded by SheetJS
    'Дата операції',
    'Опис операції',
    'Рахунок/картка',
    'Категорія',
    'Сума',
    'Валюта',
  ],
  // Spot values: row[0] (oldest visible = most-recent in export order)
  spot_row0_amount:  '-20.00',  // 'Сума'
  spot_row0_currency: 'грн',   // 'Валюта'
  spot_row0_date:    '03.12.2021',
} as const;

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!HAVE_REAL_FILES)('real statements — hard-count assertions (local only)', () => {
  let monoUaResult: DecodeResult;
  let monoEnResult: DecodeResult;
  let ukrsibResult: DecodeResult;

  beforeAll(async () => {
    [monoUaResult, monoEnResult, ukrsibResult] = await Promise.all([
      decode(readRealFile(PATH_MONO_UA)),
      decode(readRealFile(PATH_MONO_EN)),
      decode(readRealFile(PATH_UKRSIB)),
    ]);

    // QA protocol console summary — one line per file for the QA protocol doc
    console.log('\n[real-statements QA summary]');
    console.log(
      `mono_UA  | rows=${monoUaResult.meta.decodedRows}/${monoUaResult.meta.totalRows}` +
      ` | enc=${monoUaResult.meta.encoding} | delim=${monoUaResult.meta.delimiter}` +
      ` | hdr=${monoUaResult.meta.headerRow} | issues=${monoUaResult.issues.length}`,
    );
    console.log(
      `mono_EN  | rows=${monoEnResult.meta.decodedRows}/${monoEnResult.meta.totalRows}` +
      ` | enc=${monoEnResult.meta.encoding} | delim=${monoEnResult.meta.delimiter}` +
      ` | hdr=${monoEnResult.meta.headerRow} | issues=${monoEnResult.issues.length}`,
    );
    console.log(
      `ukrsib   | rows=${ukrsibResult.meta.decodedRows}/${ukrsibResult.meta.totalRows}` +
      ` | fmt=${ukrsibResult.meta.format} | sheet=${ukrsibResult.meta.sheet}` +
      ` | hdr=${ukrsibResult.meta.headerRow} | issues=${ukrsibResult.issues.length}`,
    );
  }, 30_000);

  // ── Security: real files MUST NOT be tracked in git ──────────────────────
  it('real statement files are NOT tracked in git', async () => {
    const { execFileSync } = await import('node:child_process');
    // execFileSync with an argument array — no shell, no injection risk.
    const tracked = execFileSync('git', ['ls-files'], {
      cwd: 'D:/abc-budget/abc-budget',
      encoding: 'utf-8',
    });
    expect(tracked).not.toMatch(/mono_/i);
    expect(tracked).not.toMatch(/ukrsib/i);
  });

  // ── mono_07-10-23_14-34-50.csv ───────────────────────────────────────────
  describe('mono_07-10-23_14-34-50.csv (Monobank UA)', () => {
    it('decoded row count is exact', () => {
      expect(monoUaResult.meta.decodedRows).toBe(MONO_UA.decodedRows);
    });

    it('total rows (physical) is exact', () => {
      expect(monoUaResult.meta.totalRows).toBe(MONO_UA.totalRows);
    });

    it('meta: format, encoding, delimiter, headerRow', () => {
      expect(monoUaResult.meta.format).toBe(MONO_UA.format);
      expect(monoUaResult.meta.encoding).toBe(MONO_UA.encoding);
      expect(monoUaResult.meta.delimiter).toBe(MONO_UA.delimiter);
      expect(monoUaResult.meta.headerRow).toBe(MONO_UA.headerRow);
    });

    it('header keys — exact ordered list', () => {
      expect(Object.keys(monoUaResult.rows[0])).toEqual(MONO_UA.keys);
    });

    it('spot: row[0] amount', () => {
      expect(monoUaResult.rows[0]['Сума в валюті картки (UAH)']).toBe(MONO_UA.spot_row0_amount);
    });

    it('spot: row[0] merchant prefix', () => {
      const desc = monoUaResult.rows[0]['Деталі операції'] as string;
      expect(desc.startsWith(MONO_UA.spot_row0_merchant_prefix)).toBe(true);
    });

    it('spot: row[0] date', () => {
      expect(monoUaResult.rows[0]['Дата i час операції']).toBe(MONO_UA.spot_row0_date);
    });

    it('placeholder row (row 1 in source) produces skipped-row issue', () => {
      const issue = monoUaResult.issues.find(
        i => i.action === 'skipped-row' && i.what === 'placeholder-row',
      );
      expect(issue).toBeDefined();
    });
  });

  // ── mono_en_21-11-23_10-34-42.csv ────────────────────────────────────────
  describe('mono_en_21-11-23_10-34-42.csv (Monobank EN)', () => {
    it('decoded row count is exact', () => {
      expect(monoEnResult.meta.decodedRows).toBe(MONO_EN.decodedRows);
    });

    it('total rows (physical) is exact', () => {
      expect(monoEnResult.meta.totalRows).toBe(MONO_EN.totalRows);
    });

    it('meta: format, encoding, delimiter, headerRow', () => {
      expect(monoEnResult.meta.format).toBe(MONO_EN.format);
      expect(monoEnResult.meta.encoding).toBe(MONO_EN.encoding);
      expect(monoEnResult.meta.delimiter).toBe(MONO_EN.delimiter);
      expect(monoEnResult.meta.headerRow).toBe(MONO_EN.headerRow);
    });

    it('header keys — exact ordered list', () => {
      expect(Object.keys(monoEnResult.rows[0])).toEqual(MONO_EN.keys);
    });

    it('spot: row[0] amount (founder-confirmed: -10780.32)', () => {
      expect(monoEnResult.rows[0]['Card currency amount, (UAH)']).toBe(MONO_EN.spot_row0_amount);
    });

    it('spot: row[0] date', () => {
      expect(monoEnResult.rows[0]['Date and time']).toBe(MONO_EN.spot_row0_date);
    });

    it('spot: row[0] balance', () => {
      expect(monoEnResult.rows[0]['Balance']).toBe(MONO_EN.spot_row0_balance);
    });

    it('zero issues (clean file, no preamble/summary)', () => {
      expect(monoEnResult.issues).toHaveLength(0);
    });
  });

  // ── ukrsib.xlsx ───────────────────────────────────────────────────────────
  describe('ukrsib.xlsx (UkrSibbank)', () => {
    it('decoded row count is exact', () => {
      expect(ukrsibResult.meta.decodedRows).toBe(UKRSIB.decodedRows);
    });

    it('total rows (physical) is exact', () => {
      expect(ukrsibResult.meta.totalRows).toBe(UKRSIB.totalRows);
    });

    it('meta: format, sheet, headerRow', () => {
      expect(ukrsibResult.meta.format).toBe(UKRSIB.format);
      expect(ukrsibResult.meta.sheet).toBe(UKRSIB.sheet);
      expect(ukrsibResult.meta.headerRow).toBe(UKRSIB.headerRow);
    });

    it('header keys — exact ordered list', () => {
      expect(Object.keys(ukrsibResult.rows[0])).toEqual(UKRSIB.keys);
    });

    it('spot: row[0] amount', () => {
      expect(ukrsibResult.rows[0]['Сума']).toBe(UKRSIB.spot_row0_amount);
    });

    it('spot: row[0] currency', () => {
      expect(ukrsibResult.rows[0]['Валюта']).toBe(UKRSIB.spot_row0_currency);
    });

    it('spot: row[0] date', () => {
      expect(ukrsibResult.rows[0]['Дата операції']).toBe(UKRSIB.spot_row0_date);
    });

    it('zero issues (clean file)', () => {
      expect(ukrsibResult.issues).toHaveLength(0);
    });
  });
});

// ============================================================================
// E2E pipeline tests — decode → service → stage1 → stage2 → row-generator
// (Story 2.3 Task 5 — founder acceptance)
//
// SECURITY NOTE: real file content is NEVER copied into this repo.
// Only aggregate counts, header key lists, and ≤3 spot cell values
// (amounts + one merchant prefix) per file are baked here.
//
// OBSERVED (2026-06-11, pipeline v2.3):
//   mono_UA  | decoded=181 | typed=181 | skipped=0  | rowErrors=0
//   mono_EN  | decoded=12  | typed=12  | skipped=0  | rowErrors=0
//   ukrsib   | decoded=997 | typed=917 | skipped=80 | rowErrors=0
//
// ukrsib Сума column: type='auto' → auto-detects 'mixed' (both income + outcome rows).
// Income rows (positive Сума) are labeled-and-discarded (VIS-011 path): 80 skipped.
// ============================================================================

// ---------------------------------------------------------------------------
// E2E helpers (local to this describe scope)
// ---------------------------------------------------------------------------

// EXCISED (2.6 decision 3): the makeStubDAOs_e2e() helper (empty
// FileFormatDAO / FileSourceDAO stubs) died with the service constructor
// params — the service no longer takes DAOs.  E2E hard counts are unchanged:
// the recall-pool path was already the live prefill mechanism (FEAT-005).

function toColumnInfo_e2e(columns: ImportStatementColumnHeaderStage2[]): ColumnInfo[] {
  return columns.map((col) => ({ id: col.id, definition: col.definition, params: col.params }));
}

async function applyMappings_e2e(
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
      default:
        await col.ignore();
        break;
    }
  }
}

// ---------------------------------------------------------------------------
// Column mappings for each real file
// ---------------------------------------------------------------------------

// mono_UA: all 181 rows have negative Сума → type: 'outcome' → 0 skipped
const MONO_UA_TRANSFORMATIONS: ColumnTransformation[] = [
  { columnName: 'Дата i час операції',       definition: ColumnDefinition.DATE,              params: { format: 'auto' } as DateColumnParams },
  { columnName: 'Деталі операції',            definition: ColumnDefinition.DESCRIPTION,       params: null },
  { columnName: 'MCC',                        definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
  { columnName: 'Сума в валюті картки (UAH)', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
  { columnName: 'Сума в валюті операції',     definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Валюта',                     definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Курс',                       definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Сума комісій (UAH)',         definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Сума кешбеку (UAH)',         definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Залишок після операції',     definition: ColumnDefinition.IGNORE,            params: null },
];

// mono_EN: all 12 rows have negative amounts → type: 'outcome' → 0 skipped
const MONO_EN_TRANSFORMATIONS: ColumnTransformation[] = [
  { columnName: 'Date and time',               definition: ColumnDefinition.DATE,              params: { format: 'auto' } as DateColumnParams },
  { columnName: 'Description',                 definition: ColumnDefinition.DESCRIPTION,       params: null },
  { columnName: 'MCC',                         definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
  { columnName: 'Card currency amount, (UAH)', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
  { columnName: 'Operation amount',            definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Operation currency',          definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Exchange rate',               definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Commission (UAH)',            definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Cashback amount (UAH)',       definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Balance',                     definition: ColumnDefinition.IGNORE,            params: null },
];

// ukrsib: mixed amounts (both positive income + negative outcome) →
// type: 'auto' auto-detects 'mixed' → income rows (positive Сума) skipped via VIS-011.
// Observed 2026-06-11: 80 income rows skipped → 917 typed rows.
// NOTE: 'Cтатус' (Cyrillic С, U+0421) is IGNORED here — STATUS transform is not
// needed for typed-row generation; the count is driven by AMOUNT sign alone.
const UKRSIB_TRANSFORMATIONS: ColumnTransformation[] = [
  { columnName: 'Cтатус',         definition: ColumnDefinition.IGNORE,       params: null },
  { columnName: 'Дата операції',  definition: ColumnDefinition.DATE,         params: { format: 'auto' } as DateColumnParams },
  { columnName: 'Опис операції',  definition: ColumnDefinition.DESCRIPTION,  params: null },
  { columnName: 'Рахунок/картка', definition: ColumnDefinition.IGNORE,       params: null },
  { columnName: 'Категорія',      definition: ColumnDefinition.IGNORE,       params: null },
  { columnName: 'Сума',           definition: ColumnDefinition.AMOUNT,       params: { type: 'auto', currency: { code: 'UAH' } } as AmountColumnParams },
  { columnName: 'Валюта',         definition: ColumnDefinition.IGNORE,       params: null },
];

// ---------------------------------------------------------------------------
// Hard-count constants (baked from observed values 2026-06-11)
// ---------------------------------------------------------------------------

const E2E_COUNTS = {
  MONO_UA: { typed: 181, skipped: 0, rowErrors: 0 },
  MONO_EN: { typed: 12,  skipped: 0, rowErrors: 0 },
  UKRSIB:  { typed: 917, skipped: 80, rowErrors: 0 },
} as const;

// ---------------------------------------------------------------------------
// Suites
// ---------------------------------------------------------------------------

describe.skipIf(!HAVE_REAL_FILES)('real statements — E2E pipeline to typed rows (local only)', () => {
  // ── E2E QA summary printed once per run ────────────────────────────────────
  let monoUaTyped = 0, monoUaSkipped = 0, monoUaErrors = 0;
  let monoEnTyped = 0, monoEnSkipped = 0, monoEnErrors = 0;
  let ukrsibTyped = 0, ukrsibSkipped = 0, ukrsibErrors = 0;

  // ── mono_07-10-23_14-34-50.csv (Monobank UA) ─────────────────────────────
  describe('mono_07-10-23_14-34-50.csv — E2E typed rows', () => {
    beforeAll(async () => {
      const decodeResult = await decode(readRealFile(PATH_MONO_UA));
      const service = new ImportStatementServiceImpl();
      const stage1 = service.startWith(decodeResult.rows);
      const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;
      await applyMappings_e2e(stage2, MONO_UA_TRANSFORMATIONS);
      const cols = await firstValueFrom(stage2.columns);
      const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
      const result = await generateRows(rows, toColumnInfo_e2e(cols), 'UAH');
      monoUaTyped = result.rows.length;
      monoUaSkipped = result.skipped.length;
      monoUaErrors = result.rowErrors.length;
      console.log(`\n[E2E] mono_UA  | decoded=${decodeResult.meta.decodedRows} | typed=${monoUaTyped} | skipped=${monoUaSkipped} | rowErrors=${monoUaErrors}`);
    }, 30_000);

    it('typed row count: 181 (all decoded rows generate — all negative amounts)', () => {
      expect(monoUaTyped).toBe(E2E_COUNTS.MONO_UA.typed);
    });

    it('skipped rows: 0 (no income rows in this export)', () => {
      expect(monoUaSkipped).toBe(E2E_COUNTS.MONO_UA.skipped);
    });

    it('rowErrors: 0 (all rows parse cleanly)', () => {
      expect(monoUaErrors).toBe(E2E_COUNTS.MONO_UA.rowErrors);
    });
  });

  // ── mono_en_21-11-23_10-34-42.csv (Monobank EN) ──────────────────────────
  describe('mono_en_21-11-23_10-34-42.csv — E2E typed rows', () => {
    beforeAll(async () => {
      const decodeResult = await decode(readRealFile(PATH_MONO_EN));
      const service = new ImportStatementServiceImpl();
      const stage1 = service.startWith(decodeResult.rows);
      const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;
      await applyMappings_e2e(stage2, MONO_EN_TRANSFORMATIONS);
      const cols = await firstValueFrom(stage2.columns);
      const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
      const result = await generateRows(rows, toColumnInfo_e2e(cols), 'UAH');
      monoEnTyped = result.rows.length;
      monoEnSkipped = result.skipped.length;
      monoEnErrors = result.rowErrors.length;
      console.log(`[E2E] mono_EN  | decoded=${decodeResult.meta.decodedRows} | typed=${monoEnTyped} | skipped=${monoEnSkipped} | rowErrors=${monoEnErrors}`);
    }, 30_000);

    it('typed row count: 12 (all decoded rows generate — all negative amounts)', () => {
      expect(monoEnTyped).toBe(E2E_COUNTS.MONO_EN.typed);
    });

    it('skipped rows: 0 (no income rows)', () => {
      expect(monoEnSkipped).toBe(E2E_COUNTS.MONO_EN.skipped);
    });

    it('rowErrors: 0', () => {
      expect(monoEnErrors).toBe(E2E_COUNTS.MONO_EN.rowErrors);
    });
  });

  // ── ukrsib.xlsx (UkrSibbank) ──────────────────────────────────────────────
  describe('ukrsib.xlsx — E2E typed rows', () => {
    beforeAll(async () => {
      const decodeResult = await decode(readRealFile(PATH_UKRSIB));
      const service = new ImportStatementServiceImpl();
      const stage1 = service.startWith(decodeResult.rows);
      const stage2 = await service.stage2(stage1) as ImportStatementStage2Impl;
      await applyMappings_e2e(stage2, UKRSIB_TRANSFORMATIONS);
      const cols = await firstValueFrom(stage2.columns);
      const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
      const result = await generateRows(rows, toColumnInfo_e2e(cols), 'UAH');
      ukrsibTyped = result.rows.length;
      ukrsibSkipped = result.skipped.length;
      ukrsibErrors = result.rowErrors.length;
      console.log(`[E2E] ukrsib   | decoded=${decodeResult.meta.decodedRows} | typed=${ukrsibTyped} | skipped=${ukrsibSkipped} | rowErrors=${ukrsibErrors}`);
    }, 30_000);

    it('typed row count: 917 (80 income rows skipped by VIS-011, 917 outcome rows generated)', () => {
      expect(ukrsibTyped).toBe(E2E_COUNTS.UKRSIB.typed);
    });

    it('skipped rows: 80 (income rows — positive Сума — discarded by VIS-011 mixed-type path)', () => {
      expect(ukrsibSkipped).toBe(E2E_COUNTS.UKRSIB.skipped);
    });

    it('typed + skipped = decoded (no rows lost)', () => {
      expect(ukrsibTyped + ukrsibSkipped).toBe(997);
    });

    it('rowErrors: 0 (no parse failures)', () => {
      expect(ukrsibErrors).toBe(E2E_COUNTS.UKRSIB.rowErrors);
    });
  });
});

// ============================================================================
// Story 2.5 — pseudo-ops E2E (PM checkpoint-(b) evidence)
//
// Per real file, the BANK_COMMISSION / CASHBACK columns are MAPPED (where they
// exist) with currency { code: 'UAH' } and the full pipeline runs to
// generateRows. Hard counts are baked from OBSERVED local runs (2026-06-11):
//
//   mono_UA  | decoded=181 | mains=181 | commission=0 | cashback=26 | skipped=0 | rowErrors=0
//   mono_EN  | decoded=12  | mains=12  | commission=0 | cashback=0  | skipped=0 | rowErrors=0
//   ukrsib   | decoded=997 | mains=917 | commission=0 | cashback=0  | skipped=80 | rowErrors=0
//
// Column findings:
//   mono UA: «Сума комісій (UAH)» → BANK_COMMISSION, «Сума кешбеку (UAH)» → CASHBACK.
//            Raw-cell census: commission all «—»; cashback 26 non-empty cells →
//            26 cashback ops. The design-doc figure of "27 cashback candidates"
//            was an off-by-one estimate: the actual export carries exactly 26
//            non-empty cashback cells (no income-skip interaction — all 181
//            mains are outcome, skipped=0). OBSERVED COUNT WINS → 26 baked.
//   mono EN: «Commission (UAH)» → BANK_COMMISSION, «Cashback amount (UAH)» → CASHBACK.
//            Raw-cell census: BOTH columns are entirely «—» in this 12-row
//            export → 0 commission ops, 0 cashback ops.
//   ukrsib:  decoded headers are [Cтатус, Дата операції, Опис операції,
//            Рахунок/картка, Категорія, Сума, Валюта] — NO commission or cashback
//            column exists in this export → nothing to map → 0 pseudo-ops.
//
// SECURITY NOTE: only aggregate counts are baked here — no cell values from the
// real files beyond the ≤3 spot cells already present above.
// ============================================================================

const PSEUDO_E2E_COUNTS = {
  MONO_UA: { mains: 181, commission: 0, cashback: 26, skipped: 0, rowErrors: 0 },
  MONO_EN: { mains: 12,  commission: 0, cashback: 0,  skipped: 0, rowErrors: 0 },
  UKRSIB:  { mains: 917, commission: 0, cashback: 0,  skipped: 80, rowErrors: 0 },
} as const;

// mono_UA with pseudo columns mapped (was IGNORE in the 2.3 E2E above)
const MONO_UA_PSEUDO_TRANSFORMATIONS: ColumnTransformation[] = [
  { columnName: 'Дата i час операції',       definition: ColumnDefinition.DATE,              params: { format: 'auto' } as DateColumnParams },
  { columnName: 'Деталі операції',            definition: ColumnDefinition.DESCRIPTION,       params: null },
  { columnName: 'MCC',                        definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
  { columnName: 'Сума в валюті картки (UAH)', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
  { columnName: 'Сума в валюті операції',     definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Валюта',                     definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Курс',                       definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Сума комісій (UAH)',         definition: ColumnDefinition.BANK_COMMISSION,   params: { currency: { code: 'UAH' } } as BankCommissionColumnParams },
  { columnName: 'Сума кешбеку (UAH)',         definition: ColumnDefinition.CASHBACK,          params: { currency: { code: 'UAH' } } as CashbackColumnParams },
  { columnName: 'Залишок після операції',     definition: ColumnDefinition.IGNORE,            params: null },
];

// mono_EN with pseudo columns mapped
const MONO_EN_PSEUDO_TRANSFORMATIONS: ColumnTransformation[] = [
  { columnName: 'Date and time',               definition: ColumnDefinition.DATE,              params: { format: 'auto' } as DateColumnParams },
  { columnName: 'Description',                 definition: ColumnDefinition.DESCRIPTION,       params: null },
  { columnName: 'MCC',                         definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
  { columnName: 'Card currency amount, (UAH)', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams },
  { columnName: 'Operation amount',            definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Operation currency',          definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Exchange rate',               definition: ColumnDefinition.IGNORE,            params: null },
  { columnName: 'Commission (UAH)',            definition: ColumnDefinition.BANK_COMMISSION,   params: { currency: { code: 'UAH' } } as BankCommissionColumnParams },
  { columnName: 'Cashback amount (UAH)',       definition: ColumnDefinition.CASHBACK,          params: { currency: { code: 'UAH' } } as CashbackColumnParams },
  { columnName: 'Balance',                     definition: ColumnDefinition.IGNORE,            params: null },
];

// ukrsib: NO commission/cashback columns exist (header inspection finding) —
// same transformations as the 2.3 E2E; pseudo counts must be exactly 0.

interface PseudoRunSummary {
  decoded: number;
  mains: number;
  commission: number;
  cashback: number;
  skipped: number;
  rowErrors: number;
  cashbackOps: import('../importStatement/stage3/types').TransactionRow[];
}

async function runPseudoPipeline(
  path: string,
  transformations: ColumnTransformation[],
): Promise<PseudoRunSummary> {
  const decodeResult = await decode(readRealFile(path));
  const service = new ImportStatementServiceImpl();
  const stage1 = service.startWith(decodeResult.rows);
  const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;
  await applyMappings_e2e(stage2, transformations);
  const cols = await firstValueFrom(stage2.columns);
  const rows: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
  const result = await generateRows(rows, toColumnInfo_e2e(cols), 'UAH');
  const cashbackOps = result.rows.filter((r) => r.isCashback);
  return {
    decoded: decodeResult.meta.decodedRows,
    mains: result.rows.filter((r) => !r.isBankCommission && !r.isCashback).length,
    commission: result.rows.filter((r) => r.isBankCommission).length,
    cashback: cashbackOps.length,
    skipped: result.skipped.length,
    rowErrors: result.rowErrors.length,
    cashbackOps,
  };
}

function printCheckpointB(label: string, s: PseudoRunSummary): void {
  console.log(
    `[checkpoint-b] ${label} | decoded=${s.decoded} → typed mains=${s.mains}` +
    ` → pseudo-ops: commission=${s.commission}, cashback=${s.cashback}` +
    ` | skipped=${s.skipped}, rowErrors=${s.rowErrors}`,
  );
}

describe.skipIf(!HAVE_REAL_FILES)('real statements — Story 2.5 pseudo-ops E2E (checkpoint-b, local only)', () => {
  // ── mono_07-10-23_14-34-50.csv ───────────────────────────────────────────
  describe('mono_07-10-23_14-34-50.csv — pseudo-ops mapped', () => {
    let s: PseudoRunSummary;

    beforeAll(async () => {
      s = await runPseudoPipeline(PATH_MONO_UA, MONO_UA_PSEUDO_TRANSFORMATIONS);
      console.log('\n[checkpoint-b summary — Story 2.5 pseudo-ops]');
      printCheckpointB('mono_UA ', s);
    }, 30_000);

    it('typed mains: 181 (unchanged by pseudo mapping)', () => {
      expect(s.mains).toBe(PSEUDO_E2E_COUNTS.MONO_UA.mains);
    });

    it('commission ops: 0 (commission column present but all cells empty in this export)', () => {
      expect(s.commission).toBe(PSEUDO_E2E_COUNTS.MONO_UA.commission);
    });

    it('cashback ops: 26 (raw census: exactly 26 non-empty cashback cells — the "27" design estimate was off by one; no income-skip interaction, all mains outcome)', () => {
      expect(s.cashback).toBe(PSEUDO_E2E_COUNTS.MONO_UA.cashback);
    });

    it('skipped: 0, rowErrors: 0', () => {
      expect(s.skipped).toBe(PSEUDO_E2E_COUNTS.MONO_UA.skipped);
      expect(s.rowErrors).toBe(PSEUDO_E2E_COUNTS.MONO_UA.rowErrors);
    });

    it('total rows = mains + commission + cashback (no rows lost or invented)', () => {
      expect(s.mains + s.commission + s.cashback).toBe(
        PSEUDO_E2E_COUNTS.MONO_UA.mains +
        PSEUDO_E2E_COUNTS.MONO_UA.commission +
        PSEUDO_E2E_COUNTS.MONO_UA.cashback,
      );
    });

    it('all cashback ops carry the synthetic description key, UAH, abs amounts > 0', () => {
      for (const op of s.cashbackOps) {
        expect(op.description).toBe('engine.importStatement.pseudo-op.cashback');
        expect(op.currency).toBe('UAH');
        expect(op.amount).toBeGreaterThan(0);
        expect(op.isBankCommission).toBe(false);
      }
    });
  });

  // ── mono_en_21-11-23_10-34-42.csv ────────────────────────────────────────
  describe('mono_en_21-11-23_10-34-42.csv — pseudo-ops mapped', () => {
    let s: PseudoRunSummary;

    beforeAll(async () => {
      s = await runPseudoPipeline(PATH_MONO_EN, MONO_EN_PSEUDO_TRANSFORMATIONS);
      printCheckpointB('mono_EN ', s);
    }, 30_000);

    it('typed mains: 12 (unchanged by pseudo mapping)', () => {
      expect(s.mains).toBe(PSEUDO_E2E_COUNTS.MONO_EN.mains);
    });

    it('commission ops: 0 (commission column all empty)', () => {
      expect(s.commission).toBe(PSEUDO_E2E_COUNTS.MONO_EN.commission);
    });

    it('cashback ops: 0 (cashback column entirely «—» in this export)', () => {
      expect(s.cashback).toBe(PSEUDO_E2E_COUNTS.MONO_EN.cashback);
    });

    it('skipped: 0, rowErrors: 0', () => {
      expect(s.skipped).toBe(PSEUDO_E2E_COUNTS.MONO_EN.skipped);
      expect(s.rowErrors).toBe(PSEUDO_E2E_COUNTS.MONO_EN.rowErrors);
    });
  });

  // ── ukrsib.xlsx ──────────────────────────────────────────────────────────
  describe('ukrsib.xlsx — no commission/cashback columns exist', () => {
    let s: PseudoRunSummary;

    beforeAll(async () => {
      s = await runPseudoPipeline(PATH_UKRSIB, UKRSIB_TRANSFORMATIONS);
      printCheckpointB('ukrsib  ', s);
    }, 30_000);

    it('header inspection: decoded keys contain NO commission or cashback column', async () => {
      const decodeResult = await decode(readRealFile(PATH_UKRSIB));
      const keys = Object.keys(decodeResult.rows[0]);
      expect(keys).toEqual([...UKRSIB.keys]);
      // No header matches commission / cashback semantics in this export
      expect(keys.some((k) => /коміс|commission/i.test(k))).toBe(false);
      expect(keys.some((k) => /кешбек|cashback/i.test(k))).toBe(false);
    });

    it('typed mains: 917, skipped: 80 (unchanged — VIS-011 income skips)', () => {
      expect(s.mains).toBe(PSEUDO_E2E_COUNTS.UKRSIB.mains);
      expect(s.skipped).toBe(PSEUDO_E2E_COUNTS.UKRSIB.skipped);
    });

    it('pseudo-ops: 0 commission, 0 cashback (nothing to map)', () => {
      expect(s.commission).toBe(PSEUDO_E2E_COUNTS.UKRSIB.commission);
      expect(s.cashback).toBe(PSEUDO_E2E_COUNTS.UKRSIB.cashback);
    });

    it('rowErrors: 0', () => {
      expect(s.rowErrors).toBe(PSEUDO_E2E_COUNTS.UKRSIB.rowErrors);
    });
  });
});

// ============================================================================
// Story 2.6 — Worker-backed E2E (checkpoint-(c))
//
// ONE variant per real file runs the FULL flow over the WORKER-BACKED client
// (real thread hop via @vitest/web-worker + the production engine-worker entry).
//
// Flow per file: decode → importStart → importApplyColumn × N → importNext
// Counts from GenerateResultDTO must equal the ESTABLISHED DIRECT-PATH HARD
// COUNTS exactly — zero drift.
//
// A compact [checkpoint-c] per-file line is printed (direct vs worker counts
// side by side) for the QA protocol.
//
// ESTABLISHED HARD COUNTS (from 2.5 pseudo-ops section):
//   mono_UA  | mains=181 | commission=0 | cashback=26 | skipped=0 | rowErrors=0
//   mono_EN  | mains=12  | commission=0 | cashback=0  | skipped=0 | rowErrors=0
//   ukrsib   | mains=917 | commission=0 | cashback=0  | skipped=80 | rowErrors=0
//
// SECURITY NOTE: real file content is NEVER copied into this repo.
// ============================================================================

// ── Worker infrastructure helpers ─────────────────────────────────────────────

/** Track open workers for cleanup. */
let _workerE2eRawWorkers: Worker[] = [];
let _workerE2eTestDbs: IDBDatabase[] = [];

/** Spawn the production worker entry (real hop, same pattern as engine-worker-host.spec.ts). */
function workerE2eFactory(): WorkerLike {
  const w = new Worker(new URL('../../engine-worker.ts', import.meta.url), { type: 'module' });
  _workerE2eRawWorkers.push(w);
  return w as unknown as WorkerLike;
}

function makeWorkerClient(): EngineClient {
  return createWorkerEngineClient(workerE2eFactory);
}

function openWorkerTestDb(): Promise<IDBDatabase> {
  return openDatabase(ENGINE_DB_NAME, ENGINE_MIGRATIONS);
}

async function trackedWorkerTestDb(): Promise<IDBDatabase> {
  const db = await openWorkerTestDb();
  _workerE2eTestDbs.push(db);
  return db;
}

/** Name extractor for Stage2ColumnDTO (same pattern as host spec). */
function workerColName(col: Stage2ColumnDTO): string {
  return 'text' in col.originalName ? col.originalName.text : col.originalName.key;
}

function findWorkerColumn(snapshot: Stage2SnapshotDTO, name: string): Stage2ColumnDTO {
  const col = snapshot.columns.find((c) => workerColName(c) === name);
  if (!col) throw new Error(`column '${name}' not in snapshot`);
  return col;
}

/** Apply all transformations in the worker-backed session; returns final snapshot. */
async function applyAllWorker(
  client: EngineClient,
  sessionId: string,
  snapshot: Stage2SnapshotDTO,
  transformations: ColumnTransformation[],
): Promise<Stage2SnapshotDTO> {
  let snap = snapshot;
  for (const t of transformations) {
    const col = findWorkerColumn(snap, t.columnName);
    const res = await client.importApplyColumn(
      sessionId,
      col.id,
      t.definition,
      t.params as Record<string, unknown> | null,
    );
    if (!res.ok) {
      throw new Error(
        `unexpected rejection for '${t.columnName}': ${JSON.stringify(res.rejection)}`,
      );
    }
    snap = res.snapshot;
  }
  return snap;
}

/** Generate synthetic CSV bytes (worker-path honesty tests). */
function makeWorkerSyntheticCsv(n: number): ArrayBuffer {
  const lines = ['Date,Amount,Description'];
  for (let i = 0; i < n; i++) {
    lines.push(`2024-01-${String((i % 28) + 1).padStart(2, '0')},-${(i % 90) + 1}.50,row ${i}`);
  }
  const buf = new TextEncoder().encode(lines.join('\n'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Per-test IDB isolation for worker tests
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetPersistenceForTests();
  resetEngineConfigForTests();
});

afterEach(() => {
  for (const w of _workerE2eRawWorkers) {
    try { w.terminate(); } catch { /* already dead */ }
  }
  _workerE2eRawWorkers = [];
  for (const db of _workerE2eTestDbs) {
    try { db.close(); } catch { /* already closed */ }
  }
  _workerE2eTestDbs = [];
});

// ── checkpoint-c: full flow over the worker per real file ─────────────────────

describe.skipIf(!HAVE_REAL_FILES)('real statements — worker-backed E2E checkpoint-(c) (local only)', () => {
  // ── mono_07-10-23_14-34-50.csv ───────────────────────────────────────────────
  describe('mono_07-10-23_14-34-50.csv — worker path', () => {
    it(
      '[checkpoint-c] full flow over the worker: counts == direct-path hard counts',
      { timeout: 60_000 },
      async () => {
        const db = await trackedWorkerTestDb();
        await setBaseCurrency(new UserSettingsIDBDAO(() => db), 'UAH');

        const client = makeWorkerClient();
        const { bytes, fileName } = readRealFile(PATH_MONO_UA);
        const decodeResult = await client.decode(bytes, fileName);

        const { sessionId, stage2 } = await client.importStart(decodeResult.rows);
        await applyAllWorker(client, sessionId, stage2, MONO_UA_PSEUDO_TRANSFORMATIONS);

        const next = await client.importNext(sessionId);
        expect(next.ok, 'importNext should succeed — base currency set, all columns mapped').toBe(true);
        if (!next.ok) throw new Error('unreachable');

        const result = next.result;
        const mains     = result.rows.filter((r) => !r.isBankCommission && !r.isCashback).length;
        const commission = result.rows.filter((r) => r.isBankCommission).length;
        const cashback  = result.rows.filter((r) => r.isCashback).length;
        const skipped   = result.skipped.length;
        const rowErrors  = result.rowErrors.length;

        // Established direct-path hard counts (PSEUDO_E2E_COUNTS.MONO_UA)
        const direct = PSEUDO_E2E_COUNTS.MONO_UA;
        console.log(
          `\n[checkpoint-c] mono_UA  | direct: mains=${direct.mains} commission=${direct.commission}` +
          ` cashback=${direct.cashback} skipped=${direct.skipped} rowErrors=${direct.rowErrors}` +
          ` | worker: mains=${mains} commission=${commission} cashback=${cashback}` +
          ` skipped=${skipped} rowErrors=${rowErrors}`,
        );

        expect(mains,      'mains: zero drift from direct path').toBe(direct.mains);
        expect(commission, 'commission: zero drift').toBe(direct.commission);
        expect(cashback,   'cashback: zero drift').toBe(direct.cashback);
        expect(skipped,    'skipped: zero drift').toBe(direct.skipped);
        expect(rowErrors,  'rowErrors: zero drift').toBe(direct.rowErrors);
      },
    );
  });

  // ── mono_en_21-11-23_10-34-42.csv ────────────────────────────────────────────
  describe('mono_en_21-11-23_10-34-42.csv — worker path', () => {
    it(
      '[checkpoint-c] full flow over the worker: counts == direct-path hard counts',
      { timeout: 60_000 },
      async () => {
        const db = await trackedWorkerTestDb();
        await setBaseCurrency(new UserSettingsIDBDAO(() => db), 'UAH');

        const client = makeWorkerClient();
        const { bytes, fileName } = readRealFile(PATH_MONO_EN);
        const decodeResult = await client.decode(bytes, fileName);

        const { sessionId, stage2 } = await client.importStart(decodeResult.rows);
        await applyAllWorker(client, sessionId, stage2, MONO_EN_PSEUDO_TRANSFORMATIONS);

        const next = await client.importNext(sessionId);
        expect(next.ok, 'importNext should succeed').toBe(true);
        if (!next.ok) throw new Error('unreachable');

        const result = next.result;
        const mains     = result.rows.filter((r) => !r.isBankCommission && !r.isCashback).length;
        const commission = result.rows.filter((r) => r.isBankCommission).length;
        const cashback  = result.rows.filter((r) => r.isCashback).length;
        const skipped   = result.skipped.length;
        const rowErrors  = result.rowErrors.length;

        const direct = PSEUDO_E2E_COUNTS.MONO_EN;
        console.log(
          `[checkpoint-c] mono_EN  | direct: mains=${direct.mains} commission=${direct.commission}` +
          ` cashback=${direct.cashback} skipped=${direct.skipped} rowErrors=${direct.rowErrors}` +
          ` | worker: mains=${mains} commission=${commission} cashback=${cashback}` +
          ` skipped=${skipped} rowErrors=${rowErrors}`,
        );

        expect(mains,      'mains: zero drift').toBe(direct.mains);
        expect(commission, 'commission: zero drift').toBe(direct.commission);
        expect(cashback,   'cashback: zero drift').toBe(direct.cashback);
        expect(skipped,    'skipped: zero drift').toBe(direct.skipped);
        expect(rowErrors,  'rowErrors: zero drift').toBe(direct.rowErrors);
      },
    );
  });

  // ── ukrsib.xlsx ───────────────────────────────────────────────────────────────
  describe('ukrsib.xlsx — worker path', () => {
    it(
      '[checkpoint-c] full flow over the worker: counts == direct-path hard counts',
      { timeout: 60_000 },
      async () => {
        const db = await trackedWorkerTestDb();
        await setBaseCurrency(new UserSettingsIDBDAO(() => db), 'UAH');

        const client = makeWorkerClient();
        const { bytes, fileName } = readRealFile(PATH_UKRSIB);
        const decodeResult = await client.decode(bytes, fileName);

        const { sessionId, stage2 } = await client.importStart(decodeResult.rows);
        await applyAllWorker(client, sessionId, stage2, UKRSIB_TRANSFORMATIONS);

        const next = await client.importNext(sessionId);
        expect(next.ok, 'importNext should succeed').toBe(true);
        if (!next.ok) throw new Error('unreachable');

        const result = next.result;
        const mains     = result.rows.filter((r) => !r.isBankCommission && !r.isCashback).length;
        const commission = result.rows.filter((r) => r.isBankCommission).length;
        const cashback  = result.rows.filter((r) => r.isCashback).length;
        const skipped   = result.skipped.length;
        const rowErrors  = result.rowErrors.length;

        const direct = PSEUDO_E2E_COUNTS.UKRSIB;
        console.log(
          `[checkpoint-c] ukrsib   | direct: mains=${direct.mains} commission=${direct.commission}` +
          ` cashback=${direct.cashback} skipped=${direct.skipped} rowErrors=${direct.rowErrors}` +
          ` | worker: mains=${mains} commission=${commission} cashback=${cashback}` +
          ` skipped=${skipped} rowErrors=${rowErrors}`,
        );

        expect(mains,      'mains: zero drift').toBe(direct.mains);
        expect(commission, 'commission: zero drift').toBe(direct.commission);
        expect(cashback,   'cashback: zero drift').toBe(direct.cashback);
        expect(skipped,    'skipped: zero drift').toBe(direct.skipped);
        expect(rowErrors,  'rowErrors: zero drift').toBe(direct.rowErrors);
      },
    );
  });
});

// ============================================================================
// Story 2.6 — Large-file honesty (10k rows through the worker)
//
// Deliverables:
//   1. Progress events: ≥2 intermediates (done < total), monotone, final done === total.
//   2. UI-thread-freeness probe: while the worker job runs the test's event loop
//      stays responsive — setInterval ticks ACCUMULATE during the await; we assert
//      ≥ some floor.
//
// Design note on the UI-thread probe in a vitest context:
//   In a browser/real-worker environment, the worker runs on a separate OS thread
//   and the main thread stays fully responsive.  In vitest (Node.js), @vitest/web-worker
//   shims the Worker API but runs everything in the same event loop — setInterval ticks
//   CAN accumulate during `await` (microtask/macrotask interleaving), but they do NOT
//   prove true multi-thread parallelism.  The probe is therefore an EVENT-LOOP LIVENESS
//   check: it confirms that the await does not BLOCK the event loop synchronously
//   (e.g., via a huge sync loop in the test code itself).  True off-thread freeness
//   is proven by the @vitest/web-worker real-hop test pattern (separate Worker module
//   graph), not by tick counting.  We document this limitation inline.
// ============================================================================

describe('real statements — 10k large-file worker honesty (synthetic fixture)', () => {
  it(
    '10k rows through the worker: progress ≥2 intermediates, monotone, final done===total; event-loop probe',
    { timeout: 60_000 },
    async () => {
      const progress: ProgressEventPayload[] = [];
      const client = makeWorkerClient();
      client.onEvent((e: EngineEventPayload) => {
        if (e.event === 'progress') progress.push(e);
      });

      // ── UI-thread-freeness probe ──────────────────────────────────────────
      // A setInterval fires macrotasks during the await.  In a real browser
      // the worker runs off-thread and ticks accumulate freely; in vitest/Node
      // they accumulate via event-loop interleaving (macrotasks after microtask
      // drains).  Either way, a tick count > 0 confirms the await yields the
      // event loop (no synchronous block in the test body).
      let intervalTicks = 0;
      const intervalHandle = setInterval(() => { intervalTicks++; }, 20);

      const csvBytes = makeWorkerSyntheticCsv(10_000);
      const decodeResult = await client.decode(csvBytes, '10k-synthetic.csv');

      clearInterval(intervalHandle);

      expect(decodeResult.rows).toHaveLength(10_000);

      // ── Progress honesty ─────────────────────────────────────────────────
      const decodeEvents = progress.filter((e) => e.phase === 'decode');
      const intermediates = decodeEvents.filter((e) => e.done < e.total);
      expect(intermediates.length, '≥2 intermediate progress events').toBeGreaterThanOrEqual(2);

      // Monotone: done never decreases; done ≤ total always
      for (let i = 0; i < decodeEvents.length; i++) {
        expect(decodeEvents[i].done).toBeLessThanOrEqual(decodeEvents[i].total);
        if (i > 0) expect(decodeEvents[i].done).toBeGreaterThanOrEqual(decodeEvents[i - 1].done);
      }

      // Final event: done === total
      const last = decodeEvents[decodeEvents.length - 1];
      expect(last.done, 'final progress: done === total').toBe(last.total);

      // All decode events share one jobId
      expect(new Set(decodeEvents.map((e) => e.jobId)).size, 'all decode events share one jobId').toBe(1);

      // ── UI-thread probe result ─────────────────────────────────────────────
      // In vitest/Node the floor is low because the shim does NOT create a real
      // OS thread — macrotasks fire only when the microtask queue is empty.
      // We assert ≥ 1 tick to confirm the event loop was NOT synchronously
      // blocked (a sync decode loop of 10k rows that never yields would give 0).
      // Higher counts (dozens) are seen in practice — print the actual count.
      console.log(
        `[10k-probe] interval ticks during 10k decode: ${intervalTicks}` +
        ` (note: in vitest/Node this probes event-loop LIVENESS, not true off-thread freeness)`,
      );
      expect(intervalTicks, 'event-loop liveness: ≥1 interval tick during the await').toBeGreaterThanOrEqual(1);
    },
  );
});

// ============================================================================
// Story 2.6 — Determinism: same worker-path run twice → identical DTO outputs
//
// Uses the mono-like-utf8.csv fixture (committed test fixture — no real data).
// Two back-to-back importNext calls with identical setup must produce:
//   - identical row counts
//   - identical hashes for every row (hash stability under COUNTERPARTY fix)
//   - identical amounts, dates, currencies, descriptions
// ============================================================================

describe('real statements — worker-path determinism (fixture, two runs)', () => {
  it(
    'same worker-path run twice → identical GenerateResultDTO incl. hashes (mono-like-utf8.csv)',
    { timeout: 60_000 },
    async () => {
      // MONO_MAPPINGS (from engine-worker-host.spec.ts — same fixture, same mapping)
      // mono-like-utf8.csv uses a DIFFERENT column set than the real mono_UA file.
      // Use the host-spec's MONO_MAPPINGS adapted for this fixture.
      const FIXTURE_MAPPINGS: ColumnTransformation[] = [
        { columnName: 'Дата i час операції',  definition: ColumnDefinition.DATE,              params: { format: 'auto' } },
        { columnName: 'Деталі операції',      definition: ColumnDefinition.DESCRIPTION,       params: null },
        { columnName: 'MCC',                  definition: ColumnDefinition.MERCHANT_CATEGORY, params: null },
        { columnName: 'Сума в валюті картки', definition: ColumnDefinition.AMOUNT,            params: { type: 'outcome', currency: { code: 'UAH' } } },
        { columnName: 'Валюта картки',        definition: ColumnDefinition.IGNORE,            params: null },
        { columnName: 'Сума в USD',           definition: ColumnDefinition.IGNORE,            params: null },
        { columnName: 'Комісія',              definition: ColumnDefinition.IGNORE,            params: null },
        { columnName: 'Кешбек',              definition: ColumnDefinition.IGNORE,            params: null },
        { columnName: 'Залишок',             definition: ColumnDefinition.IGNORE,            params: null },
      ];

      // Read the fixture file bytes (committed fixture — always present)
      const { readFileSync: nodeReadFileSync } = await import('node:fs');
      const { join: nodeJoin, dirname: nodeDirname } = await import('node:path');
      const { fileURLToPath: nodeFileUrlToPath } = await import('node:url');
      const __dirnameDet = nodeDirname(nodeFileUrlToPath(import.meta.url));
      const fixturePath = nodeJoin(__dirnameDet, 'fixtures', 'mono-like-utf8.csv');
      const nodeBuf = nodeReadFileSync(fixturePath);
      const fixtureBytes: ArrayBuffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength);

      async function runOnce(): Promise<import('../../client/dto').GenerateResultDTO> {
        // Fresh IDB universe per run — determinism does NOT rely on recall pool
        globalThis.indexedDB = new IDBFactory();
        resetPersistenceForTests();

        const db = await openWorkerTestDb();
        _workerE2eTestDbs.push(db);
        await setBaseCurrency(new UserSettingsIDBDAO(() => db), 'UAH');

        const client = makeWorkerClient();
        const decodeResult = await client.decode(fixtureBytes.slice(0), 'mono-like-utf8.csv');
        const { sessionId, stage2 } = await client.importStart(decodeResult.rows);
        await applyAllWorker(client, sessionId, stage2, FIXTURE_MAPPINGS);
        const next = await client.importNext(sessionId);
        if (!next.ok) throw new Error('importNext failed: ' + JSON.stringify(next));
        return next.result;
      }

      const run1 = await runOnce();
      const run2 = await runOnce();

      // Row counts must be identical
      expect(run2.rows.length, 'row count identical across runs').toBe(run1.rows.length);
      expect(run2.rowErrors.length, 'rowErrors count identical').toBe(run1.rowErrors.length);
      expect(run2.skipped.length, 'skipped count identical').toBe(run1.skipped.length);

      // Per-row: hash, amount, date, currency must be identical
      for (let i = 0; i < run1.rows.length; i++) {
        const r1 = run1.rows[i];
        const r2 = run2.rows[i];
        expect(r2.hash, `row[${i}] hash identical (determinism)`).toBe(r1.hash);
        expect(r2.amount, `row[${i}] amount identical`).toBe(r1.amount);
        expect(r2.date, `row[${i}] date identical`).toBe(r1.date);
        expect(r2.currency, `row[${i}] currency identical`).toBe(r1.currency);
        expect(r2.description, `row[${i}] description identical`).toBe(r1.description);
      }

      console.log(
        `[determinism] mono-like-utf8.csv worker runs: rows=${run1.rows.length}, ` +
        `all ${run1.rows.length} hashes identical across 2 runs`,
      );
    },
  );
});
