/**
 * real-statement-flagrate.spec.ts — GATED-SKIP typicality FLAG-RATE measurement on
 * a REAL monobank UA statement (Story 4.8, Task 4, EP-4).
 *
 * THE MEASUREMENT: drive the FULL import pipeline on a real, LOCAL-ONLY monobank
 * export (decode → service.startWith → stage2 column mapping → generateRows → real
 * `ImportStatementStage3Row[]`), then GROUP the rows by MCC. Each MCC group is a
 * natural homogeneous-CATEGORY bucket holding VARIED real merchant descriptions —
 * exactly the #6c scenario on real noisy data: same category, many different
 * merchants. We `rankBucket` each eligible bucket with the MCC field FILTERED
 * (`filteredFields = new Set(['mcc'])`, since the grouping key is constant by
 * construction and carries no signal), and measure the per-bucket FLAG-RATE.
 *
 * WHY: this is the live-data witness that the `T_ABS = 0.6` tuning + the #6c text
 * containment (TEXT_CAP < T_ABS — a rare merchant word alone can NOT cross the
 * tail) hold on REAL noisy bank descriptions. A naive lexical impl would light up
 * every varied-merchant row → ~100% flag-rate. PM Ruling 2: if a CLEAN bucket
 * flags > ~15–20%, that is a re-tune signal. The teeth below assert ≤ 20%.
 *
 * GATED (HC-10 — no silent skip): the statement is real financial data, LOCAL-ONLY,
 * NEVER committed and NEVER copied. CI has no such file. When the local path is
 * absent the suite SKIPS via `describe.skipIf` AND logs a loud SKIPPED line stating
 * why — never a silent green. The spec only READS the path; it writes the contents
 * nowhere.
 *
 * THE FILE + MAPPING: identical to `internal/footprint/real-statement-proof.spec.ts`
 * (same bank, same export). The decode → stage2 → generateRows plumbing and the
 * DYNAMIC substring-based column mapping are mirrored verbatim from that proof —
 * the only divergence is that THIS spec needs no DB / rates / footprints (it reads
 * rows and scores them in-memory), so that harness is trimmed to the row-generation
 * half. READ-ONLY: no DB, no writes, no commits.
 *
 * NOT in the public barrel — internal to the typicality engine.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { firstValueFrom } from 'rxjs';

import { decode } from '../../ingest/decode';
import { ImportStatementServiceImpl } from '../../importStatement/service';
import { ImportStatementColumn } from '../../importStatement/stage2/column';
import { ImportStatementStage2Impl } from '../../importStatement/stage2/implementation';
import { ColumnDefinition } from '../../importStatement/types';
import type {
  AmountColumnParams,
  BankCommissionColumnParams,
  CashbackColumnParams,
  ColumnParams,
  DateColumnParams,
} from '../../importStatement/types';
import type {
  ImportStatementColumnHeaderStage2,
  ImportStatementRowData,
} from '../../importStatement/stage2/types';
import { generateRows } from '../../importStatement/stage3/row-generator';
import type { ColumnInfo } from '../../importStatement/stage3/row-generator';
import type { ImportStatementStage3Row } from '../../importStatement/stage3/types';

import { rankBucket } from './index';
import type { TypicalityReason } from './index';

// ---------------------------------------------------------------------------
// The LOCAL-ONLY real statement. process.env override, else the local default.
// existsSync drives the GATE — present → RUN; absent → loud SKIP (HC-10).
// ---------------------------------------------------------------------------

const REAL_STATEMENT_PATH =
  process.env.ABC_REAL_STATEMENT ?? 'D:\\abc-budget\\mono_07-10-23_14-34-50.csv';
const HAS_FILE = existsSync(REAL_STATEMENT_PATH);

/** Min bucket size to be a measurable homogeneous-category bucket (spec N_MIN). */
const N_MIN = 8;

/**
 * The TARGET bar after the amount-path fix (log-space outliers + the min-spread
 * floor): "narrow ~1000 rows to ~10 worth a glance" — a single-digit OVERALL
 * flag-rate. A clean bucket above this is a re-tune signal.
 */
const FLAG_RATE_CEILING = 0.1;

if (!HAS_FILE) {
  // HC-10 — no silent skip. State that we skipped and exactly why.
  console.info(
    `[real-statement-flagrate] SKIPPED — real monobank statement not found at "${REAL_STATEMENT_PATH}". ` +
      `This measurement is LOCAL-ONLY (real financial data, never committed); CI has no such file. ` +
      `Set ABC_REAL_STATEMENT to a local monobank UA export to run it.`
  );
}

