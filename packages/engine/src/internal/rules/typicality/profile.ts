/**
 * Typicality field vocabulary + per-bucket profiling (Story 4.8 — ENT-021
 * typicality model, EP-4).
 * @module internal/rules/typicality/profile
 * @internal
 *
 * The set of row fields a typicality profile can reason about — plus the
 * profiling layer that summarizes a bucket's rows per field, and the per-field
 * atypicality functions `rankBucket` (Task 2) consumes.
 *
 * `TypicalityField` is the subset of `ImportStatementStage3RowField` strings
 * that carry signal worth scoring for "how typical is this row vs its bucket".
 * Fields like `date`, `account`, and `isBankCommission` are intentionally
 * EXCLUDED — they overlap the rule grammar's field names but are not typicality
 * dimensions.
 *
 * Everything here is PURE / SYNC / DETERMINISTIC: no `Date`, no `Math.random`,
 * no I/O. Profiles are plain data; the atypicality functions are total maps to
 * `[0, 1]`. Constants come from `./constants` — the single tuning surface.
 *
 * NOT in the public barrel — this is internal to the typicality engine.
 */

import type { ImportStatementStage3Row } from '../../importStatement/stage3/types';
import {
  AMOUNT_CURRENCY_FLOOR,
  MAD_SIGMA,
  MIN_TOKEN_LEN,
  P_MODE_GATE,
  TEXT_CAP,
  TEXT_CORE_DF,
  Z0,
  ZMAX,
} from './constants';

/**
 * A row field that participates in typicality scoring.
 *
 * Subset of `ImportStatementStage3RowField`: the dimensions a profile compares.
 */
export type TypicalityField =
  | 'mcc'
  | 'counterparty'
  | 'currency'
  | 'bankCategory'
  | 'amount'
  | 'description';

/** The categorical TypicalityFields — those profiled as value-frequency maps. */
const CATEGORICAL_FIELDS: readonly TypicalityField[] = [
  'mcc',
  'counterparty',
  'currency',
  'bankCategory',
];

// ── Primitive helpers ─────────────────────────────────────────────────────────

/** Clamp `x` into `[lo, hi]`. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Tokenize free text into lower-case, purely-alphabetic words of length
 * ≥ `MIN_TOKEN_LEN`. DEFENSIVE (ruling #6a): numbers and IDs carry no shared
 * vocabulary, so any token containing a digit (or shorter than the floor) is
 * dropped entirely.
 *
 *   "STOCK MARKET FEE" → ['stock', 'market', 'fee']
 *   "ATB 123"          → ['atb']        (the bare number is dropped)
 *   "ATB123"           → []             (digit-bearing token, not split)
 *   "#456"             → []
 *   null               → []
 *
 * Order and duplicates are preserved; the caller de-dupes per op (a Set) when
 * computing document frequency.
 */
export function tokenize(text: string | null): string[] {
  if (text === null) {
    return [];
  }
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= MIN_TOKEN_LEN && /^[a-z]+$/.test(raw)) {
      tokens.push(raw);
    }
  }
  return tokens;
}

/**
 * Deterministic median of a numeric list. ASSUMES `values` is already sorted
 * ascending and non-empty. Even count → mean of the two central values.
 */
function sortedMedian(values: readonly number[]): number {
  const n = values.length;
  const mid = n >> 1;
  return n % 2 === 1 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}

// ── Categorical profile ───────────────────────────────────────────────────────

/**
 * Frequency summary of one categorical field over a bucket.
 *
 * `counts` maps each PRESENT value → its occurrence count. `present` is the
 * number of rows with a non-empty value; `coverage` = present / total rows.
 * `mode` is the most-frequent value (null if none present); `pMode` is the
 * mode's share of the PRESENT rows.
 */
export interface CategoricalProfile {
  readonly counts: Map<string, number>;
  readonly present: number;
  readonly mode: string | null;
  readonly pMode: number;
  readonly coverage: number;
}

/** Read a categorical field as a present-or-null string (mcc via `String`). */
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

/**
 * Builds the {@link CategoricalProfile} of `field` over `rows`, considering only
 * PRESENT (non-null, non-empty) values. Iteration is insertion-ordered so the
 * mode tie-break is deterministic (first value to reach the max count wins).
 */
