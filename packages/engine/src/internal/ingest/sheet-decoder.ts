/**
 * sheet-decoder.ts — spreadsheet decode path for the ingest pipeline.
 *
 * Handles .xlsx (ZIP/PK magic) and .xls (BIFF/D0CF magic) files via SheetJS.
 *
 * LAZY IMPORT: xlsx is loaded via dynamic import() so it is absent from the
 * boot bundle. This module is the ONLY place xlsx is imported.
 *
 * // why: npm 'xlsx' is stale w/ CVEs; cdn.sheetjs.com is the official dist (pinned)
 * // See ingest/README.md §SheetJS for full rationale and supply-chain notes.
 *
 * Contract:
 *   • NEVER throws — read failures and encrypted workbooks become DecodeIssues.
 *   • Format detected by file SIGNATURE (magic bytes), not by extension.
 *   • Only the first sheet is decoded; remaining sheet names go to meta.otherSheets.
 *   • The matrix → header/rows path is shared with the CSV decoder.
 */

import type { DecodeResult, DecodeIssue, DecodeMeta } from './types';
import { detectHeader, keyRows } from './header-detect';

// ---------------------------------------------------------------------------
// Magic-byte signatures (same constants as decode.ts — kept local to avoid
// coupling; sheet-decoder should be importable standalone for testing)
// ---------------------------------------------------------------------------

/** PK\x03\x04 — ZIP container (XLSX / ODS). */
const XLSX_MAGIC = [0x50, 0x4B, 0x03, 0x04] as const;

/** D0 CF 11 E0 — Compound Document (legacy .xls BIFF, .doc, etc.). */
const BIFF_MAGIC = [0xD0, 0xCF, 0x11, 0xE0] as const;

