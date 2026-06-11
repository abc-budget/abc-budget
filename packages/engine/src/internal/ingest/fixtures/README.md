# Ingest Fixtures

Synthetic test fixtures for `decode()` and the ingest pipeline.
No real bank data — all amounts, names, and account numbers are fabricated.

## Fixture matrix

### CSV fixtures (Task 4)

| Fixture | Encoding | Delimiter | Preamble rows | Messiness / key traits |
|---|---|---|---|---|
| `mono-like-utf8.csv` | UTF-8 | `,` | 0 | Quoted headers; LATIN `i` in "Дата **i** час операції" (real Mono quirk); `—` empty cells; commission + cashback columns; one `" - "` placeholder row that must be skipped |
| `privat-like-cp1251.csv` | windows-1251 | `;` | 8 | **Generated** by `generate.mjs`; binary cp1251 encoding (no Node encoder — uses an explicit uk→cp1251 byte map in the script); comma decimal separators; quote-in-field with `""` escape; trailing «Разом» summary row |
| `tabs-ragged.csv` | UTF-8 | `\t` | 0 | Tab delimiter; one short row (padded) + one long row (extra positional key); bare-quote in unquoted field |
| `dual-currency.csv` | UTF-8 | `,` | 0 | Cells like `12.50 USD (461.00 UAH)` — raw dual-currency value must be preserved exactly; `—` empties |
| `utf8-bom.csv` | UTF-8 + BOM | `,` | 0 | EF BB BF prefix; BOM stripped transparently; `meta.bom === true` |
| `empty.csv` | UTF-8 | `,` | 0 | Header row only, zero data rows; `meta.decodedRows === 0` |
| `empty-header-cells.csv` | UTF-8 | `,` | 0 | Messiness ⑦ — header row has one empty cell (column 2); exercises the empty-header-cell placeholder policy (`col_2`); data rows contain date-shaped values that the scoring penalty must discount so the header row wins over data rows |

Messiness items exercised across CSV fixtures: ① encoding (cp1251 + BOM) ② delimiter sniffing ③ preamble rows ④ summary rows ⑤ placeholder rows ⑥ ragged rows (short + long) ⑦ merged/empty columns at the HEADER level (empty-header-cells.csv).

### Threshold fixture (Story 2.4)

| Fixture | Encoding | Delimiter | Preamble rows | Messiness / key traits |
|---|---|---|---|---|
| `bad-dates.csv` | UTF-8 | `,` | 0 | 12 data rows, 3 columns. `Date`: 7 valid ISO dates + 5 garbage strings (rows 2,4,6,8,10) → 41.7 % errors, trips the default 0.3 gate (`ColumnTransformRejection`). `Amount`: 11 valid negatives + 1 garbage at row 10 → 8.3 % errors — passes the default gate, REJECTED under a 0.05 store override (store-backing/E2E triple-pin fixture). `Description`: clean |

### Spreadsheet fixtures (Task 5)

| Fixture | Format | Messiness / key traits |
|---|---|---|
| `bank-like.xlsx` | XLSX | 3 preamble rows incl. merged-cell title row; styled header at row 3; 10 fake data rows; trailing «Разом» summary row; `meta.headerRow === 3` |
| `legacy.xls` | XLS (BIFF8) | Ukrainian strings; exercises the `D0 CF` BIFF magic-byte path; `meta.format === 'xls'` |
| `multi-sheet.xlsx` | XLSX | Data on sheet «Виписка» (first); junk «Інфо» sheet (second); `meta.otherSheets === ['Інфо']` |

### Corrupted / fuzz fixture (Task 6)

| Fixture | Format | Messiness / key traits |
|---|---|---|
| `corrupted.bin` | N/A (noise) | 4 096 bytes of mulberry32 PRNG output (seed `0xDEADBEEF`); bytes 0–3 overwritten with `50 4B 03 04` (XLSX/PK magic) so `decode()` routes to the sheet path; SheetJS fails to parse the corrupt ZIP → `rows: []`, `file-unreadable` issue; `decode()` must never throw |

## How to regenerate

```sh
# From packages/engine/src/internal/ingest/ (or any directory — paths are absolute):
node fixtures/generate.mjs
```

`generate.mjs` is **deterministic and idempotent**:
- `privat-like-cp1251.csv` — bytes produced by an explicit Unicode→cp1251 map (no `npm` dep needed; reviewable inline).
- `bank-like.xlsx`, `legacy.xls`, `multi-sheet.xlsx` — produced by SheetJS CE 0.20.3; ZIP timestamps vary but `DecodeResult` snapshots are stable (we snapshot the decoded output, not raw bytes).
- `corrupted.bin` — mulberry32 PRNG, fixed seed `0xDEADBEEF`; byte-for-byte reproducible.

Running generate multiple times always produces **functionally identical** fixtures.
The `privat-like-cp1251.csv` and `corrupted.bin` outputs are byte-for-byte identical on every run.

## Snapshots

Decoded `DecodeResult` snapshots live in `../__snapshots__/decode.spec.ts.snap` and are committed.
If you regenerate fixtures and a snapshot changes, update it with:

```sh
pnpm --filter @abc-budget/engine test -- --update-snapshots
```

Then review the diff carefully before committing.

## Security note

No real personal or financial data. All names (`ТЕСТ ТЕСТОВИЧ`, `TEST COFFEE 1`, etc.)
and amounts are fabricated. The scripts never connect to the network.
Real statement files (`mono_*.csv`, `ukrsib.xlsx`) are **never** committed to this repo
and are guarded by `real-statements.local.spec.ts`.
