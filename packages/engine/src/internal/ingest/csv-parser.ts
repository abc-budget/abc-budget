/**
 * csv-parser.ts — tolerant CSV parser for the ingest pipeline.
 *
 * Exports two pure functions:
 *   • sniffDelimiter(lines)  — score `,` `;` `\t` candidates outside quotes;
 *                              tie-break: `;` > `\t` > `,` (comma-decimal trap).
 *   • parseCsv(text, delim)  — single-pass char state machine;
 *                              recovery on bare quotes + unterminated quotes.
 *
 * ── Quoted-newline vs. unterminated-quote resolution ─────────────────────────
 *
 * RFC 4180 allows a quoted field to span multiple physical lines.  The two
 * competing requirements are:
 *   (A) A *properly* quoted multi-line cell must work (newline is content).
 *   (B) An *unterminated* quote must NOT swallow the rest of the file.
 *
 * Rule: LOOKAHEAD WINDOW N = 10.
 *   When the parser is in IN_QUOTES state and reaches the end of the current
 *   physical line (without having seen a closing `"`), it looks ahead across
 *   up to N additional physical lines — i.e. lines[openLine+1 .. openLine+N+1] —
 *   for a closing `"` (one that is not part of a `""` escape).
 *
 *   • Closing `"` FOUND within the window:
 *     → newline is literal content; parse continues on the next physical line.
 *     → No issue emitted.
 *
 *   • Closing `"` NOT found within N lines:
 *     → Field is treated as unterminated; closed at current line end.
 *     → `recovered-quote` issue emitted (row = physical line of opening `"`).
 *     → Only the opening line is consumed by this logical row; subsequent lines
 *       are parsed normally.
 *
 * Tests that cover both branches:
 *   "properly terminated quoted newline within 10 lines" — valid multi-line cell.
 *   "unterminated quote beyond N=10 lines"              — does NOT eat the file.
 *
 * ── State machine ─────────────────────────────────────────────────────────────
 *   FIELD_START     — beginning of a new field.
 *   IN_FIELD        — inside an unquoted field.
 *   IN_QUOTES       — inside a double-quoted field.
 *   QUOTE_IN_QUOTES — just saw `"` while in IN_QUOTES.
 *
 * ── Recovery rules (pinned by spec tests) ────────────────────────────────────
 *   • Bare `"` mid-unquoted-field         → literal + `recovered-quote`.
 *   • Non-delim char after closing `"`    → `recovered-quote` + char appended as literal,
 *                                           continue consuming in IN_FIELD.
 *   • Unterminated quoted field           → close at line end (window rule above).
 *   • `""` inside IN_QUOTES              → RFC 4180 escaped `"`.
 *   • CRLF → normalised to LF before parsing.
 *   • Trailing newline → no phantom row.
 *   • Empty line → skipped + `skipped-row` issue.
 *   Issues carry 0-based SOURCE (physical-line) row coordinates.
 */

import type { DecodeIssue } from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Candidates evaluated by sniffDelimiter in tie-break priority order (highest first). */
const DELIMITER_CANDIDATES = [';', '\t', ','] as const;
type Delimiter = ',' | ';' | '\t';

/**
 * Number of additional physical lines to scan for a closing quote after seeing
 * a newline inside IN_QUOTES.  Spans lines[openLine+1 .. openLine+N], inclusive.
 */
const QUOTED_NEWLINE_LOOKAHEAD = 10;

// ---------------------------------------------------------------------------
// sniffDelimiter
// ---------------------------------------------------------------------------

/**
 * Infer the field delimiter by scoring `,`, `;`, and `\t` against the first
 * ≤20 non-empty lines.
 *
 * Scoring:
 *   1. Count occurrences OUTSIDE quoted regions on each line.
 *   2. Compute the median count across lines.
 *   3. Candidate qualifies only when median > 0.
 *   4. Highest median wins; ties → `;` > `\t` > `,`.
 */
