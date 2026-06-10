# Ingest Fixtures

Synthetic test fixtures for `decode()` and the ingest pipeline. No real bank data; all amounts and names are fabricated.

## CSV Fixtures (Task 4)

| Fixture | Encoding | Delimiter | Preamble rows | Messiness / key traits |
|---|---|---|---|---|
| `mono-like-utf8.csv` | UTF-8 | `,` | 0 | Quoted headers; LATIN `i` in "Дата **i** час операції" (real mono quirk); `—` empty cells; commission + cashback columns; one `" - "` placeholder row that must be skipped |
| `privat-like-cp1251.csv` | windows-1251 | `;` | 8 | **Generated** by `generate.mjs`; binary cp1251 encoding (no Node encoder — uses an explicit uk→cp1251 byte map in the script); comma decimal separators; quote-in-field with `""` escape; trailing «Разом» summary row |
| `tabs-ragged.csv` | UTF-8 | `\t` | 0 | Tab delimiter; one short row (padded) + one long row (extra positional key); bare-quote in unquoted field |
| `dual-currency.csv` | UTF-8 | `,` | 0 | Cells like `12.50 USD (461.00 UAH)` — raw dual-currency value must be preserved exactly; `—` empties |
| `utf8-bom.csv` | UTF-8 + BOM | `,` | 0 | EF BB BF prefix; BOM stripped transparently; `meta.bom === true` |
| `empty.csv` | UTF-8 | `,` | 0 | Header row only, zero data rows; `meta.decodedRows === 0` |

## Spreadsheet Fixtures (Task 5 — not yet committed)

| Fixture | Format | Messiness / key traits |
|---|---|---|
| `bank-like.xlsx` | XLSX | Task 5 — 3 preamble rows incl. merged-cell title, styled header, 10 fake rows, summary row |
| `legacy.xls` | XLS (BIFF) | Task 5 — Ukrainian strings; exercises BIFF path; `meta.format === 'xls'` |
| `multi-sheet.xlsx` | XLSX | Task 5 — data on sheet 1, junk «Інфо» sheet 2; `meta.otherSheets === ['Інфо']` |

## Generation

```
# From packages/engine/src/internal/ingest/:
node fixtures/generate.mjs
```

`generate.mjs` is deterministic and idempotent. It writes only `privat-like-cp1251.csv`.
Re-running it produces byte-for-byte identical output.

## Security note

No real personal or financial data. All names (`ТЕСТ ТЕСТОВИЧ`, `TEST COFFEE 1`, etc.) and amounts are fabricated. The scripts never connect to the network.
