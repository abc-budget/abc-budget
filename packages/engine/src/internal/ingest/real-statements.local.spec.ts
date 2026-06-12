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

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { firstValueFrom } from 'rxjs';
import { decode } from './decode';
import type { DecodeResult } from './types';
import { ImportStatementServiceImpl } from '../importStatement/service';
import type { FileFormatDAO, FileSourceDAO } from '../importStatement/dao';
import { ImportStatementColumn } from '../importStatement/stage2/column';
import { ImportStatementStage2Impl } from '../importStatement/stage2/implementation';
import { ColumnDefinition } from '../importStatement/types';
import type {
  AmountColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  DateColumnParams,
  ColumnTransformation,
} from '../importStatement/types';
import type { ImportStatementColumnHeaderStage2, ImportStatementRowData } from '../importStatement/stage2/types';
import { generateRows } from '../importStatement/stage3/row-generator';
import type { ColumnInfo } from '../importStatement/stage3/row-generator';

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

function makeStubDAOs_e2e(): { fileFormatDAO: FileFormatDAO; fileSourceDAO: FileSourceDAO } {
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
      const { fileFormatDAO, fileSourceDAO } = makeStubDAOs_e2e();
      const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
      const { fileFormatDAO, fileSourceDAO } = makeStubDAOs_e2e();
      const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
      const { fileFormatDAO, fileSourceDAO } = makeStubDAOs_e2e();
      const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
  const { fileFormatDAO, fileSourceDAO } = makeStubDAOs_e2e();
  const service = new ImportStatementServiceImpl(fileFormatDAO, fileSourceDAO);
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
