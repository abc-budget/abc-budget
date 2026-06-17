/**
 * The ENT-021 typicality pipeline entry point (Story 4.8, Task 2, EP-4).
 * @module internal/rules/typicality
 * @internal
 *
 * `rankBucket` assembles the per-bucket typicality scoring from the Task 1 math
 * core (`./profile`) and the Task 1 knobs (`./constants`). The pipeline is:
 *
 *   1. N-gate           — buckets below `N_MIN` are too small to have a stable
 *                         mode/median; they are SKIPPED (not ranked).
 *   2. profile once     — `buildBucketProfile` summarizes the whole bucket a
 *                         SINGLE time; per-op scoring re-reads it (O(N), no
 *                         per-op re-scan).
 *   3. per-op a_f       — for each op, gather its per-field atypicalities, but
 *                         ONLY over INFORMATIVE fields that are PRESENT on the op
 *                         (an absent or uninformative field is silent).
 *   4. NOISY-OR         — combine: atypicality = 1 − Π (1 − a_f). Independent
 *                         weak signals reinforce; a single strong one dominates.
 *                         (NOT a weighted average.)
 *   5. ABSOLUTE tail    — keep ops with atypicality ≥ `T_ABS` (an absolute
 *                         threshold, NOT a top-K). Sorted atypicality DESC, ties
 *                         broken by `rowIndex` ASC for a stable total order.
 *   6. attribution      — per flagged op, one `TypicalityReason` per field whose
 *                         a_f ≥ `REPORT_A_F`, ordered by ENT-021 signal strength
 *                         (mcc → amount → text → counterparty → currency →
 *                         bankCategory), then a_f desc.
 *
 * PURE / SYNC / DETERMINISTIC: no `Date`, no `Math.random`, no I/O, no rxjs.
 *
 * NOT in the public barrel — internal to the typicality engine.
 */

import type { ImportStatementStage3Row } from '../../importStatement/stage3/types';
import { N_MIN, REPORT_A_F, T_ABS } from './constants';
import {
  amountAtypicality,
  buildBucketProfile,
  categoricalAtypicality,
  textAtypicality,
  tokenize,
  type AmountProfile,
  type BucketProfile,
  type TypicalityField,
} from './profile';

// ── Public types ─────────────────────────────────────────────────────────────

/**
 * A single attributed cause behind an op's flag: the field, the kind of
 * divergence, and the kind-specific payload the UI surfaces.
 *
 *   - categorical-minority → `value` (mcc as the number, others as the string).
 *   - amount-outlier       → `magnitude` (≈ ×N the typical: `round(|amount| /
 *                            rawMedian)`, a finite, interpretable multiple).
 *   - rare-tokens          → `tokens` (the op's rarest non-filter tokens).
 */
export interface TypicalityReason {
  readonly field: TypicalityField;
  readonly kind: 'categorical-minority' | 'amount-outlier' | 'rare-tokens';
  readonly value?: string | number;
  readonly magnitude?: number;
  readonly tokens?: string[];
}

/** One op that crossed the absolute tail, with its score and attribution. */
export interface FlaggedOp {
  readonly row: ImportStatementStage3Row;
  readonly atypicality: number;
  readonly reasons: TypicalityReason[];
}

/** The typicality verdict for one bucket. */
export interface BucketTypicality {
  readonly skipped: boolean;
  readonly bucketSize: number;
  readonly flagged: FlaggedOp[];
}

// ── Internals ────────────────────────────────────────────────────────────────

/** The categorical TypicalityFields, in ENT-021 signal-strength order. */
const CATEGORICAL_FIELDS: readonly TypicalityField[] = [
  'mcc',
  'counterparty',
  'currency',
  'bankCategory',
];

/**
 * ENT-021 signal-strength rank of a field (lower = stronger). Drives the
 * deterministic reason order: mcc → amount → text → counterparty → currency →
 * bankCategory.
 */
const FIELD_RANK: Record<TypicalityField, number> = {
  mcc: 0,
  amount: 1,
  description: 2,
  counterparty: 3,
  currency: 4,
  bankCategory: 5,
};

/** Reads a categorical field as a present-or-null string (mcc via `String`). */
function categoricalValue(
  row: ImportStatementStage3Row,
  field: TypicalityField
): string | null {
  switch (field) {
    case 'mcc':
      return row.mcc === null ? null : String(row.mcc);
    case 'counterparty':
      return row.counterparty;
    case 'currency':
      return row.currency;
    case 'bankCategory':
      return row.bankCategory;
    default:
      return null;
  }
}

/** The raw `value` payload for a categorical reason (mcc as the number). */
function categoricalReasonValue(
  row: ImportStatementStage3Row,
  field: TypicalityField
): string | number {
  if (field === 'mcc') {
    return row.mcc as number;
  }
  return categoricalValue(row, field) as string;
}

/**
 * The reported amount-outlier magnitude: ≈ how many times the typical spend this
 * op is, `round(|amount| / rawMedian)`. Finite and interpretable (no Infinity).
 * A non-positive / zero `rawMedian` is degenerate → 0.
 */
function amountMultiple(amount: number, c: AmountProfile): number {
  if (c.rawMedian === 0) {
    return 0;
  }
  return Math.round(Math.abs(amount) / Math.abs(c.rawMedian));
}

