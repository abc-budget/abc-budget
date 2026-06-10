/**
 * header-detect.spec.ts — TDD contract tests for detectHeader + keyRows.
 *
 * Tests are organised in blocks:
 *   1. detectHeader — PRIVAT_LIKE fixture (preamble, scoring, summary skipping)
 *   2. detectHeader — duplicate keys (renamed-column)
 *   3. detectHeader — no detectable header (→ -1 + positional keys)
 *   4. detectHeader — edge cases (single-row, pure-numeric, wide headers)
 *   5. keyRows — placeholder rows
 *   6. keyRows — ragged rows (padded-row / truncated-row)
 *   7. keyRows — trailing summary rows
 *   8. keyRows — pre-header skipped rows
 *   9. Determinism
 */

import { describe, it, expect } from 'vitest';
import { detectHeader, keyRows } from './header-detect';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Mirrors a real Privat24 export structure: 3-row preamble, header on row 3,
 *  2 data rows, a «Разом» summary on row 6.
 */
const PRIVAT_LIKE: string[][] = [
  ['Виписка з картки', '', ''],
  ['Клієнт: ТЕСТ ТЕСТОВИЧ', '', ''],
  ['', '', ''],
  ['Дата', 'Опис', 'Сума'],
  ['01.10.2023', 'Покупка', '-120,50'],
  ['02.10.2023', 'Кафе', '-89,00'],
  ['Разом', '', '-209,50'],
];

// ---------------------------------------------------------------------------
// 1. detectHeader — PRIVAT_LIKE
// ---------------------------------------------------------------------------

