/**
 * header-detect.ts — header row detection and row keying for the ingest pipeline.
 *
 * Exports two pure functions:
 *   • detectHeader(matrix)   — scan first ≤25 rows; score each; best above floor wins;
 *                              below floor → headerRow -1 + positional keys col_1..col_N.
 *   • keyRows(matrix, header) — convert raw matrix to keyed records;
 *                              skip preamble, placeholder, and summary rows;
 *                              handle ragged rows; dedup keys.
 *
 * ── Scoring ────────────────────────────────────────────────────────────────────
 *
 *   score(row i) =
 *     F1 × F2 × F3
 *
 *   F1 = (non-empty distinct string cells in row i) / max(width(row i), 1)
 *        where "string cell" means the value is non-numeric (the trim is non-empty
 *        AND parseFloat(trim) is NaN).
 *
 *   F2 = consistency(next 3 rows, width(row i))
 *        = proportion of the next up-to-3 rows whose width is ≥ width(row i).
 *        (Measuring whether the following rows look like data with the same schema.)
 *
 *   F3 = non-numeric-majority bonus
 *        = 1.5 if F1 ≥ 0.5 (majority of cells are non-numeric strings), else 1.0.
 *
 *   SCORE_FLOOR = 0.30 (empirically chosen; all-numeric rows score F1=0).
 *
 * ── Ragged-row resolution ───────────────────────────────────────────────────────
 *
 *   The plan's contract for ragged rows in keyRows is:
 *     "pad short rows + `padded-row` issue; columns beyond the header width get
 *      positional keys + issue"
 *
 *   Resolution chosen:
 *     • SHORT rows (fewer cells than header width): padded with '' fill → `padded-row`.
 *     • LONG rows (more cells than header width): extra cells are NOT dropped.
 *       They are assigned deterministic positional keys `col_{i+1}` (1-based, where
 *       i is the 0-based column index beyond the header width), and a `truncated-row`
 *       issue is emitted with a `why` explaining that extras were preserved under
 *       positional keys rather than silently discarded.
 *
 *   Rationale: dropping data silently is worse than an issue entry. The `truncated-row`
 *   action is the closest existing enum value to "this row had more columns than
 *   expected" — it signals that the structural expectation was exceeded.
 *
 * ── Trailing / inline summary rows ──────────────────────────────────────────────
 *
 *   A row is detected as a summary row when BOTH conditions hold:
 *     1. The first cell (after trim) matches /^(Разом|Всього|Total|Итого)/i.
 *     2. ≤40% of the row's cells are non-empty (after trim).
 *
 *   Both conditions must hold simultaneously. The check applies to every data row
 *   (not only trailing ones), which correctly handles mid-statement sub-totals too.
 *
 * ── Placeholder rows ─────────────────────────────────────────────────────────────
 *
 *   A row is a placeholder row when every cell after trim is in {'', '-', '—', 'N/A'}.
 *
 * ── Key deduplication ────────────────────────────────────────────────────────────
 *
 *   Duplicate header keys are resolved by appending `_2`, `_3`, … suffixes in
 *   left-to-right order (first occurrence keeps the original name).
 */

import type { DecodeIssue } from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DetectHeaderResult {
  /** 0-based row index in the source matrix; -1 if no header detected. */
  headerRow: number;
  /** Column keys in left-to-right order, deduplicated. */
  keys: string[];
  /** Issues collected during detection (preamble skips, renames, file-level). */
  issues: DecodeIssue[];
}

