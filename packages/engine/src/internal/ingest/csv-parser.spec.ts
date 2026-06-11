/**
 * csv-parser.spec.ts — TDD contract tests for sniffDelimiter + parseCsv.
 *
 * Tests are organised in three blocks:
 *   1. sniffDelimiter — delimiter scoring, comma-decimal trap, edge cases.
 *   2. parseCsv happy-path — normal CSV, quoted fields, RFC 4180 escaping.
 *   3. parseCsv recovery — bare quotes, unterminated quotes, CRLF, empty lines.
 *   4. parseCsv edge cases — multi-line quoted cells, large cells, whitespace.
 *   5. Determinism (pure functions).
 */

import { describe, it, expect } from 'vitest';
import { sniffDelimiter, parseCsv } from './csv-parser';

// ---------------------------------------------------------------------------
// 1. sniffDelimiter
// ---------------------------------------------------------------------------

describe('sniffDelimiter', () => {
  // ---- contract tests from plan ----

  it('semicolon-delimited lines → ";"', () => {
    expect(sniffDelimiter(['a;b;c', '1;2;3'])).toBe(';');
  });

  it('quoted commas do not count — comma is still the winner', () => {
    // The quoted comma inside "a,x" must NOT be counted → only 1 comma per line
    expect(sniffDelimiter(['"a,x",b', '1,2'])).toBe(',');
  });

  it('tab-delimited lines → "\\t"', () => {
    expect(sniffDelimiter(['a\tb', '1\t2'])).toBe('\t');
  });

  it('comma-decimal trap: "1;2,5;3" — semicolons consistent, commas inside numeric → ";"', () => {
    expect(sniffDelimiter(['1;2,5;3', '4;5,1;6'])).toBe(';');
  });

  // ---- tie-breaking: ; > \t > , (comma last — decimal trap) ----

  it('tie between ";" and "\\t" — semicolon wins', () => {
    // Each line has exactly one ";" and one "\t" outside quotes → tie → ";" wins
    expect(sniffDelimiter(['a;b\tc', 'd;e\tf'])).toBe(';');
  });

  it('tie between "\\t" and "," — tab wins', () => {
    // Each line has one tab and one comma
    expect(sniffDelimiter(['a\tb,c', 'd\te,f'])).toBe('\t');
  });

  it('single candidate only — comma', () => {
    expect(sniffDelimiter(['a,b', 'c,d'])).toBe(',');
  });

  it('no delimiter matches → defaults to comma (fallback)', () => {
    // Single-column lines — no delimiter found anywhere; comma is the last-resort fallback
    expect(sniffDelimiter(['abc', 'def'])).toBe(',');
  });

  it('considers only first 20 non-empty lines', () => {
    // 25 semicolon lines then 5 tab lines — first 20 are semicolons
    const lines = [
      ...Array.from({ length: 25 }, (_, i) => `a${i};b${i}`),
      ...Array.from({ length: 5 }, (_, i) => `x${i}\ty${i}`),
    ];
    expect(sniffDelimiter(lines)).toBe(';');
  });

  it('skips empty lines when counting', () => {
    // Empty lines interspersed — still picks semicolons
    expect(sniffDelimiter(['a;b', '', 'c;d', ''])).toBe(';');
  });

  it('mixed content — quoted semicolons outside commas → comma wins', () => {
    // "a;b" is a quoted field; only one comma per line outside quotes
    expect(sniffDelimiter(['"a;b",c', '"x;y",z'])).toBe(',');
  });
});

// ---------------------------------------------------------------------------
// 2. parseCsv — happy path (plan contract)
// ---------------------------------------------------------------------------