export function buildCategoricalProfile(
  rows: readonly ImportStatementStage3Row[],
  field: TypicalityField
): CategoricalProfile {
  const counts = new Map<string, number>();
  let present = 0;
  for (const row of rows) {
    const value = categoricalValue(row, field);
    if (value === null || value === '') {
      continue;
    }
    present += 1;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  let mode: string | null = null;
  let modeCount = 0;
  for (const [value, count] of counts) {
    if (count > modeCount) {
      mode = value;
      modeCount = count;
    }
  }

  const coverage = rows.length === 0 ? 0 : present / rows.length;
  const pMode = present === 0 ? 0 : modeCount / present;
  return { counts, present, mode, pMode, coverage };
}

/**
 * Categorical atypicality of `value` against profile `p` ∈ [0, 1].
 *
 *   a = clamp( 1 − (count(value) / present) / pMode, 0, 1 )
 *
 * The mode → 0 (it equals pMode). A singleton in a dominant-mode bucket → ≈ 1.
 * If `pMode === 0` (nothing present) the field is uninformative → 0.
 */
export function categoricalAtypicality(
  value: string,
  p: CategoricalProfile
): number {
  if (p.pMode === 0 || p.present === 0) {
    return 0;
  }
  const share = (p.counts.get(value) ?? 0) / p.present;
  return clamp(1 - share / p.pMode, 0, 1);
}

// ── Amount profile ────────────────────────────────────────────────────────────

/** Per-currency robust centre/spread of the amount field. */
export interface AmountProfile {
  readonly median: number;
  readonly mad: number;
  readonly count: number;
}

/**
 * Builds one {@link AmountProfile} per currency: the deterministic median and
 * MAD (median of absolute deviations from the median) of that currency's
 * amounts. Currencies are partitioned exactly; a single-currency bucket yields
 * a one-entry map.
 */
export function buildAmountProfiles(
  rows: readonly ImportStatementStage3Row[]
): Map<string, AmountProfile> {
  const byCurrency = new Map<string, number[]>();
  for (const row of rows) {
    let list = byCurrency.get(row.currency);
    if (!list) {
      list = [];
      byCurrency.set(row.currency, list);
    }
    list.push(row.amount);
  }

  const profiles = new Map<string, AmountProfile>();
  for (const [currency, amounts] of byCurrency) {
    const sorted = [...amounts].sort((a, b) => a - b);
    const median = sortedMedian(sorted);
    const deviations = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b);
    const mad = sortedMedian(deviations);
    profiles.set(currency, { median, mad, count: sorted.length });
  }
  return profiles;
}

/**
 * Amount atypicality of `amount` against its currency profile `c` ∈ [0, 1].
 *
 * With a degenerate spread (`mad === 0`) the bucket is point-like: exactly the
 * median → 0, anything else → 1. Otherwise a MAD-z is scaled by `MAD_SIGMA` and
 * linearly ramped from `Z0` (→ 0) to `ZMAX` (→ 1).
 */
export function amountAtypicality(amount: number, c: AmountProfile): number {
  if (c.mad === 0) {
    return amount === c.median ? 0 : 1;
  }
  const z = Math.abs(amount - c.median) / (MAD_SIGMA * c.mad);
  return clamp((z - Z0) / (ZMAX - Z0), 0, 1);
}

// ── Text profile ──────────────────────────────────────────────────────────────

/**
 * Document-frequency map over a bucket's description vocabulary: token → df,
 * where df = (# ops whose token-Set contains the token) / total rows. Each op
 * contributes a token AT MOST once (per-op de-dup). `filterTokens` are excluded
 * — those are the rule's own filter substring tokens, which are shared by
 * construction and carry no typicality signal.
 */
