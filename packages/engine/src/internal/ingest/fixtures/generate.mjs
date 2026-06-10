/**
 * generate.mjs — generate deterministic binary fixture files.
 *
 * Usage:  node fixtures/generate.mjs
 *         (run from packages/engine/src/internal/ingest/ or anywhere — __dirname resolved)
 *
 * Outputs:
 *   privat-like-cp1251.csv  — windows-1251 encoded CSV with PrivatBank-style
 *                             8 preamble rows, `;` delimiter, comma-decimal amounts,
 *                             a quote-in-field row, and a trailing «Разом» row.
 *   bank-like.xlsx          — XLSX with 3 preamble rows (merged-cell title), styled
 *                             header, 10 fake data rows, «Разом» summary row.
 *   legacy.xls              — XLS (BIFF8 via bookType:'xls'), Ukrainian strings —
 *                             exercises the D0CF BIFF magic-byte path.
 *   multi-sheet.xlsx        — 2-sheet XLSX: «Виписка» (data) + «Інфо» (junk).
 *
 * Why an explicit byte map?
 *   Node.js has no cp1251 *encoder* (only a decoder via TextDecoder('windows-1251')).
 *   Rather than pulling a dep, we embed an explicit uk->cp1251 byte map covering the
 *   ~70 characters needed by the fixture.  The map is reviewable + deterministic.
 *   Byte values verified against TextDecoder('windows-1251') round-trip on Node 18+.
 *
 * Determinism notes for spreadsheet fixtures:
 *   SheetJS writes XLSX zip archives with ZIP local file header "last modified"
 *   timestamps. To ensure snapshot-safe determinism we snapshot DecodeResult
 *   (rows/issues/meta), NOT the raw bytes.  Content is fully deterministic
 *   (no Date.now(); all strings are literals).
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// why: npm 'xlsx' is stale w/ CVEs; cdn.sheetjs.com is the official dist (pinned)
import XLSX from 'xlsx';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = __dirname;

// ---------------------------------------------------------------------------
// Explicit Unicode -> cp1251 byte map
// (cp1251 = Windows-1251 = MS Cyrillic; every entry verified by round-trip)
// ---------------------------------------------------------------------------
// Verification method: for each char, TextDecoder('windows-1251').decode(Uint8Array([byte]))
// Sources: https://en.wikipedia.org/wiki/Windows-1251
//          https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WindowsBestFit/bestfit1251.txt

/** Map from Unicode char -> cp1251 byte value. */
const CP1251 = new Map([
  // ---- ASCII passthrough: 0x00-0x7F are identity; handled in encode() --------

  // ---- Uppercase A-Ya (U+0410-U+042F) -> 0xC0-0xDF ---------------------------
  ['А', 0xC0], ['Б', 0xC1], ['В', 0xC2], ['Г', 0xC3], ['Д', 0xC4],
  ['Е', 0xC5], ['Ж', 0xC6], ['З', 0xC7], ['И', 0xC8], ['Й', 0xC9],
  ['К', 0xCA], ['Л', 0xCB], ['М', 0xCC], ['Н', 0xCD], ['О', 0xCE],
  ['П', 0xCF], ['Р', 0xD0], ['С', 0xD1], ['Т', 0xD2], ['У', 0xD3],
  ['Ф', 0xD4], ['Х', 0xD5], ['Ц', 0xD6], ['Ч', 0xD7], ['Ш', 0xD8],
  ['Щ', 0xD9], ['Ъ', 0xDA], ['Ы', 0xDB], ['Ь', 0xDC], ['Э', 0xDD],
  ['Ю', 0xDE], ['Я', 0xDF],
  // ---- Lowercase a-ya (U+0430-U+044F) -> 0xE0-0xFF ---------------------------
  ['а', 0xE0], ['б', 0xE1], ['в', 0xE2], ['г', 0xE3], ['д', 0xE4],
  ['е', 0xE5], ['ж', 0xE6], ['з', 0xE7], ['и', 0xE8], ['й', 0xE9],
  ['к', 0xEA], ['л', 0xEB], ['м', 0xEC], ['н', 0xED], ['о', 0xEE],
  ['п', 0xEF], ['р', 0xF0], ['с', 0xF1], ['т', 0xF2], ['у', 0xF3],
  ['ф', 0xF4], ['х', 0xF5], ['ц', 0xF6], ['ч', 0xF7], ['ш', 0xF8],
  ['щ', 0xF9], ['ъ', 0xFA], ['ы', 0xFB], ['ь', 0xFC], ['э', 0xFD],
  ['ю', 0xFE], ['я', 0xFF],
  // ---- Ukrainian-specific letters (verified via TextDecoder round-trip) --------
  ['Ї', 0xAF], // Uppercase I with umlaut (U+0407) -> 0xAF
  ['ї', 0xBF], // Lowercase i with umlaut (U+0457) -> 0xBF
  ['І', 0xB2], // Uppercase dotless I (U+0406) -> 0xB2
  ['і', 0xB3], // Lowercase dotless i (U+0456) -> 0xB3
  ['Є', 0xAA], // Uppercase Ye (U+0404) -> 0xAA
  ['є', 0xBA], // Lowercase ye (U+0454) -> 0xBA
  ['Ґ', 0xA5], // Uppercase G with upturn (U+0490) -> 0xA5
  ['ґ', 0xB4], // Lowercase g with upturn (U+0491) -> 0xB4
  // ---- Russian-specific -------------------------------------------------------
  ['Ё', 0xA8], // Uppercase Yo (U+0401) -> 0xA8
  ['ё', 0xB8], // Lowercase yo (U+0451) -> 0xB8
  // ---- Punctuation & symbols used in the fixture ------------------------------
  ['—', 0x97], // Em dash (U+2014) -> 0x97 in cp1251
  ['«', 0xAB], // Left-pointing double angle quotation mark
  ['»', 0xBB], // Right-pointing double angle quotation mark
  [' ', 0xA0], // Non-breaking space
]);

