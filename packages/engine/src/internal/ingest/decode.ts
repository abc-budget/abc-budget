/**
 * decode.ts — top-level routing function for the ingest pipeline.
 *
 * Routes by file extension + content magic:
 *   .csv / .txt / unknown extension  → CSV path
 *   .xlsx / .xls                     → spreadsheet stub (Task 5)
 *
 * CSV path:
 *   decodeBytes → split physical lines → sniffDelimiter → parseCsv →
 *   detectHeader → keyRows → assemble DecodeResult
 *
 * Contract:
 *   • NEVER throws — all errors become DecodeIssue entries.
 *   • Zero-byte input → `no-data` issue, rows: [], meta.totalRows: 0.
 *   • Undecodable content → `file-unreadable` issue.
 *   • Ambiguous encoding → file-level issue (data still decoded).
 *   • Issues are merged in source-row order (file-level issues row: -1 first,
 *     then per-row issues sorted ascending by row).
 *   • meta is always fully populated.
 */

import type { DecodeInput, DecodeResult, DecodeIssue, DecodeMeta } from './types';
import { decodeBytes } from './encoding';
import { sniffDelimiter, parseCsv } from './csv-parser';
import { detectHeader, keyRows } from './header-detect';

// ---------------------------------------------------------------------------
// Spreadsheet magic-byte signatures
// ---------------------------------------------------------------------------

/** PK\x03\x04 — ZIP container (XLSX / ODS). */
const XLSX_MAGIC = [0x50, 0x4B, 0x03, 0x04] as const;

/** D0 CF 11 E0 — Compound Document (legacy .xls BIFF, .doc, etc.). */
const BIFF_MAGIC = [0xD0, 0xCF, 0x11, 0xE0] as const;

function startsWithMagic(view: Uint8Array, magic: readonly number[]): boolean {
  if (view.length < magic.length) return false;
  return magic.every((b, i) => view[i] === b);
}

// ---------------------------------------------------------------------------
// Extension helpers
// ---------------------------------------------------------------------------

type SpreadsheetExt = 'xlsx' | 'xls';
type KnownExt = 'csv' | 'txt' | SpreadsheetExt;

function getExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

function isSpreadsheetExt(ext: string): ext is SpreadsheetExt {
  return ext === 'xlsx' || ext === 'xls';
}

// ---------------------------------------------------------------------------
// Issue sorting helper
// ---------------------------------------------------------------------------

