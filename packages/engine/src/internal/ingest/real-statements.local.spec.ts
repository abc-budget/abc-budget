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
import { decode } from './decode';
import type { DecodeResult } from './types';

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
