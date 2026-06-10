# ingest — file → rows decoder

Internal module that turns raw bank-statement bytes into a structured
`DecodeResult` (rows + issues + meta). Never throws; every error becomes a
`DecodeIssue` with coordinates, a WHY, and an action taken.

## Pipeline overview

```
bytes + fileName
  │
  ├─ CSV / TXT  ──▶  encoding.ts  ──▶  csv-parser.ts  ──▶┐
  │                                                        ├──▶  header-detect.ts  ──▶  DecodeResult
  └─ XLS / XLSX  ──▶  sheet-decoder.ts (lazy SheetJS)  ──▶┘
```

Both paths converge on `detectHeader` + `keyRows` so preamble/summary/
placeholder handling is shared.

## Modules

| File | Role |
|---|---|
| `types.ts` | Shared contracts: `DecodeInput`, `DecodeResult`, `DecodeIssue`, `DecodeMeta` |
| `encoding.ts` | BOM detection; UTF-8 strict parse; cp1251 fallback |
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
  import exists anywhere. This keeps xlsx out of the boot chunk.
- **Type resolution.** SheetJS CE 0.20.3 ships its own `types/index.d.ts`
  so no `@types/xlsx` is needed.
- **Upgrade path.** To upgrade: change the tarball URL + run `pnpm install`;
  the lockfile integrity hash updates automatically. Pin the new hash in review.

## Fixtures

See `fixtures/README.md` for the fixture matrix. Snapshots live in
`__snapshots__/decode.spec.ts.snap` — committed, deterministic.

## QA subpath

`@abc-budget/engine/qa` (UNSTABLE) re-exports `decode` + types for the
offline QA harness at `apps/web/qa-harness.html`. Sunsets at Story 2.6.
