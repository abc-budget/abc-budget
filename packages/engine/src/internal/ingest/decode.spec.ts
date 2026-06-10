/**
 * decode.spec.ts — snapshot + headline tests for decode() CSV path.
 *
 * Each fixture gets:
 *   1. A full toMatchSnapshot() for the complete DecodeResult.
 *   2. Headline assertions that pin the fixture's key characteristic so snapshot
 *      churn cannot silently absorb a regression.
 *   3. A determinism check: decode twice → deep-equal.
 *
 * Fixture reading: readFileSync → Uint8Array → .buffer slice (byteOffset + byteLength
 * aware) to produce a clean ArrayBuffer even if Node returns a pooled Buffer.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from './decode';
import type { DecodeResult } from './types';

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures');

/**
 * Read a fixture file and return a clean ArrayBuffer (not a Buffer-pooled slice).
 * The byteOffset/byteLength guard handles Node's Buffer pool correctly.
 */
function readFixture(name: string): { bytes: ArrayBuffer; fileName: string } {
  const buf = readFileSync(join(FIXTURES, name));
  // Node's Buffer may be a view into a larger ArrayBuffer pool.
  // slice(byteOffset, byteOffset + byteLength) returns a fresh copy.
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { bytes, fileName: name };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepEqual(a: DecodeResult, b: DecodeResult): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('decode() — CSV path', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. privat-like-cp1251.csv
  // ─────────────────────────────────────────────────────────────────────────
  describe('privat-like-cp1251.csv', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('privat-like-cp1251.csv'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: encoding=windows-1251, delimiter=";", headerRow=8', async () => {
      const result = await decode(readFixture('privat-like-cp1251.csv'));
      expect(result.meta.encoding).toBe('windows-1251');
      expect(result.meta.delimiter).toBe(';');
      expect(result.meta.headerRow).toBe(8);
    });

    it('HEADLINE: 7 data rows decoded (preamble + summary skipped)', async () => {
      const result = await decode(readFixture('privat-like-cp1251.csv'));
      // 7 data rows: rows 9-15 (summary row 16 is skipped)
      expect(result.meta.decodedRows).toBe(7);
    });

    it('HEADLINE: Разом summary row produces skipped-row issue', async () => {
      const result = await decode(readFixture('privat-like-cp1251.csv'));
      const summaryIssue = result.issues.find(
        i => i.action === 'skipped-row' && i.what === 'summary-row',
      );
      expect(summaryIssue).toBeDefined();
    });

    it('HEADLINE: first data row has Дата key', async () => {
      const result = await decode(readFixture('privat-like-cp1251.csv'));
      expect(result.rows[0]).toHaveProperty('Дата');
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('privat-like-cp1251.csv'));
      const r2 = await decode(readFixture('privat-like-cp1251.csv'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. mono-like-utf8.csv
  // ─────────────────────────────────────────────────────────────────────────
  describe('mono-like-utf8.csv', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('mono-like-utf8.csv'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: encoding=utf-8, comma delimiter', async () => {
      const result = await decode(readFixture('mono-like-utf8.csv'));
      expect(result.meta.encoding).toBe('utf-8');
      expect(result.meta.delimiter).toBe(',');
    });

    it('HEADLINE: placeholder row (" - " cells) is skipped', async () => {
      const result = await decode(readFixture('mono-like-utf8.csv'));
      const placeholderIssue = result.issues.find(
        i => i.action === 'skipped-row' && i.what === 'placeholder-row',
      );
      expect(placeholderIssue).toBeDefined();
    });

    it('HEADLINE: commission column present in keys (Комісія)', async () => {
      const result = await decode(readFixture('mono-like-utf8.csv'));
      expect(result.rows.length).toBeGreaterThan(0);
      // Check header keys contain commission col
      expect(Object.keys(result.rows[0])).toContain('Комісія');
    });

    it('HEADLINE: "Дата i час операції" column present (LATIN i quirk)', async () => {
      const result = await decode(readFixture('mono-like-utf8.csv'));
      expect(result.rows.length).toBeGreaterThan(0);
      // The real mono file uses LATIN 'i' in "Дата i час операції"
      expect(Object.keys(result.rows[0])).toContain('Дата i час операції');
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('mono-like-utf8.csv'));
      const r2 = await decode(readFixture('mono-like-utf8.csv'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. tabs-ragged.csv
  // ─────────────────────────────────────────────────────────────────────────
  describe('tabs-ragged.csv', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('tabs-ragged.csv'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: delimiter is tab', async () => {
      const result = await decode(readFixture('tabs-ragged.csv'));
      expect(result.meta.delimiter).toBe('\t');
    });

    it('HEADLINE: ragged rows produce padded-row or truncated-row issues', async () => {
      const result = await decode(readFixture('tabs-ragged.csv'));
      const raggedIssues = result.issues.filter(
        i => i.action === 'padded-row' || i.action === 'truncated-row',
      );
      expect(raggedIssues.length).toBeGreaterThan(0);
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('tabs-ragged.csv'));
      const r2 = await decode(readFixture('tabs-ragged.csv'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. dual-currency.csv
  // ─────────────────────────────────────────────────────────────────────────
  describe('dual-currency.csv', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('dual-currency.csv'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: dual-currency cell preserved exactly', async () => {
      const result = await decode(readFixture('dual-currency.csv'));
      // The first row has a dual-currency amount cell
      const firstRow = result.rows[0];
      expect(firstRow).toBeDefined();
      expect(firstRow['Amount']).toBe('12.50 USD (461.00 UAH)');
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('dual-currency.csv'));
      const r2 = await decode(readFixture('dual-currency.csv'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. utf8-bom.csv
  // ─────────────────────────────────────────────────────────────────────────
  describe('utf8-bom.csv', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('utf8-bom.csv'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: bom===true, encoding=utf-8', async () => {
      const result = await decode(readFixture('utf8-bom.csv'));
      expect(result.meta.bom).toBe(true);
      expect(result.meta.encoding).toBe('utf-8');
    });

    it('HEADLINE: data decoded correctly despite BOM', async () => {
      const result = await decode(readFixture('utf8-bom.csv'));
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0]).toHaveProperty('Date');
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('utf8-bom.csv'));
      const r2 = await decode(readFixture('utf8-bom.csv'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. empty.csv (header only, no data rows)
  // ─────────────────────────────────────────────────────────────────────────
  describe('empty.csv', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('empty.csv'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: zero decoded rows', async () => {
      const result = await decode(readFixture('empty.csv'));
      expect(result.meta.decodedRows).toBe(0);
      expect(result.rows).toHaveLength(0);
    });

    it('HEADLINE: meta is fully populated (format, encoding, delimiter, headerRow)', async () => {
      const result = await decode(readFixture('empty.csv'));
      expect(result.meta.format).toBe('csv');
      expect(result.meta.encoding).toBe('utf-8');
      expect(result.meta.delimiter).toBeDefined();
      expect(typeof result.meta.headerRow).toBe('number');
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('empty.csv'));
      const r2 = await decode(readFixture('empty.csv'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge cases (never throw)
  // ─────────────────────────────────────────────────────────────────────────
  describe('edge cases — never throw', () => {
    it('zero-byte input → no-data issue, rows: []', async () => {
      const result = await decode({
        bytes: new ArrayBuffer(0),
        fileName: 'empty.csv',
      });
      expect(result.rows).toHaveLength(0);
      expect(result.meta.totalRows).toBe(0);
      const noDataIssue = result.issues.find(i => i.action === 'no-data');
      expect(noDataIssue).toBeDefined();
    });

    it('truncated .xlsx magic bytes → file-unreadable issue (SheetJS parse failure)', async () => {
      // Only magic prefix — not a valid ZIP/XLSX workbook; SheetJS will fail to parse.
      const magic = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
      const result = await decode({
        bytes: magic.buffer,
        fileName: 'bank-statement.xlsx',
      });
      expect(result.rows).toHaveLength(0);
      expect(result.meta.format).toBe('xlsx');
      const issue = result.issues.find(i => i.action === 'file-unreadable');
      expect(issue).toBeDefined();
    });

    it('truncated .xls magic bytes → routes to sheet path, never throws', async () => {
      // Only BIFF magic prefix — SheetJS may partially parse or return garbage,
      // but decode() must never throw and must return a valid DecodeResult.
      const magic = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0x00, 0x00]);
      const result = await decode({
        bytes: magic.buffer,
        fileName: 'bank-statement.xls',
      });
      // Must not throw; must be a valid DecodeResult
      expect(result).toBeDefined();
      expect(result.meta.format).toBe('xls');
      expect(Array.isArray(result.rows)).toBe(true);
      expect(Array.isArray(result.issues)).toBe(true);
    });

    // ── Fuzz / corrupted-input hardening ────────────────────────────────────

    it('corrupted.bin → rows: [], file-unreadable issue, never throws', async () => {
      // 4 KB mulberry32 PRNG noise (seed 0xDEADBEEF). bytes 0-3 = PK\x03\x04
      // (XLSX magic) so the file routes to the sheet path; SheetJS fails to
      // parse the corrupt ZIP archive → file-unreadable issue. Never throws.
      const result = await decode(readFixture('corrupted.bin'));
      // Must NEVER throw — this is the fundamental contract.
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows).toHaveLength(0);
      // SheetJS parse failure → file-unreadable
      const issue = result.issues.find(i => i.action === 'file-unreadable');
      expect(issue).toBeDefined();
    });

    it('corrupted bytes renamed .xlsx → SheetJS failure caught → file-unreadable, no throw', async () => {
      // Same 4 KB noise presented with a .xlsx extension.
      // decode() routes to the sheet path; SheetJS parse fails;
      // the catch wraps it as a file-unreadable issue — never throws.
      const { bytes } = readFixture('corrupted.bin');
      const result = await decode({ bytes, fileName: 'statement.xlsx' });
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.rows).toHaveLength(0);
      const issue = result.issues.find(i => i.action === 'file-unreadable');
      expect(issue).toBeDefined();
    });

    it('~5 MB synthetic CSV (deterministic 50k rows) → decodes to expected row count', async () => {
      // Generated in-test: deterministic, no timing assertions —
      // completion is the only observable (proves no stack overflow / OOM crash).
      const ROWS = 50_000;
      const header = 'Date,Amount,Description\n';
      // Each row is ~80 chars; ~50 k rows ≈ 4 MB.
      const dataRows: string[] = [];
      for (let i = 0; i < ROWS; i++) {
        // Deterministic values: row index drives date, amount, description.
        const day = String((i % 28) + 1).padStart(2, '0');
        const month = String((i % 12) + 1).padStart(2, '0');
        const year = 2020 + (i % 5);
        const amount = (-(i % 10000) / 100).toFixed(2);
        dataRows.push(`${day}.${month}.${year},${amount},Merchant ${i}`);
      }
      const csvText = header + dataRows.join('\n') + '\n';
      const encoder = new TextEncoder();
      const bytes = encoder.encode(csvText).buffer;
      const result = await decode({ bytes, fileName: 'big-synthetic.csv' });
      // All 50 000 data rows should decode (no skipped rows expected).
      expect(result.meta.decodedRows).toBe(ROWS);
      expect(result.rows).toHaveLength(ROWS);
    }, 30_000); // 30 s hard timeout — should complete much faster
  });
});

// =============================================================================
// Spreadsheet path (Task 5)
// =============================================================================

describe('decode() — spreadsheet path', () => {

  // ─────────────────────────────────────────────────────────────────────────
  // 1. bank-like.xlsx
  // ─────────────────────────────────────────────────────────────────────────
  describe('bank-like.xlsx', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('bank-like.xlsx'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: format=xlsx, headerRow=3', async () => {
      const result = await decode(readFixture('bank-like.xlsx'));
      expect(result.meta.format).toBe('xlsx');
      expect(result.meta.headerRow).toBe(3);
    });

    it('HEADLINE: 10 data rows decoded (preamble + summary skipped)', async () => {
      const result = await decode(readFixture('bank-like.xlsx'));
      expect(result.meta.decodedRows).toBe(10);
    });

    it('HEADLINE: «Разом» summary row produces skipped-row issue', async () => {
      const result = await decode(readFixture('bank-like.xlsx'));
      const summaryIssue = result.issues.find(
        i => i.action === 'skipped-row' && i.what === 'summary-row',
      );
      expect(summaryIssue).toBeDefined();
    });

    it('HEADLINE: header keys include Дата, Опис, Сума', async () => {
      const result = await decode(readFixture('bank-like.xlsx'));
      expect(result.rows.length).toBeGreaterThan(0);
      expect(Object.keys(result.rows[0])).toContain('Дата');
      expect(Object.keys(result.rows[0])).toContain('Опис');
      expect(Object.keys(result.rows[0])).toContain('Сума');
    });

    it('HEADLINE: sheet name populated', async () => {
      const result = await decode(readFixture('bank-like.xlsx'));
      expect(result.meta.sheet).toBeDefined();
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('bank-like.xlsx'));
      const r2 = await decode(readFixture('bank-like.xlsx'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. legacy.xls
  // ─────────────────────────────────────────────────────────────────────────
  describe('legacy.xls', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('legacy.xls'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: format=xls (BIFF magic-byte path)', async () => {
      const result = await decode(readFixture('legacy.xls'));
      expect(result.meta.format).toBe('xls');
    });

    it('HEADLINE: has data rows with Ukrainian strings', async () => {
      const result = await decode(readFixture('legacy.xls'));
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('HEADLINE: «Разом» summary row skipped', async () => {
      const result = await decode(readFixture('legacy.xls'));
      const summaryIssue = result.issues.find(
        i => i.action === 'skipped-row' && i.what === 'summary-row',
      );
      expect(summaryIssue).toBeDefined();
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('legacy.xls'));
      const r2 = await decode(readFixture('legacy.xls'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. multi-sheet.xlsx
  // ─────────────────────────────────────────────────────────────────────────
  describe('multi-sheet.xlsx', () => {
    it('full result matches snapshot', async () => {
      const result = await decode(readFixture('multi-sheet.xlsx'));
      expect(result).toMatchSnapshot();
    });

    it('HEADLINE: otherSheets contains [«Інфо»]', async () => {
      const result = await decode(readFixture('multi-sheet.xlsx'));
      expect(result.meta.otherSheets).toEqual(['Інфо']);
    });

    it('HEADLINE: first sheet decoded (Виписка)', async () => {
      const result = await decode(readFixture('multi-sheet.xlsx'));
      expect(result.meta.sheet).toBe('Виписка');
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('HEADLINE: format=xlsx', async () => {
      const result = await decode(readFixture('multi-sheet.xlsx'));
      expect(result.meta.format).toBe('xlsx');
    });

    it('determinism: decode twice → deep-equal', async () => {
      const r1 = await decode(readFixture('multi-sheet.xlsx'));
      const r2 = await decode(readFixture('multi-sheet.xlsx'));
      expect(deepEqual(r1, r2)).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. CSV-named file with PK (XLSX) signature — mismatch case
  // ─────────────────────────────────────────────────────────────────────────
  describe('sneaky.csv (PK-magic file with .csv extension)', () => {
    it('routes to sheet path with extension-mismatch issue', async () => {
      // Read bank-like.xlsx bytes, present as sneaky.csv
      const { bytes } = readFixture('bank-like.xlsx');
      const result = await decode({ bytes, fileName: 'sneaky.csv' });
      // Should still decode successfully (sheet path)
      expect(result.meta.format).toBe('xlsx');
      expect(result.rows.length).toBeGreaterThan(0);
      // Should flag the mismatch
      const mismatch = result.issues.find(i => i.what === 'extension-mismatch');
      expect(mismatch).toBeDefined();
      expect(mismatch?.action).toBe('kept-raw');
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Lazy-import discipline — no static 'xlsx' import in source files
  // ─────────────────────────────────────────────────────────────────────────
  describe('lazy-import discipline', () => {
    it('sheet-decoder.ts has no static `from "xlsx"` import', async () => {
      const { readFileSync } = await import('node:fs');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const dir = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(dir, 'sheet-decoder.ts'), 'utf-8');
      // Must NOT have a static ESM import of xlsx
      expect(src).not.toMatch(/from ['"]xlsx['"]/);
      // Must NOT have a static require of xlsx
      expect(src).not.toMatch(/require\(['"]xlsx['"]\)/);
      // MUST have the dynamic import
      expect(src).toMatch(/import\(['"]xlsx['"]\)/);
    });

    it('decode.ts has no static `from "xlsx"` import', async () => {
      const { readFileSync } = await import('node:fs');
      const { join, dirname } = await import('node:path');
      const { fileURLToPath } = await import('node:url');
      const dir = dirname(fileURLToPath(import.meta.url));
      const src = readFileSync(join(dir, 'decode.ts'), 'utf-8');
      expect(src).not.toMatch(/from ['"]xlsx['"]/);
      expect(src).not.toMatch(/require\(['"]xlsx['"]\)/);
    });
  });
});
