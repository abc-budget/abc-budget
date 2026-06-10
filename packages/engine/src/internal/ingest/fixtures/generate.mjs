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
 *
 * Why an explicit byte map?
 *   Node.js has no cp1251 *encoder* (only a decoder via TextDecoder('windows-1251')).
 *   Rather than pulling a dep, we embed an explicit uk->cp1251 byte map covering the
 *   ~70 characters needed by the fixture.  The map is reviewable + deterministic.
 *   Byte values verified against TextDecoder('windows-1251') round-trip on Node 18+.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