export function sniffDelimiter(lines: string[]): Delimiter {
  const nonEmpty = lines.filter(l => l.length > 0).slice(0, 20);
  if (nonEmpty.length === 0) return ',';

  let best: Delimiter | null = null;
  let bestMedian = 0;

  // Iterate in priority order; only update when STRICTLY better (ties keep earlier winner).
  for (const delim of DELIMITER_CANDIDATES) {
    const counts = nonEmpty.map(line => countOutsideQuotes(line, delim));
    const m = median(counts);
    if (m > bestMedian) {
      best = delim;
      bestMedian = m;
    }
  }

  return best ?? ',';
}

/** Count occurrences of `char` in `line` that are NOT inside double-quoted regions. */
function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === char) {
      count++;
    }
  }
  return count;
}

/** Compute the median of a numeric array.  Returns 0 for an empty array. */
function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

// ---------------------------------------------------------------------------
// parseCsv
// ---------------------------------------------------------------------------

/** Result of parseCsv. */
export interface ParseCsvResult {
  matrix: string[][];
  issues: DecodeIssue[];
  /**
   * Maps each matrix row index → the 0-based PHYSICAL (source) line number where
   * that logical row starts.  Length equals matrix.length.  Useful for translating
   * detectHeader's matrix-index `headerRow` back to a source row coordinate.
   */
  sourceRows: number[];
}

/**
 * Parse `text` as CSV with the given `delimiter`.
 * See module-level JSDoc for the state machine, recovery rules, and the
 * quoted-newline/unterminated-quote resolution (QUOTED_NEWLINE_LOOKAHEAD = 10).
 */
export function parseCsv(text: string, delimiter: Delimiter): ParseCsvResult {
  const issues: DecodeIssue[] = [];

  if (text.length === 0) {
    return { matrix: [], issues, sourceRows: [] };
  }

  // Normalise CRLF → LF, then bare CR → LF.
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Strip a single trailing newline to avoid a phantom empty row.
  const stripped = normalised.endsWith('\n') ? normalised.slice(0, -1) : normalised;

  if (stripped.length === 0) {
    return { matrix: [], issues, sourceRows: [] };
  }

  // Physical lines (0-based index = source row coordinate).
  const physLines = stripped.split('\n');

  const matrix: string[][] = [];
  const sourceRows: number[] = [];
  let lineIdx = 0;

  while (lineIdx < physLines.length) {
    const line = physLines[lineIdx];

    // Empty line → skipped-row issue.
    if (line.length === 0) {
      issues.push({
        row: lineIdx,
        what: 'empty-line',
        why: 'Physical line is empty; row skipped.',
        action: 'skipped-row',
      });
      lineIdx++;
      continue;
    }

    // Parse the logical row (may span multiple physical lines for quoted fields).
    const { row, linesConsumed, rowIssues } = parseRow(physLines, lineIdx, delimiter);

    for (const issue of rowIssues) issues.push(issue);
    sourceRows.push(lineIdx);
    matrix.push(row);
    lineIdx += linesConsumed;
  }

  return { matrix, issues, sourceRows };
}

// ---------------------------------------------------------------------------
// parseRow
// ---------------------------------------------------------------------------

interface RowResult {
  row: string[];
  linesConsumed: number;
  rowIssues: DecodeIssue[];
}

/**
 * Scan `physLines` from (fromLine, fromCol) up through physLines[absoluteMaxLine]
 * for a closing `"` that terminates a quoted field.
 *
 * `absoluteMaxLine` is computed by the caller as `fieldOpenLine + N - 1` so that
 * the window is always anchored to the field's opening line regardless of how
 * many times the check is called while extending the content buffer.
 *
 * A `""` pair counts as an escape (not a closing quote) — skip both and continue.
 */