// ---------------------------------------------------------------------------
// Local mapping triple (mirrors real-statement-proof.spec.ts — test plumbing).
// ---------------------------------------------------------------------------

interface ColumnTransformation {
  readonly columnName: string;
  readonly definition: ColumnDefinition;
  readonly params: ColumnParams | null;
}

function toColumnInfo(columns: ImportStatementColumnHeaderStage2[]): ColumnInfo[] {
  return columns.map((col) => ({
    id: col.id,
    definition: col.definition,
    params: col.params,
  }));
}

async function applyMappings(
  stage2: ImportStatementStage2Impl,
  transformations: ColumnTransformation[]
): Promise<void> {
  const cols = await firstValueFrom(stage2.columns);
  for (const t of transformations) {
    const col = cols.find((c) => c.originalName.getText() === t.columnName);
    if (!col || !(col instanceof ImportStatementColumn)) continue;
    switch (t.definition) {
      case ColumnDefinition.DATE:
        await col.parseAsDate((t.params as DateColumnParams) ?? { format: 'auto' });
        break;
      case ColumnDefinition.AMOUNT:
        await col.parseAsAmount(t.params as AmountColumnParams);
        break;
      case ColumnDefinition.DESCRIPTION:
        await col.parseAsDescription();
        break;
      case ColumnDefinition.COUNTERPARTY:
        await col.parseAsCounterparty();
        break;
      case ColumnDefinition.MERCHANT_CATEGORY:
        await col.parseAsMerchant();
        break;
      case ColumnDefinition.BANK_COMMISSION:
        await col.parseAsBankCommission(t.params as BankCommissionColumnParams);
        break;
      case ColumnDefinition.CASHBACK:
        await col.parseAsCashback(t.params as CashbackColumnParams);
        break;
      case ColumnDefinition.IGNORE:
        await col.ignore();
        break;
      default:
        await col.ignore();
    }
  }
}

/**
 * Builds the mapping DYNAMICALLY from the real decoded column names — mirrored
 * verbatim from real-statement-proof.spec.ts. Each header is classified by a
 * stable substring (robust against the `(UAH)` suffix / em-dash drift). Anything
 * not recognized → IGNORE.
 */
function buildMappingForRealColumns(columnNames: string[]): ColumnTransformation[] {
  return columnNames.map((name): ColumnTransformation => {
    const isCardAmount = name.includes('валюті картки');
    const isCommission = name.includes('комісій') || name.includes('Комісія');
    const isCashback = name.includes('кешбеку') || name.includes('Кешбек');

    if (name.includes('Дата')) {
      return { columnName: name, definition: ColumnDefinition.DATE, params: { format: 'auto' } as DateColumnParams };
    }
    if (name.includes('Деталі')) {
      return { columnName: name, definition: ColumnDefinition.DESCRIPTION, params: null };
    }
    if (name === 'MCC') {
      return { columnName: name, definition: ColumnDefinition.MERCHANT_CATEGORY, params: null };
    }
    if (isCardAmount) {
      return {
        columnName: name,
        definition: ColumnDefinition.AMOUNT,
        params: { type: 'outcome', currency: { code: 'UAH' } } as AmountColumnParams,
      };
    }
    if (isCommission) {
      return { columnName: name, definition: ColumnDefinition.BANK_COMMISSION, params: { currency: { code: 'UAH' } } as BankCommissionColumnParams };
    }
    if (isCashback) {
      return { columnName: name, definition: ColumnDefinition.CASHBACK, params: { currency: { code: 'UAH' } } as CashbackColumnParams };
    }
    return { columnName: name, definition: ColumnDefinition.IGNORE, params: null };
  });
}

/**
 * Drives the full import pipeline on the real statement and returns the generated
 * rows. Mirrors the row-generation half of real-statement-proof.spec.ts (no DB /
 * rates / footprints — this measurement is pure in-memory scoring).
 */
async function loadRealRows(): Promise<ImportStatementStage3Row[]> {
  const buf = readFileSync(REAL_STATEMENT_PATH);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const decodeResult = await decode({ bytes, fileName: 'real-statement.csv' });

  const service = new ImportStatementServiceImpl();
  const stage1 = service.startWith(decodeResult.rows);
  const stage2 = (await service.stage2(stage1)) as ImportStatementStage2Impl;

  const colNames = (await firstValueFrom(stage2.columns)).map((c) => c.originalName.getText());
  const mapping = buildMappingForRealColumns(colNames);
  await applyMappings(stage2, mapping);

  const cols = await firstValueFrom(stage2.columns);
  const rowData: ImportStatementRowData[] = await firstValueFrom(stage2.currentData);
  const genResult = await generateRows(rowData, toColumnInfo(cols), 'UAH');
  return genResult.rows;
}