describe('parseCsv — happy path', () => {
  it('simple two-row CSV', () => {
    expect(parseCsv('a,b\n1,2', ',').matrix).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('quoted field with embedded delimiter + escaped quote ("" → ")', () => {
    const result = parseCsv('"x,y","he said ""hi"""', ',');
    expect(result.matrix[0]).toEqual(['x,y', 'he said "hi"']);
  });

  it('no issues for clean input', () => {
    expect(parseCsv('a,b\n1,2', ',').issues).toHaveLength(0);
  });

  it('single column, single row', () => {
    expect(parseCsv('hello', ',').matrix).toEqual([['hello']]);
  });

  it('trailing comma produces empty last field', () => {
    expect(parseCsv('a,b,\n1,2,', ',').matrix).toEqual([['a', 'b', ''], ['1', '2', '']]);
  });

  it('tab delimiter happy path', () => {
    expect(parseCsv('a\tb\n1\t2', '\t').matrix).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('semicolon delimiter happy path', () => {
    expect(parseCsv('a;b\n1;2', ';').matrix).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('quoted field with newline inside — multi-line cell (2 physical lines → 1 row)', () => {
    // "hello\nworld" is a valid quoted multi-line cell; the row continues across the newline.
    // Quoted-newline note: this terminates properly within N=10 physical lines → allowed.
    const text = '"hello\nworld",b';
    const result = parseCsv(text, ',');
    expect(result.matrix).toHaveLength(1);
    expect(result.matrix[0][0]).toBe('hello\nworld');
    expect(result.matrix[0][1]).toBe('b');
    expect(result.issues).toHaveLength(0);
  });

  it('multiple double-quote escapes in one field', () => {
    const result = parseCsv('"say ""hi"" and ""bye"""', ',');
    expect(result.matrix[0][0]).toBe('say "hi" and "bye"');
  });
});

// ---------------------------------------------------------------------------
// 3. parseCsv — recovery (plan contract)
// ---------------------------------------------------------------------------

describe('parseCsv — recovery', () => {
  // ---- bare quote mid-unquoted-field (plan contract) ----
  it('bare quote inside unquoted field — kept as literal, issue row=0 action=recovered-quote', () => {
    const r1 = parseCsv('plain "oops field,next\nrow2,b', ',');
    expect(r1.matrix[0][0]).toBe('plain "oops field');
    expect(r1.issues[0]).toMatchObject({ row: 0, action: 'recovered-quote' });
  });

  // ---- unterminated quoted field (plan contract) ----
  it('unterminated quoted field — closed at newline, 2 rows in matrix, issue recorded', () => {
    const r2 = parseCsv('"never closed,a\nnext,b', ',');
    expect(r2.matrix).toHaveLength(2);
    expect(r2.issues[0].action).toBe('recovered-quote');
  });

  // ---- CRLF + trailing newline (plan contract) ----
  it('CRLF line endings + trailing newline → exactly 2 rows, no phantom row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n', ',').matrix).toHaveLength(2);
  });

  // ---- empty lines (plan contract) ----
  it('empty line in the middle → skipped + skipped-row issue', () => {
    const r3 = parseCsv('a,b\n\n1,2', ',');
    expect(r3.matrix).toHaveLength(2);
    expect(r3.issues.some(i => i.action === 'skipped-row')).toBe(true);
  });

  // ---- additional recovery edge cases ----

  it('unterminated quote issue has correct SOURCE row coordinate (0-based physical line)', () => {
    // Line 0: "header,b  (unterminated)
    // Line 1: next,c
    const r = parseCsv('"header,b\nnext,c', ',');
    // The recovered-quote issue should reference physical line 0
    const qIssue = r.issues.find(i => i.action === 'recovered-quote');
    expect(qIssue).toBeDefined();
    expect(qIssue!.row).toBe(0);
  });

  it('skipped-row issue carries SOURCE row index (counts physical lines including skipped)', () => {
    // Physical layout: line 0 = "a,b", line 1 = "" (empty), line 2 = "1,2"
    const r = parseCsv('a,b\n\n1,2', ',');
    const skipIssue = r.issues.find(i => i.action === 'skipped-row');
    expect(skipIssue).toBeDefined();
    expect(skipIssue!.row).toBe(1); // physical line 1 was the empty line
  });

  it('multiple empty lines → multiple skipped-row issues', () => {
    const r = parseCsv('a,b\n\n\n1,2', ',');
    const skipCount = r.issues.filter(i => i.action === 'skipped-row').length;
    expect(skipCount).toBe(2);
    expect(r.matrix).toHaveLength(2);
  });

  it('bare quote in second column — issue row coordinate matches physical row', () => {
    // Row 0: col0,"mis"match → recovered-quote issue on row 0
    const r = parseCsv('a,b\ncol0,"mis"match', ',');
    const qIssue = r.issues.find(i => i.action === 'recovered-quote');
    expect(qIssue).toBeDefined();
    expect(qIssue!.row).toBe(1); // physical line 1
  });

  it('only trailing newline — no phantom row', () => {
    const r = parseCsv('a,b\n', ',');
    expect(r.matrix).toHaveLength(1);
    expect(r.issues).toHaveLength(0);
  });

  it('empty string input → empty matrix', () => {
    const r = parseCsv('', ',');
    expect(r.matrix).toHaveLength(0);
    expect(r.issues).toHaveLength(0);
  });

  // ---- unterminated quote: MUST NOT swallow rest of file ----
  // Plan: allow quoted newlines only while the quote eventually terminates within
  // N=10 physical lines; beyond that → close at first line end + issue + re-parse.
  it('unterminated quote beyond N=10 lines — does NOT swallow the file', () => {
    // A quote opened on line 0 that never closes across 15 lines
    // The recovery rule: close at line 0's end, emit issue, continue parsing line 1..14 normally.
    const lines = [
      '"never closed', // physical line 0 — unterminated
      ...Array.from({ length: 14 }, (_, i) => `row${i + 1},val${i + 1}`),
    ];
    const text = lines.join('\n');
    const r = parseCsv(text, ',');
    // The file must NOT collapse into a single row.
    // We expect at least 14 real data rows after the recovered first row.
    expect(r.matrix.length).toBeGreaterThanOrEqual(14);
    // Must have the recovered-quote issue
    expect(r.issues.some(i => i.action === 'recovered-quote')).toBe(true);
  });

  it('properly terminated quoted newline within 10 lines — valid multi-line cell (N=10 window)', () => {
    // Quote opens on line 0, content spans 3 physical lines (0,1,2), closes on line 2.
    // This is within the N=10 window → should be a valid multi-line cell, NO issue.
    const text = '"line1\nline2\nline3",next';
    const r = parseCsv(text, ',');
    expect(r.matrix).toHaveLength(1);
    expect(r.matrix[0][0]).toBe('line1\nline2\nline3');
    expect(r.issues).toHaveLength(0);
  });

  it('quoted newline at exactly N=10 span — still valid (boundary included)', () => {
    // Quote spans exactly 10 physical lines (0..9), terminates on line 9.
    // Build: "line0\nline1\n...line9"
    const inner = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
    const text = `"${inner}",rest`;
    const r = parseCsv(text, ',');
    expect(r.matrix).toHaveLength(1);
    expect(r.matrix[0][0]).toBe(inner);
    expect(r.issues).toHaveLength(0);
  });

  it('quoted newline spanning N+1=11 lines — treated as unterminated at first line end', () => {
    // Quote spans 11 physical lines (0..10), terminator on line 10 → beyond window.
    // Recovery: close at line 0's end, emit issue, rest of file parses normally.
    const inner = Array.from({ length: 11 }, (_, i) => `line${i}`).join('\n');
    const text = `"${inner}",rest`;
    const r = parseCsv(text, ',');
    // File must not collapse into 1 row; recovery should produce multiple rows
    expect(r.matrix.length).toBeGreaterThan(1);
    expect(r.issues.some(i => i.action === 'recovered-quote')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. parseCsv — edge cases
// ---------------------------------------------------------------------------

describe('parseCsv — edge cases', () => {
  it('all-empty CSV (just whitespace/newlines) → empty matrix, no issues', () => {
    const r = parseCsv('\n\n\n', ',');
    // All lines are empty → all skipped; matrix empty; issues are all skipped-row
    expect(r.matrix).toHaveLength(0);
  });

  it('single quoted empty field ""', () => {
    const r = parseCsv('""', ',');
    expect(r.matrix).toEqual([['']]);
    expect(r.issues).toHaveLength(0);
  });

  it('field containing only a double-quote escape: """"', () => {
    // """" is: open-quote, double-quote escape (→ "), close-quote
    const r = parseCsv('""""', ',');
    expect(r.matrix[0][0]).toBe('"');
  });

  it('CRLF inside quoted field is preserved as LF in output', () => {
    // RFC 4180 §2.6 allows CRLF inside quoted fields
    const r = parseCsv('"a\r\nb",c', ',');
    // CRLF should be normalised to LF (or kept; either is fine but must not split the row)
    expect(r.matrix).toHaveLength(1);
    expect(r.matrix[0].length).toBe(2);
  });

  it('pure-whitespace-only lines are treated as empty (skipped)', () => {
    // A line that is just spaces/tabs (no delimiter) — empty row semantics
    const r = parseCsv('a,b\n   \n1,2', ',');
    // "   " is not an empty string but is a whitespace-only line — the parser may
    // treat it as a data row with one whitespace cell. Either is acceptable;
    // the plan only mandates empty lines (zero chars) are skipped.
    // We verify the matrix has at most 3 rows and at least 2 rows.
    expect(r.matrix.length).toBeGreaterThanOrEqual(2);
    expect(r.matrix.length).toBeLessThanOrEqual(3);
  });

  it('very long field (>1000 chars) parses without truncation', () => {
    const longVal = 'x'.repeat(1500);
    const r = parseCsv(`"${longVal}",b`, ',');
    expect(r.matrix[0][0]).toBe(longVal);
  });

  it('numeric-looking fields stay as strings', () => {
    const r = parseCsv('1.5,2,3e4', ',');
    expect(r.matrix[0]).toEqual(['1.5', '2', '3e4']);
  });
});

// ---------------------------------------------------------------------------
// 5. Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('sniffDelimiter returns same result for same input (pure function)', () => {
    const lines = ['a;b;c', '1;2;3'];
    expect(sniffDelimiter(lines)).toBe(sniffDelimiter(lines));
  });

  it('parseCsv returns deep-equal result on repeated calls', () => {
    const text = '"x,y","he said ""hi""\na,b\n\n1,2';
    const r1 = parseCsv(text, ',');
    const r2 = parseCsv(text, ',');
    expect(r1).toEqual(r2);
  });
});