function detectFormat(view: Uint8Array): 'xlsx' | 'xls' | 'unknown' {
  if (view.length >= 4) {
    if (XLSX_MAGIC.every((b, i) => view[i] === b)) return 'xlsx';
    if (BIFF_MAGIC.every((b, i) => view[i] === b)) return 'xls';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Lazy xlsx import
// ---------------------------------------------------------------------------

type XLSXModule = typeof import('xlsx');

let xlsxPromise: Promise<XLSXModule> | null = null;

async function loadXLSX(): Promise<XLSXModule> {
  // why: npm 'xlsx' is stale w/ CVEs; cdn.sheetjs.com is the official dist (pinned)
  xlsxPromise ??= (async () => {
    const XLSX = (await import('xlsx')) as XLSXModule;
    // The module build does NOT auto-load codepage tables — without set_cptable,
    // cp1251 strings in real legacy .xls files mojibake in the BROWSER (node masks it).
    // Found via the harness console: "Codepage tables are not loaded." (2.1 Task 8).
    const cptable = await import('xlsx/dist/cpexcel.full.mjs');
    (XLSX as unknown as { set_cptable(t: unknown): void }).set_cptable(cptable);
    return XLSX;
  })();
  return xlsxPromise;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode an XLS or XLSX file from raw bytes.
 *
 * @param bytes     Raw file bytes (ArrayBuffer).
 * @param fileName  Original file name — used only for issue messages.
 * @returns         Always resolves to a DecodeResult; never throws.
 */
export async function decodeSheet(
  bytes: ArrayBuffer,
  fileName: string,
): Promise<DecodeResult> {
  const view = new Uint8Array(bytes);
  const sigFormat = detectFormat(view);

  // Determine format: trust signature; fall back to extension if unknown.
  const extLower = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  const format: 'xlsx' | 'xls' =
    sigFormat === 'xlsx' ? 'xlsx' :
    sigFormat === 'xls'  ? 'xls'  :
    (extLower === 'xlsx' || extLower === 'xls') ? extLower as 'xlsx' | 'xls' :
    'xlsx'; // fallback (shouldn't reach here in practice)

  // Collect file-level issues (signature/extension mismatch, etc.)
  const allIssues: DecodeIssue[] = [];

  // Note signature/extension mismatch (e.g. .csv-named file with PK magic).
  if (sigFormat !== 'unknown' && extLower !== sigFormat && extLower !== 'xlsx' && extLower !== 'xls') {
    allIssues.push({
      row: -1,
      what: 'extension-mismatch',
      why: `File '${fileName}' has extension '.${extLower}' but its content signature ` +
           `matches ${sigFormat.toUpperCase()} (${sigFormat === 'xlsx' ? 'PK/ZIP' : 'D0CF/BIFF'}). ` +
           `Decoded as ${format.toUpperCase()}.`,
      action: 'kept-raw',
    });
  }

  // Zero-byte guard
  if (bytes.byteLength === 0) {
    return {
      rows: [],
      issues: [{
        row: -1,
        what: 'empty-file',
        why: `File '${fileName}' is zero bytes.`,
        action: 'no-data',
      }],
      meta: emptyMeta(format),
    };
  }

  // ---------------------------------------------------------------------------
  // Load SheetJS and parse workbook
  // ---------------------------------------------------------------------------
  let XLSX: XLSXModule;
  try {
    XLSX = await loadXLSX();
  } catch (err) {
    return {
      rows: [],
      issues: [...allIssues, {
        row: -1,
        what: 'xlsx-load-failed',
        why: `Failed to load SheetJS library: ${String(err)}.`,
        action: 'file-unreadable',
      }],
      meta: emptyMeta(format),
    };
  }

  let workbook: ReturnType<XLSXModule['read']>;
  try {
    workbook = XLSX.read(new Uint8Array(bytes), {
      type: 'array',
      codepage: 1251,
    });
  } catch (err) {
    const reason = String(err);
    const isEncrypted = /encrypt|password|protected/i.test(reason);
    return {
      rows: [],
      issues: [...allIssues, {
        row: -1,
        what: isEncrypted ? 'encrypted-file' : 'parse-error',
        why: `File '${fileName}' could not be parsed by SheetJS: ${reason}.`,
        action: 'file-unreadable',
      }],
      meta: emptyMeta(format),
    };
  }

  // ---------------------------------------------------------------------------
  // Empty-workbook guard
  // ---------------------------------------------------------------------------
  const sheetNames: string[] = workbook.SheetNames ?? [];
  if (sheetNames.length === 0) {
    return {
      rows: [],
      issues: [...allIssues, {
        row: -1,
        what: 'empty-workbook',
        why: `File '${fileName}' contains no sheets.`,
        action: 'no-data',
      }],
      meta: emptyMeta(format),
    };
  }

  // ---------------------------------------------------------------------------
  // Decode first sheet
  // ---------------------------------------------------------------------------
  const firstSheetName = sheetNames[0];
  const otherSheets = sheetNames.slice(1);
  const ws = workbook.Sheets[firstSheetName];

  if (!ws) {
    return {
      rows: [],
      issues: [...allIssues, {
        row: -1,
        what: 'empty-sheet',
        why: `First sheet '${firstSheetName}' in '${fileName}' is empty or missing.`,
        action: 'no-data',
      }],
      meta: {
        ...emptyMeta(format),
        sheet: firstSheetName,
        otherSheets: otherSheets.length > 0 ? otherSheets : undefined,
      },
    };
  }

  // Convert to string matrix: header:1 → row arrays; raw:false → formatted strings;
  // defval:'' → fill empty cells with empty string.
  let matrix: string[][];
  try {
    matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: false,
      defval: '',
    }) as string[][];
  } catch (err) {
    return {
      rows: [],
      issues: [...allIssues, {
        row: -1,
        what: 'sheet-read-error',
        why: `Could not read sheet '${firstSheetName}' from '${fileName}': ${String(err)}.`,
        action: 'file-unreadable',
      }],
      meta: {
        ...emptyMeta(format),
        sheet: firstSheetName,
        otherSheets: otherSheets.length > 0 ? otherSheets : undefined,
      },
    };
  }

  // Normalise: ensure all cells are strings (sheet_to_json with raw:false should
  // already do this, but guard against edge cases with numeric/boolean cells).
  const normalizedMatrix: string[][] = matrix.map(row =>
    Array.isArray(row)
      ? row.map(cell => (cell == null ? '' : String(cell)))
      : []
  );

  // Skip completely empty trailing rows that SheetJS sometimes appends.
  while (normalizedMatrix.length > 0) {
    const last = normalizedMatrix[normalizedMatrix.length - 1];
    if (last.every(c => c === '')) {
      normalizedMatrix.pop();
    } else {
      break;
    }
  }

  if (normalizedMatrix.length === 0) {
    return {
      rows: [],
      issues: [...allIssues, {
        row: -1,
        what: 'no-data',
        why: `Sheet '${firstSheetName}' in '${fileName}' contains no non-empty rows.`,
        action: 'no-data',
      }],
      meta: {
        format,
        headerRow: -1,
        totalRows: 0,
        decodedRows: 0,
        sheet: firstSheetName,
        otherSheets: otherSheets.length > 0 ? otherSheets : undefined,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Run header detection + row keying (same path as CSV)
  // ---------------------------------------------------------------------------
  const headerResult = detectHeader(normalizedMatrix);
  allIssues.push(...headerResult.issues);

  const keyResult = keyRows(normalizedMatrix, headerResult);
  allIssues.push(...keyResult.issues);

  const totalRows = headerResult.headerRow >= 0
    ? Math.max(0, normalizedMatrix.length - headerResult.headerRow - 1)
    : normalizedMatrix.length;

  const meta: DecodeMeta = {
    format,
    headerRow: headerResult.headerRow,
    totalRows,
    decodedRows: keyResult.rows.length,
    sheet: firstSheetName,
    otherSheets: otherSheets.length > 0 ? otherSheets : undefined,
  };

  return {
    rows: keyResult.rows,
    issues: sortIssues(allIssues),
    meta,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyMeta(format: 'xlsx' | 'xls'): DecodeMeta {
  return { format, headerRow: -1, totalRows: 0, decodedRows: 0 };
}

function sortIssues(issues: DecodeIssue[]): DecodeIssue[] {
  return [...issues].sort((a, b) => {
    if (a.row === b.row) return 0;
    if (a.row === -1) return -1;
    if (b.row === -1) return 1;
    return a.row - b.row;
  });
}