export interface KeyRowsResult {
  rows: Record<string, unknown>[];
  issues: DecodeIssue[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of rows to scan for a header. */
const MAX_SCAN_ROWS = 25;

/** Minimum score (inclusive) for a row to be accepted as a header. */
const SCORE_FLOOR = 0.30;

/** Placeholder cell values (after trim). */
const PLACEHOLDER_CELLS = new Set(['', '-', '—', 'N/A']);

/** Summary row regex: first cell after trim must match. */
const SUMMARY_RE = /^(Разом|Всього|Total|Итого)/i;

/** Maximum fill ratio for a row to qualify as a summary (inclusive). */
const SUMMARY_MAX_FILL = 0.40;

// ---------------------------------------------------------------------------
// detectHeader
// ---------------------------------------------------------------------------

/**
 * Analyse `matrix` and determine which row is the header.
 *
 * Scans the first ≤25 rows, scores each, and picks the highest-scoring row
 * above SCORE_FLOOR.  All rows before the winner are reported as preamble
 * (`skipped-row` issues).  Duplicate keys are deduplicated with `_2`, `_3`
 * suffixes (+`renamed-column` issues).
 *
 * If no row clears the floor, returns headerRow=-1 with positional keys
 * col_1..col_N (N = widest row in the matrix) and a file-level issue.
 */
export function detectHeader(matrix: string[][]): DetectHeaderResult {
  const issues: DecodeIssue[] = [];

  if (matrix.length === 0) {
    return { headerRow: -1, keys: [], issues };
  }

  const scanLimit = Math.min(matrix.length, MAX_SCAN_ROWS);

  // ── Score each candidate row ──────────────────────────────────────────────

  let bestRow = -1;
  let bestScore = -1;

  for (let i = 0; i < scanLimit; i++) {
    const score = scoreRow(matrix, i);
    if (score > bestScore) {
      bestScore = score;
      bestRow = i;
    }
  }

  // ── Check floor ──────────────────────────────────────────────────────────

  if (bestScore < SCORE_FLOOR) {
    // No header found.
    const widest = widestRowWidth(matrix);
    const keys = positionalKeys(widest);
    issues.push({
      row: -1,
      what: 'no-header',
      why: `No header row found in the first ${scanLimit} rows (best score ${bestScore.toFixed(3)} < floor ${SCORE_FLOOR}); using positional keys.`,
      action: 'no-data',
    });
    return { headerRow: -1, keys, issues };
  }

  // ── Emit preamble issues ──────────────────────────────────────────────────

  for (let i = 0; i < bestRow; i++) {
    issues.push({
      row: i,
      what: 'preamble-row',
      why: `Row ${i} precedes the detected header (row ${bestRow}); treated as preamble and skipped.`,
      raw: matrix[i].join('|').slice(0, 200),
      action: 'skipped-row',
    });
  }

  // ── Build + dedup keys ────────────────────────────────────────────────────

  const rawKeys = matrix[bestRow];
  const { keys, renameIssues } = deduplicateKeys(rawKeys, bestRow);

  return { headerRow: bestRow, keys, issues: [...issues, ...renameIssues] };
}

// ---------------------------------------------------------------------------
// keyRows
// ---------------------------------------------------------------------------

/**
 * Convert `matrix` rows to keyed records using the detected header.
 *
 * Rules (applied in order per row):
 *   1. Rows before headerRow → skipped + `skipped-row` issue.
 *   2. Header row itself → skipped (it defines keys, not data).
 *   3. All-placeholder rows (every cell after trim ∈ PLACEHOLDER_CELLS) → skipped.
 *   4. Summary rows (keyword + ≤40% fill) → skipped.
 *   5. Ragged SHORT → padded + `padded-row` issue.
 *   6. Ragged LONG → extras under positional keys + `truncated-row` issue.
 *   7. Normal row → keyed by header keys.
 *
 * When headerRow is -1, no rows are treated as preamble and all rows are keyed.
 */
export function keyRows(
  matrix: string[][],
  header: Pick<DetectHeaderResult, 'headerRow' | 'keys'>,
): KeyRowsResult {
  const { headerRow, keys } = header;
  const rows: Record<string, unknown>[] = [];
  const issues: DecodeIssue[] = [];

  for (let i = 0; i < matrix.length; i++) {
    const raw = matrix[i];

    // 1. Pre-header preamble
    if (headerRow >= 0 && i < headerRow) {
      issues.push({
        row: i,
        what: 'preamble-row',
        why: `Row ${i} precedes header row ${headerRow}; skipped.`,
        raw: raw.join('|').slice(0, 200),
        action: 'skipped-row',
      });
      continue;
    }

    // 2. Header row itself
    if (i === headerRow) continue;

    // 3. All-placeholder row
    if (isPlaceholderRow(raw)) {
      issues.push({
        row: i,
        what: 'placeholder-row',
        why: `Row ${i} contains only placeholder values (empty, '-', '—', 'N/A'); skipped.`,
        raw: raw.join('|').slice(0, 200),
        action: 'skipped-row',
      });
      continue;
    }

    // 4. Summary row
    if (isSummaryRow(raw)) {
      issues.push({
        row: i,
        what: 'summary-row',
        why: `Row ${i} matches the summary-row pattern (keyword '${raw[0]?.trim()}' in first cell, ≤${Math.round(SUMMARY_MAX_FILL * 100)}% fill); skipped.`,
        raw: raw.join('|').slice(0, 200),
        action: 'skipped-row',
      });
      continue;
    }

    // 5 & 6. Build record (with ragged handling)
    const record: Record<string, unknown> = {};
    const width = keys.length;

    // Pad or keep as-is
    const cells = raw.length < width
      ? [...raw, ...Array<string>(width - raw.length).fill('')]
      : raw;

    if (raw.length < width) {
      issues.push({
        row: i,
        what: 'ragged-short',
        why: `Row ${i} has ${raw.length} cell(s) but the header has ${width}; padded with empty strings.`,
        action: 'padded-row',
      });
    }

    // Assign header-keyed cells
    for (let col = 0; col < width; col++) {
      record[keys[col]] = cells[col] ?? '';
    }

    // Handle extra cells beyond header width
    if (raw.length > width) {
      const extraCount = raw.length - width;
      const extraKeys: string[] = [];
      for (let col = width; col < raw.length; col++) {
        const posKey = `col_${col + 1}`;
        record[posKey] = raw[col];
        extraKeys.push(posKey);
      }
      issues.push({
        row: i,
        what: 'ragged-long',
        why: `Row ${i} has ${raw.length} cell(s) but the header has ${width}; ${extraCount} extra cell(s) preserved under positional key(s) ${extraKeys.join(', ')} instead of being silently dropped.`,
        action: 'truncated-row',
      });
    }

    rows.push(record);
  }

  return { rows, issues };
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

/**
 * Score row `i` of `matrix` as a candidate header.
 * Returns a value in [0, ∞); rows that score below SCORE_FLOOR are rejected.
 */
function scoreRow(matrix: string[][], i: number): number {
  const row = matrix[i];
  const width = row.length;
  if (width === 0) return 0;

  // F1: non-empty distinct string (non-numeric) cells / width
  const distinctStrings = new Set<string>();
  for (const cell of row) {
    const t = cell.trim();
    if (t === '') continue;
    const asNum = Number(t.replace(',', '.'));
    if (isNaN(asNum)) {
      distinctStrings.add(t);
    }
  }
  const f1 = distinctStrings.size / width;

  // F2: consistency — proportion of next up-to-3 rows with width ≥ this width
  let consistentCount = 0;
  let nextRows = 0;
  for (let j = i + 1; j <= i + 3 && j < matrix.length; j++) {
    nextRows++;
    if (matrix[j].length >= width) consistentCount++;
  }
  const f2 = nextRows === 0 ? 1.0 : consistentCount / nextRows;

  // F3: non-numeric majority bonus
  const f3 = f1 >= 0.5 ? 1.5 : 1.0;

  return f1 * f2 * f3;
}

// ---------------------------------------------------------------------------
// Key deduplication
// ---------------------------------------------------------------------------

function deduplicateKeys(
  rawKeys: string[],
  headerRow: number,
): { keys: string[]; renameIssues: DecodeIssue[] } {
  const seen = new Map<string, number>(); // base key → occurrence count
  const keys: string[] = [];
  const renameIssues: DecodeIssue[] = [];

  for (let col = 0; col < rawKeys.length; col++) {
    const base = rawKeys[col];
    const count = seen.get(base) ?? 0;

    if (count === 0) {
      keys.push(base);
      seen.set(base, 1);
    } else {
      const suffix = count + 1;
      const newKey = `${base}_${suffix}`;
      keys.push(newKey);
      seen.set(base, suffix);
      renameIssues.push({
        row: headerRow,
        column: col,
        what: 'duplicate-column',
        why: `Column '${base}' at index ${col} is a duplicate; renamed to '${newKey}'.`,
        raw: base,
        action: 'renamed-column',
      });
    }
  }

  return { keys, renameIssues };
}

// ---------------------------------------------------------------------------
// Misc helpers
// ---------------------------------------------------------------------------

/** True when every cell in `row` after trim is in PLACEHOLDER_CELLS. */
function isPlaceholderRow(row: string[]): boolean {
  if (row.length === 0) return true;
  return row.every(cell => PLACEHOLDER_CELLS.has(cell.trim()));
}

/**
 * True when the row matches both summary conditions (keyword + fill).
 *
 * Fill calculation: (number of non-empty cells EXCLUDING the first/keyword cell)
 * divided by (total cells).  This matches the PRIVAT_LIKE contract where
 * ['Разом', '', '-209,50'] (1 non-first non-empty out of 3 total = 33%) is skipped
 * while ordinary data rows with the same total-cell fill would not be confused with
 * summary rows because their first cell would not match the keyword regex.
 */
function isSummaryRow(row: string[]): boolean {
  if (row.length === 0) return false;
  const firstTrim = (row[0] ?? '').trim();
  if (!SUMMARY_RE.test(firstTrim)) return false;

  // Count non-first cells that are non-empty
  const nonFirstNonEmpty = row.slice(1).filter(c => c.trim() !== '').length;
  const fillRatio = nonFirstNonEmpty / row.length;
  return fillRatio <= SUMMARY_MAX_FILL;
}

/** Returns the width of the widest row (0 if matrix is empty). */
function widestRowWidth(matrix: string[][]): number {
  let max = 0;
  for (const row of matrix) {
    if (row.length > max) max = row.length;
  }
  return max;
}

/** Generate positional keys col_1..col_N. */
function positionalKeys(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `col_${i + 1}`);
}