/** Sort issues: file-level (row: -1) first, then ascending by row number. */
function sortIssues(issues: DecodeIssue[]): DecodeIssue[] {
  return [...issues].sort((a, b) => {
    if (a.row === b.row) return 0;
    if (a.row === -1) return -1;
    if (b.row === -1) return 1;
    return a.row - b.row;
  });
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Decode raw file bytes into a structured row result.
 *
 * @param input  { bytes: ArrayBuffer, fileName: string }
 * @returns      Promise<DecodeResult> — always resolves, never rejects.
 */
export async function decode(input: DecodeInput): Promise<DecodeResult> {
  const { bytes, fileName } = input;
  const ext = getExtension(fileName);

  // ── Spreadsheet path (Task 5 stub) ─────────────────────────────────────────
  if (isSpreadsheetExt(ext)) {
    return decodeSpreadsheetStub(bytes, fileName, ext);
  }

  // ── CSV / text / unknown extension ─────────────────────────────────────────
  return decodeCsv(bytes, fileName, ext as KnownExt | '');
}

// ---------------------------------------------------------------------------
// CSV decode path
// ---------------------------------------------------------------------------

async function decodeCsv(
  bytes: ArrayBuffer,
  fileName: string,
  _ext: string,
): Promise<DecodeResult> {
  const allIssues: DecodeIssue[] = [];

  // 0. Zero-byte check
  if (bytes.byteLength === 0) {
    return {
      rows: [],
      issues: [{
        row: -1,
        what: 'empty-file',
        why: `File '${fileName}' is zero bytes.`,
        action: 'no-data',
      }],
      meta: {
        format: 'csv',
        encoding: undefined,
        bom: undefined,
        delimiter: undefined,
        headerRow: -1,
        totalRows: 0,
        decodedRows: 0,
      },
    };
  }

  // 1. Detect encoding + decode bytes
  let decoded: ReturnType<typeof decodeBytes>;
  try {
    decoded = decodeBytes(bytes);
  } catch (err) {
    return {
      rows: [],
      issues: [{
        row: -1,
        what: 'undecodable',
        why: `File '${fileName}' could not be decoded: ${String(err)}.`,
        action: 'file-unreadable',
      }],
      meta: {
        format: 'csv',
        headerRow: -1,
        totalRows: 0,
        decodedRows: 0,
      },
    };
  }

  const { text, encoding, bom, ambiguous } = decoded;

  if (ambiguous) {
    allIssues.push({
      row: -1,
      what: 'ambiguous-encoding',
      why: `File '${fileName}' failed UTF-8 validation and the cp1251 fallback text contains <1% Cyrillic characters — encoding may be incorrect.`,
      action: 'kept-raw',
    });
  }

  // 2. Split physical lines + sniff delimiter
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const physLines = normalised.split('\n').filter((_, i, arr) =>
    // keep all but a single trailing empty
    i < arr.length - 1 || arr[arr.length - 1] !== ''
  );

  // Handle truly empty after normalisation
  if (physLines.length === 0 || (physLines.length === 1 && physLines[0] === '')) {
    return {
      rows: [],
      issues: [...allIssues, {
        row: -1,
        what: 'empty-file',
        why: `File '${fileName}' contains no data rows after decoding.`,
        action: 'no-data',
      }],
      meta: {
        format: 'csv',
        encoding,
        bom,
        delimiter: undefined,
        headerRow: -1,
        totalRows: 0,
        decodedRows: 0,
      },
    };
  }

  const delimiter = sniffDelimiter(physLines);

  // 3. Parse CSV
  const { matrix, issues: parseIssues, sourceRows } = parseCsv(text, delimiter);
  allIssues.push(...parseIssues);

  // 4. Detect header
  const headerResult = detectHeader(matrix);
  allIssues.push(...headerResult.issues);

  // Translate the matrix-index headerRow to a SOURCE row number using sourceRows[].
  // parseCsv skips empty lines (they get skipped-row issues) so matrix[i] corresponds
  // to sourceRows[i], not simply i.
  const headerRowSource = headerResult.headerRow >= 0
    ? (sourceRows[headerResult.headerRow] ?? headerResult.headerRow)
    : -1;

  // Also translate preamble/rename issues emitted by detectHeader: they use matrix
  // indices, so we remap them to source rows before merging.
  const remappedHeaderIssues = headerResult.issues.map(issue => {
    if (issue.row >= 0 && issue.row < sourceRows.length) {
      return { ...issue, row: sourceRows[issue.row] };
    }
    return issue;
  });
  // Replace the header issues we pushed with the remapped ones.
  // (We pushed headerResult.issues above — undo that and push remapped.)
  allIssues.splice(allIssues.length - headerResult.issues.length, headerResult.issues.length, ...remappedHeaderIssues);

  // 5. Key rows
  const keyResult = keyRows(matrix, headerResult);
  // Remap keyRows issues (which also use matrix indices) to source rows.
  const remappedKeyIssues = keyResult.issues.map(issue => {
    if (issue.row >= 0 && issue.row < sourceRows.length) {
      return { ...issue, row: sourceRows[issue.row] };
    }
    return issue;
  });
  allIssues.push(...remappedKeyIssues);

  // 6. Assemble meta
  // totalRows = rows in matrix after removing the header row itself
  const totalRows = headerResult.headerRow >= 0
    ? Math.max(0, matrix.length - headerResult.headerRow - 1)
    : matrix.length;

  const meta: DecodeMeta = {
    format: 'csv',
    encoding,
    bom,
    delimiter,
    headerRow: headerRowSource,
    totalRows,
    decodedRows: keyResult.rows.length,
  };

  return {
    rows: keyResult.rows,
    issues: sortIssues(allIssues),
    meta,
  };
}

// ---------------------------------------------------------------------------
// Spreadsheet stub (Task 5)
// ---------------------------------------------------------------------------

async function decodeSpreadsheetStub(
  bytes: ArrayBuffer,
  fileName: string,
  ext: SpreadsheetExt,
): Promise<DecodeResult> {
  const view = new Uint8Array(bytes);

  // Detect format by content signature (not just extension).
  // Trust magic bytes; fall back to the file extension if neither matches
  // (encrypted files have different magic and are reported as file-unreadable).
  let format: 'xlsx' | 'xls' = ext;
  if (startsWithMagic(view, XLSX_MAGIC)) {
    format = 'xlsx';
  } else if (startsWithMagic(view, BIFF_MAGIC)) {
    format = 'xls';
  }

  return {
    rows: [],
    issues: [{
      row: -1,
      what: 'spreadsheet-not-implemented',
      why: `File '${fileName}' appears to be a ${format.toUpperCase()} spreadsheet. ` +
        `Spreadsheet decoding lands in Task 5 — this stub detects the ` +
        `${startsWithMagic(view, XLSX_MAGIC) ? 'PK (ZIP/XLSX)' : startsWithMagic(view, BIFF_MAGIC) ? 'D0CF (BIFF/XLS)' : 'unknown'} ` +
        `signature and returns a clean error. Replace this stub with sheet-decoder.ts at Task 5.`,
      action: 'file-unreadable',
    }],
    meta: {
      format,
      headerRow: -1,
      totalRows: 0,
      decodedRows: 0,
    },
  };
}