/**
 * Encode a UTF-8 JavaScript string to a cp1251 byte Buffer.
 * ASCII code-points (0x00-0x7F) are identity; everything else uses CP1251 map.
 * Unknown characters -> 0x3F ('?') with a warning.
 */
function encodeCP1251(str) {
  const bytes = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) {
      bytes.push(cp); // ASCII passthrough
    } else {
      const byte = CP1251.get(ch);
      if (byte === undefined) {
        process.stderr.write(`WARN: no cp1251 mapping for U+${cp.toString(16).toUpperCase()} ('${ch}') -- using 0x3F\n`);
        bytes.push(0x3F);
      } else {
        bytes.push(byte);
      }
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Fixture: privat-like-cp1251.csv
// ---------------------------------------------------------------------------
// Simulates a PrivatBank statement export:
//   - 8 preamble rows (rows 0-7): bank name, client, account, period, currency, empties
//   - Header row at index 8: 6 columns, semicolon delimiter
//   - 7 data rows (rows 9-15): various operations including comma-decimal amounts
//   - 1 row with a quoted field containing a double-quote inside ("" escape)
//   - Trailing "Razom" (Razom) summary row (row 16)
// ---------------------------------------------------------------------------

const LINES = [
  // preamble rows 0-7
  'Виписка з рахунку',
  'АТ КБ "ПРИВАТБАНК"',
  '',
  'Клієнт: ТЕСТОВИЙ ТЕСТ ТЕСТОВИЧ',
  'Рахунок: UA12 3456 7890 0000 0001 2345 6789',
  'Період: 01.01.2024 — 31.01.2024',
  'Валюта: UAH',
  '',
  // header row 8
  'Дата;Опис операції;МФО;Сума;Валюта;Залишок',
  // data rows 9-15
  '15.01.2024;Оплата в TEST КАФЕ 1;5812;-85,00;UAH;10000,00',
  '15.01.2024;Переказ від ТЕСТ ІВАНОВ І.І.;0;+500,00;UAH;10500,00',
  '16.01.2024;Оплата в TEST СУПЕРМАРКЕТ 1;5411;-320,50;UAH;10179,50',
  // row with quoted field containing double-quote escape (row 12)
  '16.01.2024;"Оплата ""TEST SPECIAL"" операція";7372;-199,00;UAH;9980,50',
  '17.01.2024;Зняття в TEST БАНКОМАТ 1;6011;-1000,00;UAH;8980,50',
  '18.01.2024;Оплата в TEST АПТЕКА 1;5912;-156,00;UAH;8824,50',
  '19.01.2024;Поповнення рахунку ТЕСТ;0;+2000,00;UAH;10824,50',
  // summary row 16
  'Разом;;;-261,50;;',
];

const csvText = LINES.join('\n') + '\n';
const csvBytes = encodeCP1251(csvText);

writeFileSync(join(OUT_DIR, 'privat-like-cp1251.csv'), csvBytes);
console.log('privat-like-cp1251.csv (' + csvBytes.length + ' bytes, cp1251)');

// Verify round-trip: decode with TextDecoder('windows-1251') and spot-check
const decoded = new TextDecoder('windows-1251').decode(csvBytes);
const lines = decoded.split('\n');

// row 8 should be the header
const headerRow = lines[8];
if (!headerRow.startsWith('Дата;')) {
  throw new Error('Round-trip check FAILED -- header row: ' + JSON.stringify(headerRow));
}
// row 9 should contain TEST KAFE
if (!lines[9].includes('TEST')) {
  throw new Error('Round-trip check FAILED -- data row: ' + JSON.stringify(lines[9]));
}
// row 3 should contain the client name with correct Ukrainian i
if (!lines[3].includes('Клієнт')) {
  throw new Error('Round-trip check FAILED -- client row: ' + JSON.stringify(lines[3]));
}
console.log('Round-trip decode verified (header at row 8, client name correct)');

// ---------------------------------------------------------------------------
// Fixture: bank-like.xlsx
// ---------------------------------------------------------------------------
// 3 preamble rows (row 0 has a merged-cell title),
// header row at index 3, 10 data rows, trailing «Разом» summary row.
// ---------------------------------------------------------------------------

(function generateBankLikeXlsx() {
  const wb = XLSX.utils.book_new();

  // Build the data array (row-major, all strings for determinism)
  const rows = [
    // row 0: merged title
    ['Виписка за рахунком UA21 3006 4900 0026 0071 3578 4', '', '', '', '', ''],
    // row 1: period info
    ['Період: 01.01.2024 – 31.01.2024', '', '', '', '', ''],
    // row 2: empty preamble
    ['', '', '', '', '', ''],
    // row 3: header
    ['Дата', 'Опис', 'Сума', 'Валюта', 'Залишок', 'Комісія'],
    // rows 4-13: 10 data rows (deterministic, no runtime dates)
    ['01.01.2024', 'Покупка в METRO 1', '-1500,00', 'UAH', '98500,00', '0,00'],
    ['02.01.2024', 'Переказ від ІВАНЕНКО', '+5000,00', 'UAH', '103500,00', '0,00'],
    ['03.01.2024', 'Комунальні послуги', '-450,00', 'UAH', '103050,00', '0,00'],
    ['04.01.2024', 'Зняття в банкоматі', '-2000,00', 'UAH', '101050,00', '5,00'],
    ['05.01.2024', 'Оплата за інтернет', '-150,00', 'UAH', '100900,00', '0,00'],
    ['06.01.2024', 'Покупка в АТБ', '-320,00', 'UAH', '100580,00', '0,00'],
    ['07.01.2024', 'Поповнення від клієнта', '+10000,00', 'UAH', '110580,00', '0,00'],
    ['08.01.2024', 'Оплата за газ', '-800,00', 'UAH', '109780,00', '0,00'],
    ['09.01.2024', 'Покупка в Сільпо', '-560,00', 'UAH', '109220,00', '0,00'],
    ['10.01.2024', 'Переказ Monobank', '-3000,00', 'UAH', '106220,00', '0,00'],
    // row 14: summary
    ['Разом', '', '+7220,00', '', '', '5,00'],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Add merged cell for the title row (A1:F1 → row 0, cols 0-5)
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];

  XLSX.utils.book_append_sheet(wb, ws, 'Виписка');
  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(join(OUT_DIR, 'bank-like.xlsx'), xlsxBuf);
  console.log('bank-like.xlsx (' + xlsxBuf.length + ' bytes, XLSX, merged title, 10 rows + summary)');
})();

// ---------------------------------------------------------------------------
// Fixture: legacy.xls
// ---------------------------------------------------------------------------
// BIFF8 (bookType:'xls') with Ukrainian strings — exercises D0CF magic path.
// ---------------------------------------------------------------------------

(function generateLegacyXls() {
  const wb = XLSX.utils.book_new();

  const rows = [
    // preamble
    ['Виписка з рахунку (старий формат)'],
    ['Клієнт: ТЕСТ ТЕСТОВИЧ'],
    [''],
    // header
    ['Дата', 'Призначення', 'Сума', 'МФО', 'Банк'],
    // data rows
    ['15.03.2023', 'Оплата послуг ЖКГ', '-850,00', '322001', 'ПАТ Ощадбанк'],
    ['16.03.2023', 'Переказ фізособі', '-1200,00', '305299', 'АТ Приватбанк'],
    ['17.03.2023', 'Поповнення депозиту', '-5000,00', '322001', 'ПАТ Ощадбанк'],
    ['18.03.2023', 'Зарахування зарплати', '+15000,00', '322001', 'ПАТ Ощадбанк'],
    ['19.03.2023', 'Оплата в Fozzy', '-230,00', '305299', 'АТ Приватбанк'],
    // summary
    ['Разом', '', '+7720,00', '', ''],
  ];

  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const xlsBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xls' });
  writeFileSync(join(OUT_DIR, 'legacy.xls'), xlsBuf);
  console.log('legacy.xls (' + xlsBuf.length + ' bytes, BIFF8/XLS, Ukrainian strings)');
})();

// ---------------------------------------------------------------------------
// Fixture: multi-sheet.xlsx
// ---------------------------------------------------------------------------
// Sheet «Виписка» (data) + sheet «Інфо» (junk metadata).
// Tests that otherSheets is populated correctly.
// ---------------------------------------------------------------------------

(function generateMultiSheetXlsx() {
  const wb = XLSX.utils.book_new();

  // Sheet 1: data (Виписка)
  const dataRows = [
    ['Дата', 'Деталі', 'Сума'],
    ['01.06.2024', 'Оплата за товар', '-1000,00'],
    ['02.06.2024', 'Надходження', '+5000,00'],
    ['03.06.2024', 'Комісія банку', '-25,00'],
  ];
  const ws1 = XLSX.utils.aoa_to_sheet(dataRows);
  XLSX.utils.book_append_sheet(wb, ws1, 'Виписка');

  // Sheet 2: info junk (Інфо)
  const infoRows = [
    ['Назва банку', 'ТЕСТ БАНК'],
    ['Валюта', 'UAH'],
    ['Тип рахунку', 'Поточний'],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(infoRows);
  XLSX.utils.book_append_sheet(wb, ws2, 'Інфо');

  const xlsxBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  writeFileSync(join(OUT_DIR, 'multi-sheet.xlsx'), xlsxBuf);
  console.log('multi-sheet.xlsx (' + xlsxBuf.length + ' bytes, 2 sheets: Виписка + Інфо)');
})();

// ---------------------------------------------------------------------------
// Fixture: corrupted.bin
// ---------------------------------------------------------------------------
// 4 096 bytes of pseudo-random data generated by a mulberry32 PRNG seeded
// with a fixed constant.  bytes 0–3 are overwritten with the XLSX PK magic
// (50 4B 03 04) so decode() routes the file to the sheet path; SheetJS then
// fails to parse the corrupt ZIP archive and emits a file-unreadable issue.
// decode() must NEVER throw for this input.
//
// Mulberry32 — a fast, high-quality 32-bit PRNG (public domain):
//   https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
// Seed: 0xDEADBEEF (fixed — ensures byte-for-byte reproducibility)
// ---------------------------------------------------------------------------

(function generateCorruptedBin() {
  const SEED = 0xDEADBEEF;
  const SIZE = 4096; // 4 KB

  /** mulberry32 — returns next uint32 and advances state */
  function mulberry32(state) {
    state = (state + 0x6D2B79F5) >>> 0;
    let z = state;
    z = Math.imul(z ^ (z >>> 15), z | 1) >>> 0;
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61) >>> 0;
    return [(z ^ (z >>> 14)) >>> 0, state];
  }

  const buf = Buffer.alloc(SIZE);
  let state = SEED;
  for (let i = 0; i < SIZE; i += 4) {
    let rand;
    [rand, state] = mulberry32(state);
    buf.writeUInt32LE(rand, i);
  }

  // Force the XLSX PK magic at bytes 0-3 so the file routes to the sheet path.
  // The rest of the buffer is random noise — SheetJS will fail to parse the
  // (invalid) ZIP archive and emit a file-unreadable issue.
  // Using PK magic (not D0CF) because SheetJS is more reliably strict about ZIP.
  buf[0] = 0x50; // P
  buf[1] = 0x4B; // K
  buf[2] = 0x03;
  buf[3] = 0x04;

  writeFileSync(join(OUT_DIR, 'corrupted.bin'), buf);
  console.log('corrupted.bin (' + buf.length + ' bytes, mulberry32 PRNG seed=0xDEADBEEF, PK magic header + random noise)');
})();