/**
 * The op's rarest non-filter tokens — those driving its text atypicality. A
 * token's rarity is `1 − df`; we surface every token sharing the maximum rarity
 * (the worst), in first-seen order, de-duplicated.
 */
function rareTokens(
  opTokens: ReadonlySet<string>,
  textProfile: Map<string, number>
): string[] {
  let worst = 0;
  for (const token of opTokens) {
    const rarity = 1 - (textProfile.get(token) ?? 0);
    if (rarity > worst) {
      worst = rarity;
    }
  }
  const driving: string[] = [];
  for (const token of opTokens) {
    const rarity = 1 - (textProfile.get(token) ?? 0);
    if (rarity === worst) {
      driving.push(token);
    }
  }
  return driving;
}

/** One scored field contribution for an op: its a_f plus how to attribute it. */
interface FieldScore {
  readonly field: TypicalityField;
  readonly a: number;
  /** Builds the reason when this field clears `REPORT_A_F`. */
  readonly reason: () => TypicalityReason;
}

/**
 * Gathers an op's per-field atypicalities over the INFORMATIVE fields that are
 * PRESENT on the op. Each entry pairs the a_f with a reason factory used during
 * attribution (the factory is only invoked for reported fields).
 */
function scoreOp(
  row: ImportStatementStage3Row,
  profile: BucketProfile
): FieldScore[] {
  const scores: FieldScore[] = [];
  const { informative } = profile;

  // Categorical fields — informative AND present on the op.
  for (const field of CATEGORICAL_FIELDS) {
    if (!informative.categorical.has(field)) {
      continue;
    }
    const value = categoricalValue(row, field);
    if (value === null || value === '') {
      continue;
    }
    const catProfile = profile.categorical.get(field)!;
    const a = categoricalAtypicality(value, catProfile);
    scores.push({
      field,
      a,
      reason: () => ({
        field,
        kind: 'categorical-minority',
        value: categoricalReasonValue(row, field),
      }),
    });
  }

  // Amount — informative iff the op's currency cleared the per-currency floor.
  if (informative.amountCurrencies.has(row.currency)) {
    const currencyProfile = profile.amount.get(row.currency)!;
    const a = amountAtypicality(row.amount, currencyProfile);
    scores.push({
      field: 'amount',
      a,
      reason: () => ({
        field: 'amount',
        kind: 'amount-outlier',
        magnitude: amountMultiple(row.amount, currencyProfile),
      }),
    });
  }

  // Text — informative iff the bucket has a shared core vocabulary.
  if (informative.text) {
    const opTokens = new Set(tokenize(row.description));
    const a = textAtypicality(opTokens, profile.text);
    scores.push({
      field: 'description',
      a,
      reason: () => ({
        field: 'description',
        kind: 'rare-tokens',
        tokens: rareTokens(opTokens, profile.text),
      }),
    });
  }

  return scores;
}

/** NOISY-OR combine of the per-field atypicalities: 1 − Π (1 − a_f). */
function noisyOr(scores: readonly FieldScore[]): number {
  let product = 1;
  for (const { a } of scores) {
    product *= 1 - a;
  }
  return 1 - product;
}

/**
 * Builds the ordered reasons for a flagged op: one per field whose a_f clears
 * `REPORT_A_F`, sorted by ENT-021 signal strength then a_f descending.
 */
function attribute(scores: readonly FieldScore[]): TypicalityReason[] {
  return scores
    .filter((s) => s.a >= REPORT_A_F)
    .sort((x, y) => FIELD_RANK[x.field] - FIELD_RANK[y.field] || y.a - x.a)
    .map((s) => s.reason());
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Ranks a bucket's rows by ENT-021 typicality. See the module doc for the full
 * pipeline. Returns the SKIPPED verdict for sub-`N_MIN` buckets, otherwise the
 * ops that crossed the absolute `T_ABS` tail, atypicality-DESC / rowIndex-ASC,
 * each with its structured attribution.
 *
 * @param rows The bucket's rows (read-only).
 * @param filteredFields The rule's constrained TypicalityFields (gated out).
 */
export function rankBucket(
  rows: readonly ImportStatementStage3Row[],
  filteredFields: ReadonlySet<TypicalityField>
): BucketTypicality {
  const bucketSize = rows.length;

  // 1. N-gate.
  if (bucketSize < N_MIN) {
    return { skipped: true, bucketSize, flagged: [] };
  }

  // 2. Profile the whole bucket once.
  const profile = buildBucketProfile(rows, filteredFields);

  // 3–5. Per-op scoring → NOISY-OR → ABSOLUTE tail.
  const flagged: FlaggedOp[] = [];
  for (const row of rows) {
    const scores = scoreOp(row, profile);
    const atypicality = noisyOr(scores);
    if (atypicality >= T_ABS) {
      flagged.push({ row, atypicality, reasons: attribute(scores) });
    }
  }

  // Sort: atypicality DESC, tie-break rowIndex ASC (stable total order).
  flagged.sort(
    (a, b) => b.atypicality - a.atypicality || a.row.rowIndex - b.row.rowIndex
  );

  return { skipped: false, bucketSize, flagged };
}