function hasClosingQuote(
  physLines: string[],
  fromLine: number,
  fromCol: number,
  absoluteMaxLine: number,
): boolean {
  const maxLine = Math.min(absoluteMaxLine, physLines.length - 1);
  for (let li = fromLine; li <= maxLine; li++) {
    const ln = physLines[li];
    const startCol = li === fromLine ? fromCol : 0;
    for (let ci = startCol; ci < ln.length; ci++) {
      if (ln[ci] === '"') {
        if (ci + 1 < ln.length && ln[ci + 1] === '"') {
          ci++; // skip "" escape
        } else {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Parse one logical CSV row starting at `physLines[startIdx]`.
 *
 * Handles multi-line quoted fields by extending the content buffer; falls back
 * to unterminated-quote recovery when no closing `"` is found within the window.
 */
function parseRow(physLines: string[], startIdx: number, delimiter: string): RowResult {
  const rowIssues: DecodeIssue[] = [];
  const fields: string[] = [];

  // --- State machine variables ---
  type State = 'FIELD_START' | 'IN_FIELD' | 'IN_QUOTES' | 'QUOTE_IN_QUOTES';
  let state: State = 'FIELD_START';
  let fieldBuf = '';

  // lineIdx tracks which physical line we are currently parsing.
  // We start on startIdx; when a multi-line quoted field is confirmed we advance
  // lineIdx forward and append content.
  let lineIdx = startIdx;

  // fieldOpenLine: the physical line where the current field (or its opening `"`) started.
  let fieldOpenLine = startIdx;

  // We build a flat "virtual content" string for the row.  Initially it's just
  // physLines[startIdx].  Multi-line fields extend it with '\n' + next line.
  // We scan through this with a character index `pos`.
  let content = physLines[startIdx];
  let pos = 0;

  // --- Main character loop ---
  // Note: content can grow (when we extend for multi-line quoted fields).
  // The while condition is re-evaluated after every iteration.

  while (true) {
    // End-of-current-content check:
    if (pos >= content.length) {
      // We have processed all characters in `content`.

      // QUOTE_IN_QUOTES at end → the `"` was a closing quote (row ends here).
      if (state === 'QUOTE_IN_QUOTES') {
        fields.push(fieldBuf);
        break;
      }

      // IN_QUOTES at end of line → lookahead to decide multi-line vs unterminated.
      if (state === 'IN_QUOTES') {
        const nextLine = lineIdx + 1;
        // Window anchored to fieldOpenLine: closing quote must be on a line no
        // further than fieldOpenLine + QUOTED_NEWLINE_LOOKAHEAD - 1.
        // Examples (N=10):
        //   open=0 → max=9  → spans 1..9  (10 physical lines, 9 inner newlines) → valid
        //   open=0 → close on line 10 → 10 > 9 → unterminated (N+1 case)
        const absoluteMax = fieldOpenLine + QUOTED_NEWLINE_LOOKAHEAD - 1;
        const hasClose = nextLine < physLines.length
          ? hasClosingQuote(physLines, nextLine, 0, absoluteMax)
          : false;

        if (hasClose && nextLine < physLines.length) {
          // Valid multi-line field: extend content, append '\n' as literal content.
          // We must not increment lineIdx here because the loop iteration that
          // processes '\n' (the IN_QUOTES case) will do so via the tracked index.
          // Instead we embed the newline and next line into `content` and let the
          // character loop handle them.
          content += '\n' + physLines[nextLine];
          // After extending, the next char at `pos` is '\n', which the IN_QUOTES
          // case will consume as content and will increment lineIdx.
          // Continue the loop (pos < content.length now).
          continue;
        } else {
          // Unterminated: close field at this line end.
          rowIssues.push({
            row: fieldOpenLine,
            what: 'unterminated-quote',
            why: `Quoted field opened on physical line ${fieldOpenLine} has no closing quote within ${QUOTED_NEWLINE_LOOKAHEAD} lines; closed at line end.`,
            raw: fieldBuf.length > 200 ? fieldBuf.slice(0, 200) : fieldBuf,
            action: 'recovered-quote',
          });
          fields.push(fieldBuf);
          // Only consume lines up to and including fieldOpenLine.
          return {
            row: fields,
            linesConsumed: fieldOpenLine - startIdx + 1,
            rowIssues,
          };
        }
      }

      // IN_FIELD or FIELD_START at end → row ends normally.
      if (state === 'IN_FIELD') {
        fields.push(fieldBuf);
      } else {
        // FIELD_START at end: happens after a trailing delimiter → push empty field.
        // Detect: was the last character of content a delimiter?
        if (content.length > 0 && content[content.length - 1] === delimiter) {
          fields.push('');
        }
        // else: state was FIELD_START from the very beginning (only possible if content
        // was empty, which is handled before we reach parseRow).
      }
      break;
    }

    // Process the character at `pos`.
    const ch = content[pos];

    switch (state) {
      case 'FIELD_START': {
        if (ch === '"') {
          state = 'IN_QUOTES';
          fieldOpenLine = lineIdx;
          pos++;
        } else if (ch === delimiter) {
          fields.push('');
          pos++;
          // state stays FIELD_START
        } else {
          state = 'IN_FIELD';
          fieldBuf += ch;
          pos++;
        }
        break;
      }

      case 'IN_FIELD': {
        if (ch === delimiter) {
          fields.push(fieldBuf);
          fieldBuf = '';
          fieldOpenLine = lineIdx;
          state = 'FIELD_START';
          pos++;
        } else if (ch === '"') {
          // Bare quote mid-unquoted-field → literal + issue.
          rowIssues.push({
            row: lineIdx,
            what: 'bare-quote',
            why: `Unquoted field on physical line ${lineIdx} contains a bare double-quote; kept as literal.`,
            raw: fieldBuf.length > 200 ? fieldBuf.slice(0, 200) : fieldBuf,
            action: 'recovered-quote',
          });
          fieldBuf += ch;
          pos++;
        } else {
          fieldBuf += ch;
          pos++;
        }
        break;
      }

      case 'IN_QUOTES': {
        if (ch === '"') {
          state = 'QUOTE_IN_QUOTES';
          pos++;
        } else if (ch === '\n') {
          // Newline content inside a valid multi-line quoted field.
          // (We only reach here after having extended `content`, so we know
          // this newline is confirmed content.)
          fieldBuf += '\n';
          lineIdx++; // advance our physical-line tracker
          pos++;
        } else {
          fieldBuf += ch;
          pos++;
        }
        break;
      }

      case 'QUOTE_IN_QUOTES': {
        if (ch === '"') {
          // `""` → escaped `"`
          fieldBuf += '"';
          state = 'IN_QUOTES';
          pos++;
        } else if (ch === delimiter) {
          // Closing quote followed by delimiter → finish field normally.
          fields.push(fieldBuf);
          fieldBuf = '';
          fieldOpenLine = lineIdx;
          state = 'FIELD_START';
          pos++;
        } else if (ch === '\n') {
          // Closing quote at end of a (multi-line-extended) content newline.
          // Treat as row end; finish field.
          fields.push(fieldBuf);
          fieldBuf = '';
          lineIdx++; // the '\n' represents moving to the next physical line
          // We want to stop this row here.  Advance pos past end to break.
          pos = content.length;
        } else {
          // Closing `"` followed by non-quote/non-delimiter → recovery.
          rowIssues.push({
            row: fieldOpenLine,
            what: 'post-quote-garbage',
            why: `Quoted field on physical line ${fieldOpenLine} has extra characters after closing quote; treated as literal.`,
            raw: (fieldBuf + ch).slice(0, 200),
            action: 'recovered-quote',
          });
          fieldBuf += ch;
          state = 'IN_FIELD';
          pos++;
        }
        break;
      }
    }
  }

  return {
    row: fields,
    linesConsumed: lineIdx - startIdx + 1,
    rowIssues,
  };
}