/** One measured bucket's verdict, for the summary table. */
interface BucketMeasurement {
  readonly mcc: string;
  readonly size: number;
  readonly flagged: number;
  readonly flagRate: number;
  readonly topReasons: string[];
}

/** Flatten a flagged op's reasons to short strings for the console table. */
function summarizeReasons(reasons: readonly TypicalityReason[]): string[] {
  return reasons.map((r) => {
    if (r.kind === 'rare-tokens') {
      return `description:rare[${(r.tokens ?? []).join(',')}]`;
    }
    if (r.kind === 'amount-outlier') {
      return `amount:z≈${r.magnitude}`;
    }
    return `${r.field}:minority(${String(r.value)})`;
  });
}

// ---------------------------------------------------------------------------
// THE MEASUREMENT
// ---------------------------------------------------------------------------

describe.skipIf(!HAS_FILE)(
  'REAL monobank statement — per-MCC typicality flag-rate (Task 4)',
  () => {
    it('full pipeline → group by MCC → rankBucket(filter=mcc) → measures flag-rate; #6c text containment holds (0 text-sole flags); reports re-tune signals', async () => {
      // 1. Drive the FULL pipeline → real Stage3 rows (READ-ONLY).
      const rows = await loadRealRows();

      // Sanity: the real export must yield real rows (otherwise the mapping broke
      // and a hollow "0 flagged" would be a meaningless pass).
      expect(rows.length).toBeGreaterThan(0);

      // 2. Group by MCC — skip null-mcc rows. Each MCC group is a homogeneous
      //    CATEGORY bucket with VARIED real merchant descriptions (#6c on real data).
      const byMcc = new Map<string, ImportStatementStage3Row[]>();
      let nullMcc = 0;
      for (const row of rows) {
        if (row.mcc === null) {
          nullMcc += 1;
          continue;
        }
        const key = String(row.mcc);
        let list = byMcc.get(key);
        if (!list) {
          list = [];
          byMcc.set(key, list);
        }
        list.push(row);
      }

      // 3. Rank each eligible (size ≥ N_MIN) bucket with the MCC field FILTERED.
      //    The grouping key is constant by construction → excluded so the test
      //    measures whether the OTHER fields (amount / description / counterparty)
      //    over-flag on varied real merchants.
      const filteredFields = new Set<'mcc'>(['mcc']);
      const measurements: BucketMeasurement[] = [];
      let eligibleRows = 0;
      let flaggedTotal = 0;
      // #6c witness: count flagged ops whose ONLY attributed cause is text
      // (rare-tokens). The naive-lexical failure mode (~100% of varied-merchant
      // rows lit up by a rare word) manifests as text-SOLE flags. The TEXT_CAP <
      // T_ABS invariant means text can never solely cross the tail → this MUST
      // stay 0 on real data. This is the genuine "text containment holds" tooth.
      let textSoleFlags = 0;

      for (const [mcc, bucket] of byMcc) {
        if (bucket.length < N_MIN) {
          continue;
        }
        const result = rankBucket(bucket, filteredFields);
        // A sub-N_MIN bucket would be SKIPPED; we already gated, so it ranked.
        expect(result.skipped).toBe(false);

        for (const f of result.flagged) {
          const onlyText =
            f.reasons.length > 0 &&
            f.reasons.every((r) => r.kind === 'rare-tokens');
          if (onlyText) {
            textSoleFlags += 1;
          }
        }

        const flagRate = result.flagged.length / result.bucketSize;
        const topReasons = result.flagged
          .slice(0, 3)
          .flatMap((f) => summarizeReasons(f.reasons));

        measurements.push({
          mcc,
          size: result.bucketSize,
          flagged: result.flagged.length,
          flagRate,
          topReasons,
        });

        eligibleRows += result.bucketSize;
        flaggedTotal += result.flagged.length;

        console.info(
          `[real-statement-flagrate] bucket ${JSON.stringify({
            mcc,
            size: result.bucketSize,
            flagged: result.flagged.length,
            flagRate: Number(flagRate.toFixed(4)),
            topReasons,
          })}`
        );
      }

      // Must have at least one eligible bucket, else there is nothing to prove.
      expect(measurements.length).toBeGreaterThan(0);

      const overallFlagRate = eligibleRows === 0 ? 0 : flaggedTotal / eligibleRows;

      // Largest eligible bucket (size desc, mcc asc tie-break for determinism).
      const largest = [...measurements].sort(
        (a, b) => b.size - a.size || a.mcc.localeCompare(b.mcc)
      )[0];

      // 4. Summary table for the Dev-complete report.
      const table = [...measurements]
        .sort((a, b) => b.size - a.size || a.mcc.localeCompare(b.mcc))
        .map(
          (m) =>
            `  mcc=${m.mcc.padEnd(6)} size=${String(m.size).padStart(3)} ` +
            `flagged=${String(m.flagged).padStart(3)} flagRate=${m.flagRate.toFixed(4)}`
        )
        .join('\n');

      // Re-tune banner: any clean bucket (or the overall) above the ceiling is a
      // re-tune SIGNAL to hand back to the founder.
      const overCeiling = measurements.filter(
        (m) => m.flagRate > FLAG_RATE_CEILING
      );
      const retune =
        overallFlagRate > FLAG_RATE_CEILING || overCeiling.length > 0;

      console.info(
        `[real-statement-flagrate] RAN LIVE on "${REAL_STATEMENT_PATH}":\n` +
          `  total pipeline rows    = ${rows.length}\n` +
          `  null-mcc rows (skipped)= ${nullMcc}\n` +
          `  distinct MCC groups    = ${byMcc.size}\n` +
          `  eligible buckets (≥${N_MIN}) = ${measurements.length}\n` +
          `  rows in eligible bkts  = ${eligibleRows}\n` +
          `  flagged total          = ${flaggedTotal}\n` +
          `  text-SOLE flags (#6c)  = ${textSoleFlags}  (MUST be 0 — text alone never crosses T_ABS)\n` +
          `  OVERALL flag-rate      = ${overallFlagRate.toFixed(4)} ` +
          `(ceiling ${FLAG_RATE_CEILING} ⇒ ${overallFlagRate <= FLAG_RATE_CEILING ? 'PASS' : 'RE-TUNE'})\n` +
          `  largest bucket         = mcc=${largest.mcc} size=${largest.size} ` +
          `flagRate=${largest.flagRate.toFixed(4)}\n` +
          `  ── per-bucket (size desc) ──\n${table}` +
          (retune
            ? `\n  ⚠ RE-TUNE SIGNAL: bucket(s) over ${FLAG_RATE_CEILING} → ` +
              `${overCeiling.map((m) => `mcc=${m.mcc}(${m.flagRate.toFixed(4)})`).join(', ')}.\n` +
              `    Inspect the top-reasons; hand back to the founder for an amount-knob decision.`
            : '')
      );

      // 5. TEETH.
      //
      //    After the amount-path fix (log-space outliers + the MIN_LOG_MAD
      //    min-spread floor) the AMOUNT dimension no longer over-fires on real
      //    heavy-tailed / point-like category spend:
      //      - point-like buckets (logMad < MIN_LOG_MAD, e.g. mcc 5814's ≈130s)
      //        are NON-INFORMATIVE → no longer flag every trivial deviation;
      //      - genuinely log-normal buckets (e.g. mcc 4829's 30→21000) treat the
      //        upper tail as EXPECTED → near-zero atypicality.
      //    The overall flag-rate collapses to single-digit % — the TARGET bar
      //    ("narrow ~1000 rows to ~10 worth a glance").
      //
      //    (a) #6c invariant — NO op is flagged by TEXT alone. TEXT_CAP < T_ABS
      //        makes a rare merchant word a weak signal that can never, by
      //        itself, cross the absolute tail. This is the live witness that a
      //        varied-merchant bucket does NOT light up ~100% on lexical novelty.
      expect(textSoleFlags).toBe(0);

      //    (b) TARGET — the OVERALL flag-rate is single-digit % (≤ the ceiling).
      //        This is the live witness that the amount fix hit the real bar.
      expect(overallFlagRate).toBeLessThanOrEqual(FLAG_RATE_CEILING);

      //    (c) No clean bucket saturates: every per-bucket flag-rate is far below
      //        a naive lexical impl's blanket ~100%.
      const worstFlagRate = Math.max(...measurements.map((m) => m.flagRate));
      expect(worstFlagRate).toBeLessThanOrEqual(0.5);
    });
  }
);
