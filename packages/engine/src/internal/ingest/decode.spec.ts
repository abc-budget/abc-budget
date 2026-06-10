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

    it('spreadsheet stub: .xlsx file → file-unreadable issue with spreadsheet note', async () => {
      // Fake XLSX magic bytes (PK\x03\x04)
      const magic = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00]);
      const result = await decode({
        bytes: magic.buffer,
        fileName: 'bank-statement.xlsx',
      });
      expect(result.rows).toHaveLength(0);
      expect(result.meta.format).toBe('xlsx');
      const issue = result.issues.find(i => i.action === 'file-unreadable');
      expect(issue).toBeDefined();
      expect(issue?.what).toBe('spreadsheet-not-implemented');
    });

    it('spreadsheet stub: .xls file → file-unreadable issue with spreadsheet note', async () => {
      // Fake BIFF magic bytes (D0 CF 11 E0)
      const magic = new Uint8Array([0xD0, 0xCF, 0x11, 0xE0, 0x00, 0x00]);
      const result = await decode({
        bytes: magic.buffer,
        fileName: 'bank-statement.xls',
      });
      expect(result.rows).toHaveLength(0);
      expect(result.meta.format).toBe('xls');
      const issue = result.issues.find(i => i.action === 'file-unreadable');
      expect(issue).toBeDefined();
    });
  });
});
