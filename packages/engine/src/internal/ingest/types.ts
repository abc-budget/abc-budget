export interface DecodeInput { bytes: ArrayBuffer; fileName: string }
export type DecodeAction =
  | 'skipped-row' | 'kept-raw' | 'padded-row' | 'truncated-row'
  | 'recovered-quote' | 'renamed-column' | 'file-unreadable' | 'no-data';
export interface DecodeIssue {
  row: number;            // 0-based row in the SOURCE file; -1 = file-level
  column?: string | number;
  what: string;           // ЩО happened (short, key-like English; UI localizes at 2.8)
  why: string;            // ЧОМУ — human reason with specifics
  raw?: string;           // the offending raw value, truncated to 200 chars
  action: DecodeAction;   // ДІЯ taken
}
export interface DecodeMeta {
  format: 'csv' | 'xlsx' | 'xls';
  encoding?: 'utf-8' | 'windows-1251';
  bom?: boolean;
  delimiter?: ',' | ';' | '\t';
  headerRow: number;      // 0-based source row; -1 if none found
  sheet?: string;
  otherSheets?: string[];
  totalRows: number;      // physical rows seen (excl. header) in source
  decodedRows: number;    // rows emitted
}
export interface DecodeResult {
  rows: Record<string, unknown>[];
  issues: DecodeIssue[];
  meta: DecodeMeta;
}