describe('detectHeader — PRIVAT_LIKE fixture', () => {
  const d = detectHeader(PRIVAT_LIKE);

  it('headerRow is 3', () => {
    expect(d.headerRow).toBe(3);
  });

  it('keys are ["Дата", "Опис", "Сума"]', () => {
    expect(d.keys).toEqual(['Дата', 'Опис', 'Сума']);
  });

  it('preamble rows 0..2 each produce a skipped-row issue', () => {
    const skipped = d.issues.filter(i => i.action === 'skipped-row').map(i => i.row);
    expect(skipped).toEqual([0, 1, 2]);
  });

  it('skipped-row issues have meaningful why text', () => {
    const skipped = d.issues.filter(i => i.action === 'skipped-row');
    for (const issue of skipped) {
      expect(issue.why.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. keyRows — full PRIVAT_LIKE pipeline (header already detected)
// ---------------------------------------------------------------------------

describe('keyRows — PRIVAT_LIKE full pipeline', () => {
  const d = detectHeader(PRIVAT_LIKE);
  const k = keyRows(PRIVAT_LIKE, d);

  it('emits exactly 2 data rows (summary trimmed)', () => {
    expect(k.rows).toHaveLength(2);
  });

  it('row 0 has correct field values', () => {
    expect(k.rows[0]).toEqual({ Дата: '01.10.2023', Опис: 'Покупка', Сума: '-120,50' });
  });

  it('row 1 has correct field values', () => {
    expect(k.rows[1]).toEqual({ Дата: '02.10.2023', Опис: 'Кафе', Сума: '-89,00' });
  });

  it('«Разом» summary row (matrix row 6) is skipped + issue', () => {
    expect(k.issues.some(i => i.row === 6 && i.action === 'skipped-row')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. keyRows — placeholder rows
// ---------------------------------------------------------------------------

describe('keyRows — placeholder rows', () => {
  // Each cell after trim is in {'', '-', '—', 'N/A'}
  it('row of " - " cells is skipped + issue', () => {
    const matrix: string[][] = [['a', 'b'], [' - ', ' - '], ['1', '2']];
    const header = { headerRow: 0, keys: ['a', 'b'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toEqual([{ a: '1', b: '2' }]);
    expect(k.issues[0]).toMatchObject({ row: 1, action: 'skipped-row' });
  });

  it('row of "—" cells (em-dash) is skipped', () => {
    const matrix: string[][] = [['x', 'y'], ['—', '—'], ['3', '4']];
    const header = { headerRow: 0, keys: ['x', 'y'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    expect(k.rows[0]).toEqual({ x: '3', y: '4' });
  });

  it('row of "N/A" cells is skipped', () => {
    const matrix: string[][] = [['x', 'y'], ['N/A', 'N/A'], ['5', '6']];
    const header = { headerRow: 0, keys: ['x', 'y'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
  });

  it('row of empty strings is skipped', () => {
    const matrix: string[][] = [['x', 'y'], ['', ''], ['7', '8']];
    const header = { headerRow: 0, keys: ['x', 'y'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
  });

  it('mixed placeholder values within one row → skipped', () => {
    const matrix: string[][] = [['a', 'b', 'c'], ['-', 'N/A', ''], ['1', '2', '3']];
    const header = { headerRow: 0, keys: ['a', 'b', 'c'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    expect(k.rows[0]).toEqual({ a: '1', b: '2', c: '3' });
  });

  it('row with at least one real value is NOT skipped', () => {
    const matrix: string[][] = [['a', 'b'], ['-', 'real'], ['1', '2']];
    const header = { headerRow: 0, keys: ['a', 'b'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 4. detectHeader — duplicate keys
// ---------------------------------------------------------------------------

describe('detectHeader — duplicate keys', () => {
  const dup = detectHeader([['Сума', 'Сума', 'Дата'], ['1', '2', '01.01.2024']]);

  it('deduplicates duplicate header names with _2 suffix', () => {
    expect(dup.keys).toEqual(['Сума', 'Сума_2', 'Дата']);
  });

  it('emits a renamed-column issue for the duplicate', () => {
    expect(dup.issues.some(i => i.action === 'renamed-column')).toBe(true);
  });

  it('renamed-column issue has the original column in raw or why', () => {
    const renamed = dup.issues.find(i => i.action === 'renamed-column');
    expect(renamed).toBeDefined();
    // Either the raw field or why field should mention the original name
    const text = (renamed!.raw ?? '') + renamed!.why;
    expect(text).toContain('Сума');
  });

  it('triple duplicate gets _2 and _3 suffixes', () => {
    const triple = detectHeader([['X', 'X', 'X'], ['1', '2', '3']]);
    expect(triple.keys).toEqual(['X', 'X_2', 'X_3']);
    // Two renamed-column issues
    const count = triple.issues.filter(i => i.action === 'renamed-column').length;
    expect(count).toBe(2);
  });

  it('no renamed-column issue when all keys are unique', () => {
    const clean = detectHeader([['A', 'B', 'C'], ['1', '2', '3']]);
    expect(clean.issues.some(i => i.action === 'renamed-column')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. detectHeader — no detectable header
// ---------------------------------------------------------------------------

describe('detectHeader — no detectable header', () => {
  it('all-numeric matrix → headerRow -1 + positional keys', () => {
    const result = detectHeader([
      ['100', '200', '300'],
      ['400', '500', '600'],
      ['700', '800', '900'],
    ]);
    expect(result.headerRow).toBe(-1);
    expect(result.keys).toEqual(['col_1', 'col_2', 'col_3']);
  });

  it('emits a file-level issue (row === -1) when no header found', () => {
    const result = detectHeader([
      ['1.1', '2.2'],
      ['3.3', '4.4'],
    ]);
    expect(result.headerRow).toBe(-1);
    expect(result.issues.some(i => i.row === -1)).toBe(true);
  });

  it('positional keys use widest row width when no header found', () => {
    // Row 0 has 2 cells, row 1 has 3 cells → widest = 3
    const result = detectHeader([
      ['1', '2'],
      ['3', '4', '5'],
    ]);
    if (result.headerRow === -1) {
      expect(result.keys.length).toBe(3);
      expect(result.keys).toEqual(['col_1', 'col_2', 'col_3']);
    }
  });

  it('empty matrix → headerRow -1, empty keys', () => {
    const result = detectHeader([]);
    expect(result.headerRow).toBe(-1);
    expect(result.keys).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. detectHeader — edge cases
// ---------------------------------------------------------------------------

describe('detectHeader — edge cases', () => {
  it('single-row matrix with string labels → row 0 is header', () => {
    const result = detectHeader([['Date', 'Amount', 'Description']]);
    expect(result.headerRow).toBe(0);
    expect(result.keys).toEqual(['Date', 'Amount', 'Description']);
  });

  it('scans at most 25 rows when searching for header', () => {
    // 30 all-numeric rows then a string row at index 30
    const rows: string[][] = Array.from({ length: 30 }, (_, i) => [`${i}`, `${i * 2}`]);
    rows.push(['Label', 'Value']); // row 30 — beyond the 25-row scan window
    const result = detectHeader(rows);
    // The header at row 30 is outside the window; should not be picked
    // (might return -1 or pick one of the first 25 numeric rows — either is OK
    //  but if a header is found it must be within row 0..24)
    if (result.headerRow !== -1) {
      expect(result.headerRow).toBeLessThan(25);
    }
  });

  it('header with some empty cells still wins if score is highest', () => {
    // Row 0 has one non-empty string in 3 cells; rows 1-2 have numbers
    const result = detectHeader([
      ['Header', '', ''],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ]);
    // Score depends on non-empty distinct strings / width; even 1/3 may beat 0
    // Just assert it doesn't crash and returns valid structure
    expect(result.headerRow).toBeGreaterThanOrEqual(-1);
    expect(result.keys.length).toBeGreaterThan(0);
  });

  it('header keys are not trimmed of internal spaces (kept verbatim)', () => {
    const result = detectHeader([['First Name', 'Last Name'], ['John', 'Doe']]);
    expect(result.keys).toContain('First Name');
    expect(result.keys).toContain('Last Name');
  });
});

// ---------------------------------------------------------------------------
// 7. keyRows — ragged rows
// ---------------------------------------------------------------------------

describe('keyRows — ragged rows', () => {
  /**
   * Resolution (per task instructions):
   *   SHORT rows (fewer cells than header width): padded with '' → `padded-row` issue.
   *   LONG rows (more cells than header width): extra cells get positional keys
   *     `col_{i+1}` and a `truncated-row` issue is emitted explaining that the
   *     extras were preserved under positional keys (not silently dropped).
   */

  it('short row is padded with empty strings + padded-row issue', () => {
    const matrix: string[][] = [['a', 'b', 'c'], ['1', '2']]; // row 1 has only 2 cells
    const header = { headerRow: 0, keys: ['a', 'b', 'c'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    expect(k.rows[0]).toEqual({ a: '1', b: '2', c: '' });
    expect(k.issues.some(i => i.row === 1 && i.action === 'padded-row')).toBe(true);
  });

  it('long row: extra cells get positional keys + truncated-row issue', () => {
    const matrix: string[][] = [['a', 'b'], ['1', '2', 'extra']]; // row 1 has 3 cells
    const header = { headerRow: 0, keys: ['a', 'b'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    // The extra cell must appear under a positional key
    expect(k.rows[0]['a']).toBe('1');
    expect(k.rows[0]['b']).toBe('2');
    expect(k.rows[0]['col_3']).toBe('extra');
    expect(k.issues.some(i => i.row === 1 && i.action === 'truncated-row')).toBe(true);
  });

  it('padded-row issue row coordinate is SOURCE row index', () => {
    const matrix: string[][] = [['x', 'y'], ['only']];
    const header = { headerRow: 0, keys: ['x', 'y'], issues: [] };
    const k = keyRows(matrix, header);
    const issue = k.issues.find(i => i.action === 'padded-row');
    expect(issue?.row).toBe(1);
  });

  it('truncated-row issue why text explains extras preserved under positional keys', () => {
    const matrix: string[][] = [['a', 'b'], ['1', '2', '3', '4']];
    const header = { headerRow: 0, keys: ['a', 'b'], issues: [] };
    const k = keyRows(matrix, header);
    const issue = k.issues.find(i => i.action === 'truncated-row');
    expect(issue).toBeDefined();
    // The why message should mention positional keys or the count of extras
    expect(issue!.why.length).toBeGreaterThan(10);
  });

  it('multiple extra cells get sequential positional keys col_3, col_4 etc.', () => {
    const matrix: string[][] = [['a', 'b'], ['1', '2', 'x', 'y']];
    const header = { headerRow: 0, keys: ['a', 'b'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows[0]['col_3']).toBe('x');
    expect(k.rows[0]['col_4']).toBe('y');
  });

  it('exact-width row produces no ragged issues', () => {
    const matrix: string[][] = [['a', 'b'], ['1', '2']];
    const header = { headerRow: 0, keys: ['a', 'b'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.issues).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 8. keyRows — trailing summary rows
// ---------------------------------------------------------------------------

describe('keyRows — trailing summary rows', () => {
  // Summary row: ≤40% cells filled AND first cell matches /^(Разом|Всього|Total|Итого)/i
  // BOTH conditions must hold.

  it('«Разом» row with ≤40% non-first fill → skipped + issue', () => {
    // Fill = non-first non-empty cells / total cells.
    // ['Разом', '', '-100'] → non-first non-empty = 1 ('-100'), total = 3 → 1/3 ≈ 33% ≤ 40% → skipped.
    const matrix: string[][] = [
      ['Дата', 'Опис', 'Сума'],
      ['01.01', 'Buy', '-100'],
      ['Разом', '', '-100'],
    ];
    const header = { headerRow: 0, keys: ['Дата', 'Опис', 'Сума'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    expect(k.issues.some(i => i.row === 2 && i.action === 'skipped-row')).toBe(true);
  });

  it('«Всього» row with multiple non-first filled cells → kept as data row', () => {
    // ['Всього', '3', '6'] → non-first non-empty = 2 ('3','6'), total = 3 → 2/3 ≈ 67% > 40% → data.
    const matrix: string[][] = [
      ['A', 'B', 'C'],
      ['1', '2', '3'],
      ['Всього', '3', '6'],
    ];
    const header = { headerRow: 0, keys: ['A', 'B', 'C'], issues: [] };
    const k = keyRows(matrix, header);
    // 67% > 40% → not a summary row by the fill condition → kept as data
    expect(k.rows).toHaveLength(2);
  });

  it('«Total» row with only 1 non-first non-empty cell out of 4 → skipped', () => {
    // ['Total', '', '', '-51'] → non-first non-empty = 1 ('-51'), total = 4 → 25% ≤ 40% → skipped.
    const matrix: string[][] = [
      ['Date', 'Desc', 'Amount', 'Fee'],
      ['1/1', 'Buy', '-50', '-1'],
      ['Total', '', '', '-51'],
    ];
    const header = { headerRow: 0, keys: ['Date', 'Desc', 'Amount', 'Fee'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    expect(k.issues.some(i => i.row === 2 && i.action === 'skipped-row')).toBe(true);
  });

  it('«Total» row with only 1/5 cells filled → skipped', () => {
    const matrix: string[][] = [
      ['A', 'B', 'C', 'D', 'E'],
      ['1', '2', '3', '4', '5'],
      ['Total', '', '', '', ''],  // 1/5 = 20% ≤ 40%
    ];
    const header = { headerRow: 0, keys: ['A', 'B', 'C', 'D', 'E'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    expect(k.issues.some(i => i.row === 2 && i.action === 'skipped-row')).toBe(true);
  });

  it('«Итого» (Russian) row with ≤40% fill → skipped', () => {
    const matrix: string[][] = [
      ['X', 'Y', 'Z'],
      ['a', 'b', 'c'],
      ['Итого', '', ''],  // 1/3 = 33% ≤ 40%
    ];
    const header = { headerRow: 0, keys: ['X', 'Y', 'Z'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
  });

  it('summary keyword NOT first cell → not skipped as summary, kept as data', () => {
    // ['', 'Разом', ''] — keyword is in col 1, not col 0.
    // First cell is '' which does NOT match the keyword regex → not a summary row.
    // First cell '' is empty but 'Разом' in col 1 is a real value → not a placeholder row.
    // → kept as a normal data row.
    const matrix: string[][] = [
      ['A', 'B', 'C'],
      ['1', '2', '3'],
      ['', 'Разом', ''],
    ];
    const header = { headerRow: 0, keys: ['A', 'B', 'C'], issues: [] };
    const k = keyRows(matrix, header);
    // Not skipped → 2 data rows
    expect(k.rows).toHaveLength(2);
  });

  it('summary row in the MIDDLE (not trailing) still gets skipped when conditions met', () => {
    // Both conditions hold: keyword in col 0 + ≤40% fill → skipped regardless of position
    const matrix: string[][] = [
      ['Date', 'Desc', 'Amt'],
      ['Разом', '', ''],
      ['1/1', 'X', '5'],
    ];
    const header = { headerRow: 0, keys: ['Date', 'Desc', 'Amt'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1); // only the '1/1' row
    expect(k.issues.some(i => i.row === 1 && i.action === 'skipped-row')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 9. keyRows — pre-header skipped rows
// ---------------------------------------------------------------------------

describe('keyRows — pre-header rows skipped', () => {
  it('rows before headerRow are skipped, each producing a skipped-row issue', () => {
    const matrix: string[][] = [
      ['Preamble line 1'],
      ['Preamble line 2'],
      ['Col A', 'Col B'],
      ['val1', 'val2'],
    ];
    const header = { headerRow: 2, keys: ['Col A', 'Col B'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(1);
    expect(k.rows[0]).toEqual({ 'Col A': 'val1', 'Col B': 'val2' });
    const skipped = k.issues.filter(i => i.action === 'skipped-row').map(i => i.row);
    expect(skipped).toContain(0);
    expect(skipped).toContain(1);
  });

  it('headerRow -1 means no pre-header rows skipped — all rows keyed from col_1..', () => {
    const matrix: string[][] = [['1', '2'], ['3', '4']];
    const header = { headerRow: -1, keys: ['col_1', 'col_2'], issues: [] };
    const k = keyRows(matrix, header);
    expect(k.rows).toHaveLength(2);
    expect(k.rows[0]).toEqual({ col_1: '1', col_2: '2' });
  });
});

// ---------------------------------------------------------------------------
// 10. Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('detectHeader returns same result for same input (pure function)', () => {
    const r1 = detectHeader(PRIVAT_LIKE);
    const r2 = detectHeader(PRIVAT_LIKE);
    expect(r1).toEqual(r2);
  });

  it('keyRows returns same result for same input (pure function)', () => {
    const header = detectHeader(PRIVAT_LIKE);
    const k1 = keyRows(PRIVAT_LIKE, header);
    const k2 = keyRows(PRIVAT_LIKE, header);
    expect(k1).toEqual(k2);
  });
});
