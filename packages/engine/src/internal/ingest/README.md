# ingest — file → rows decoder

Internal module that turns raw bank-statement bytes into a structured
`DecodeResult` (rows + issues + meta). **Never throws** — every error becomes a
`DecodeIssue` with coordinates, a WHY, and an action taken.

## Decoder contract

```ts
decode(input: { bytes: ArrayBuffer; fileName: string }): Promise<DecodeResult>
```

Always resolves. Never rejects. Returns:

```ts
{
  rows:   Record<string, unknown>[];  // keyed data rows (header removed)
  issues: DecodeIssue[];              // sorted: file-level (row:-1) first, then asc by row
  meta:   DecodeMeta;                 // always fully populated
}
```

### Issue model — ЩО / ЧОМУ / ДІЯ

Every `DecodeIssue` carries three mandatory fields that answer three questions:

| Field | Question | Example |
|---|---|---|
| `what` | **ЩО** happened? | `'placeholder-row'`, `'ambiguous-encoding'` |
| `why` | **ЧОМУ** — human reason with specifics | `"Row 3 contains only placeholder values…"` |
| `action` | **ДІЯ** taken | `'skipped-row'`, `'file-unreadable'`, `'no-data'` |

Plus optional `row`, `column`, `raw` coordinates for precise UI targeting.

Full `DecodeAction` union: `'skipped-row' | 'kept-raw' | 'padded-row' | 'truncated-row' | 'recovered-quote' | 'renamed-column' | 'file-unreadable' | 'no-data'`.

## Pipeline overview

```
bytes + fileName
  │
  ├─ CSV / TXT  ──▶  encoding.ts  ──▶  csv-parser.ts  ──▶┐
  │                                                        ├──▶  header-detect.ts  ──▶  DecodeResult
  └─ XLS / XLSX  ──▶  sheet-decoder.ts (lazy SheetJS)  ──▶┘
```

Both paths converge on `detectHeader` + `keyRows` so preamble / summary /
placeholder handling is shared and tested once.

Content-routing order (magic bytes take priority over extension):
1. `PK\x03\x04` signature → XLSX path.
2. `D0 CF 11 E0` signature → XLS/BIFF path.
3. `.xlsx` / `.xls` extension (no signature match) → sheet path.
4. Everything else (`.csv`, `.txt`, unknown, corrupt) → CSV path.

A `.csv`-named file whose bytes carry a `PK` signature is routed to the sheet
path and flagged with an `extension-mismatch` issue.

## Modules

| File | Role |
|---|---|
| `types.ts` | Shared contracts: `DecodeInput`, `DecodeResult`, `DecodeIssue`, `DecodeMeta` |
| `encoding.ts` | BOM detection; UTF-8 strict parse; cp1251 fallback; `ambiguous` heuristic |
| `csv-parser.ts` | Single-pass CSV state machine; delimiter sniffing; quote recovery |
| `header-detect.ts` | Preamble skip; header scoring; key dedup; summary/placeholder row skip |
| `sheet-decoder.ts` | Lazy SheetJS import; BIFF + ZIP signature detection; first-sheet extraction |
| `decode.ts` | Top-level router; assembles `DecodeResult`; sorts issues |

## SheetJS — WHY this dep, WHY this pin

> **npm `xlsx` is years-stale and carries known CVEs.**
> The official SheetJS distribution is published at **cdn.sheetjs.com**, not
> the npm registry. The package pinned here is the exact CDN tarball with a
> lockfile integrity hash — this is the supply-chain pin.

Dependency entry in `packages/engine/package.json`:
```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

- **Lazy import only.** `sheet-decoder.ts` is the *only* file that touches
  `xlsx`, via `const XLSX = await import('xlsx')`. No static `from 'xlsx'`
  import exists anywhere. This keeps xlsx out of the boot chunk and is
  enforced by a test in `decode.spec.ts`.
- **Type resolution.** SheetJS CE 0.20.3 ships its own `types/index.d.ts`
  so no `@types/xlsx` is needed.
- **Upgrade path.** Change the tarball URL + run `pnpm install`; review the
  lockfile integrity hash change. Pin the new hash in the PR description.

## Empty/duplicate header names — why stable placeholders

When a header cell is empty or whitespace-only, `header-detect.ts` assigns it a
deterministic, stable placeholder name: `col_{index+1}` (1-based). For example,
column index 1 (the second column) becomes `col_2`. A `renamed-column` issue with
`what: 'empty-header-cell'` is emitted for each such column.

**Why stable placeholder names instead of silent empty-string keys?**

The 2.3 recall pool keys on `columnName`. An empty-string key (`''`) would:
- Break recall lookup — every empty-header column maps to the same empty key.
- Produce collisions across files that each have different unnamed columns.
- Make it impossible to reference a specific unnamed column in recall rules.

Using `col_N` (positional, 1-based) gives each unnamed column a unique, human-readable
identity that survives the recall pool's key-based lookup. If a literal `col_N`
already exists in the same header, the standard `_2`, `_3`, … dedup suffix applies.

**Policy also resolves the deferred 1.6 whitespace-column policy:** whitespace-only
header cells (e.g. `"   "`) are treated identically to empty cells — trimmed to `''`,
then assigned a `col_N` placeholder.

## Fixtures

See `fixtures/README.md` for the full fixture → messiness table (CSV, spreadsheet,
and corrupted/fuzz entries) and regeneration instructions.

Snapshots live in `__snapshots__/decode.spec.ts.snap` — committed, deterministic.

## Local real-statement spec (`real-statements.local.spec.ts`)

### What it asserts

Hard-baked constants observed from three real bank-statement files on the
developer machine. For each file:

- **Exact decoded row count** (`meta.decodedRows`) — regression-fails if the
  pipeline silently drops or duplicates rows.
- **Exact total rows** (`meta.totalRows`) — detects header-detection drift.
- **Full meta facts** — `format`, `encoding`, `delimiter`, `headerRow`, `sheet`.
- **Exact ordered header key list** — adding/removing/renaming a column fails.
- **2–3 spot cell values** (amounts, date of first row, one merchant prefix)
  that are individually verifiable from the original file.
- **Security assertion**: `git ls-files` must not contain the real file names —
  enforces that the actual statements are never accidentally committed.

### How to run locally

```sh
# Full suite (includes this spec when files are present):
pnpm --filter @abc-budget/engine test

# Targeted run:
pnpm --filter @abc-budget/engine test src/internal/ingest/real-statements.local.spec.ts
```

### Why it auto-skips in CI

The guard `describe.skipIf(!existsSync('D:/abc-budget/mono_07-10-23_14-34-50.csv'))`
makes the entire suite disappear if the anchor file is absent. CI never has
the real files, so the suite always skips there — no special env vars or
`--skip` flags are needed.

When the spec runs locally it prints a compact QA summary line per file to
stdout (rows/meta/issue count) for the QA protocol log.

### Files required

```
D:/abc-budget/mono_07-10-23_14-34-50.csv   (Monobank UA, Ukrainian headers)
D:/abc-budget/mono_en_21-11-23_10-34-42.csv (Monobank EN, English headers)
D:/abc-budget/ukrsib.xlsx                  (UkrSibbank, XLSX)
```

These files are **never** committed to the repo. The spec asserts this
programmatically via `git ls-files`.

## QA subpath

`@abc-budget/engine/qa` (UNSTABLE) re-exports `decode` + types for the
offline QA harness at `apps/web/qa-harness.html`. Sunsets at Story 2.6 when
the real EngineClient grows a `decode()` method over the worker transport.