export function buildTextProfile(
  rows: readonly ImportStatementStage3Row[],
  filterTokens: ReadonlySet<string>
): Map<string, number> {
  const docFreq = new Map<string, number>();
  for (const row of rows) {
    const seen = new Set(tokenize(row.description));
    for (const token of seen) {
      if (filterTokens.has(token)) {
        continue;
      }
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }
  if (rows.length === 0) {
    return docFreq;
  }
  for (const [token, count] of docFreq) {
    docFreq.set(token, count / rows.length);
  }
  return docFreq;
}

/**
 * Text atypicality of an op's tokens against the bucket text profile ∈ [0, 1].
 *
 *   a = min( max over t in opTokens of (1 − df(t)), TEXT_CAP )
 *
 * The rarest token drives the score; a token unseen in the profile (df 0)
 * contributes 1 before the cap. CAPPED at `TEXT_CAP` (ruling #6b): a rare word
 * is a weak signal and must NOT, alone, cross `T_ABS`. Empty op tokens → 0.
 */
export function textAtypicality(
  opTokens: ReadonlySet<string>,
  textProfile: Map<string, number>
): number {
  if (opTokens.size === 0) {
    return 0;
  }
  let worst = 0;
  for (const token of opTokens) {
    const rarity = 1 - (textProfile.get(token) ?? 0);
    if (rarity > worst) {
      worst = rarity;
    }
  }
  return Math.min(worst, TEXT_CAP);
}

// ── Informativeness gates ─────────────────────────────────────────────────────

/**
 * The dimensions of a bucket that carry enough signal to score against. A field
 * absent from these sets is silent — `rankBucket` neither rewards nor penalizes
 * an op on it.
 */
export interface InformativeFields {
  readonly categorical: Set<TypicalityField>;
  readonly amountCurrencies: Set<string>;
  readonly text: boolean;
}

/** The profiled summaries of a bucket, bundled for the informativeness gate. */
export interface BucketProfiles {
  readonly categorical: Map<TypicalityField, CategoricalProfile>;
  readonly amount: Map<string, AmountProfile>;
  readonly text: Map<string, number>;
}

/**
 * Decides which dimensions are informative:
 *   - a categorical field iff coverage ≥ 0.5 AND pMode ≥ `P_MODE_GATE` AND the
 *     field is NOT one of the rule's own `filteredFields` (a constrained field
 *     is identical by construction — no signal);
 *   - an amount currency iff its op count ≥ `AMOUNT_CURRENCY_FLOOR`;
 *   - text iff some token clears `TEXT_CORE_DF` (a shared "core" vocabulary
 *     exists to diverge from).
 */
export function informativeFields(
  profiles: BucketProfiles,
  filteredFields: ReadonlySet<TypicalityField>
): InformativeFields {
  const categorical = new Set<TypicalityField>();
  for (const [field, p] of profiles.categorical) {
    if (
      !filteredFields.has(field) &&
      p.coverage >= 0.5 &&
      p.pMode >= P_MODE_GATE
    ) {
      categorical.add(field);
    }
  }

  const amountCurrencies = new Set<string>();
  for (const [currency, c] of profiles.amount) {
    if (c.count >= AMOUNT_CURRENCY_FLOOR) {
      amountCurrencies.add(currency);
    }
  }

  let text = false;
  for (const df of profiles.text.values()) {
    if (df >= TEXT_CORE_DF) {
      text = true;
      break;
    }
  }

  return { categorical, amountCurrencies, text };
}

// ── Bundled bucket profile ────────────────────────────────────────────────────

/**
 * The complete typicality profile of one bucket: the per-field summaries plus
 * the informativeness gates `rankBucket` (Task 2) reads to weigh each op.
 */
export interface BucketProfile extends BucketProfiles {
  readonly informative: InformativeFields;
}

/**
 * Profiles a bucket end-to-end: categorical profiles for every categorical
 * field, per-currency amount profiles, the description text profile, and the
 * informativeness gate over `filteredFields`.
 *
 * `filterTokens` are excluded from the text profile — they are the rule's own
 * filter-substring tokens, shared by construction and signal-free. The rule's
 * substring is not visible at this layer, so the caller (Task 2 / 4.9) supplies
 * them; it defaults to empty (no exclusion).
 *
 * @param rows The bucket's rows.
 * @param filteredFields The rule's constrained TypicalityFields (gated out).
 * @param filterTokens Tokens of the rule's text filter to exclude (default ∅).
 */
export function buildBucketProfile(
  rows: readonly ImportStatementStage3Row[],
  filteredFields: ReadonlySet<TypicalityField>,
  filterTokens: ReadonlySet<string> = new Set<string>()
): BucketProfile {
  const categorical = new Map<TypicalityField, CategoricalProfile>();
  for (const field of CATEGORICAL_FIELDS) {
    categorical.set(field, buildCategoricalProfile(rows, field));
  }
  const amount = buildAmountProfiles(rows);
  const text = buildTextProfile(rows, filterTokens);

  const profiles: BucketProfiles = { categorical, amount, text };
  const informative = informativeFields(profiles, filteredFields);
  return { categorical, amount, text, informative };
}
