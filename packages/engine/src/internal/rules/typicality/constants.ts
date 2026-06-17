/**
 * Tunable constants for the ENT-021 typicality algorithm.
 * @module internal/rules/typicality/constants
 * @internal
 *
 * These are the STARTING values of the typicality math — every one is tunable
 * without touching the algorithm shape. They live in one module so a tuning pass
 * is a single-file diff and so `profile.ts` / `rankBucket` (Task 2) read from one
 * source of truth.
 *
 * Determinism note: none of these participate in any `Date`/`Math.random` path —
 * they are pure numeric knobs.
 */

/**
 * Minimum bucket size for typicality to mean anything. Below `N_MIN` ops a bucket
 * is too small to have a stable mode / median, so the consumer (rankBucket) does
 * not rank it. Tunable.
 */
export const N_MIN = 8;

/**
 * Minimum number of same-currency ops before the amount field is informative for
 * that currency. A handful of amounts give no stable median/MAD. Tunable.
 */
export const AMOUNT_CURRENCY_FLOOR = 5;

/**
 * Minimum log-space spread (`logMad`) for the amount field to be a signal for a
 * currency. Real category spend is ~log-normal, so the robust centre/spread are
 * computed on `log(|amount|)`; below this floor a currency's amounts are too
 * tightly clustered (point-like) to score — every trivial deviation would read
 * as an outlier — so the currency is treated as NON-INFORMATIVE (same philosophy
 * as a constant categorical field carrying no signal). Tunable.
 */
export const MIN_LOG_MAD = 0.1;

/**
 * The consistency constant that scales MAD to a normal-equivalent sigma
 * (`1 / Φ⁻¹(0.75) ≈ 1.4826`). Makes the MAD-based z comparable to a std-dev z for
 * normal-ish data. Tunable only if the distributional assumption changes.
 */
export const MAD_SIGMA = 1.4826;

/**
 * Lower z anchor for amount atypicality: a MAD-z at or below `Z0` contributes
 * ZERO atypicality (it is within normal spread). Tunable.
 */
export const Z0 = 3;

/**
 * Upper z anchor for amount atypicality: a MAD-z at or above `ZMAX` saturates the
 * amount atypicality to 1. The ramp runs linearly from `Z0`→`ZMAX`. Tunable.
 */
export const ZMAX = 6;

/**
 * Absolute atypicality threshold — an op whose aggregated atypicality reaches
 * `T_ABS` is flagged as atypical. Tunable. (Aggregation itself is Task 2.)
 */
export const T_ABS = 0.6;

/**
 * Minimum mode-share for a categorical field to be informative. Below this the
 * field has no dominant value, so divergence from "the mode" is meaningless.
 * Tunable.
 */
export const P_MODE_GATE = 0.5;

/**
 * Minimum document-frequency for a token to count as shared "core" vocabulary.
 * Text is only informative when at least one token clears `TEXT_CORE_DF`. Tunable.
 */
export const TEXT_CORE_DF = 0.5;

/**
 * The atypicality value reported for a field when it is informative but the op
 * sits exactly at the mode (or otherwise contributes nothing distinctive). Used
 * by Task 2's reporting surface; kept here as the single tunable source. Tunable.
 */
export const REPORT_A_F = 0.5;

/**
 * Hard cap on text atypicality. Text alone must NOT be able to cross `T_ABS`
 * (ruling #6b) — a rare word is a weak signal, never a sole flag. INVARIANT:
 * `TEXT_CAP < T_ABS`. Tunable, but the invariant must hold.
 */
export const TEXT_CAP = 0.5;

/**
 * Minimum length of a kept token (after lowercasing). Shorter alphabetic
 * fragments are noise. Tunable.
 */
export const MIN_TOKEN_LEN = 3;
