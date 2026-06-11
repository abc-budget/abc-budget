/**
 * Engine configuration — static ENT-016 defaults.
 * @module internal/settings/engine-config
 *
 * Mirrors the prior-art `settings/engine-config.ts` call surface:
 *   `getEngineConfig()` → `EngineConfig`
 *
 * Constants are hard-coded here (ENT-016: 90 / 0.3 / 0.8).
 *
 * @note 2.4 store-backing: when the settings store is implemented (Story 2.4),
 * this module will be upgraded to read from the persistent store via IDB.
 * Until then, values are constants — do NOT surface raw config values in the UI
 * (NFR-009: configuration is internal engine concern).
 */

/**
 * Interface for engine configuration.
 * Mirrors the prior-art surface exactly so ported code can import without changes.
 */
export interface EngineConfig {
  /**
   * Minimum acceptable percentage of successfully parsed dates for format detection.
   *
   * When detecting date formats from a sample, the system calculates the percentage
   * of strings that parse under each format.  Only formats that reach at least this
   * threshold are considered valid.
   *
   * @default 90 — Requires 90 % of sampled strings to match the format (ENT-016).
   */
  readonly acceptableParseDatePercentage: number;

  /**
   * Maximum acceptable error rate during column transformation / parsing (0–1).
   *
   * If the fraction of per-cell errors exceeds this value the column transform
   * is rejected.
   *
   * @default 0.3 — Tolerates up to 30 % per-cell errors (ENT-016).
   */
  readonly acceptableColumnErrorPercentage: number;

  /**
   * Threshold for automatic success-status detection (0–1).
   *
   * The most common value in the status column must appear at least this often
   * to be treated as the "success" state.
   *
   * @default 0.8 — Most common value must cover ≥ 80 % of rows (ENT-016).
   */
  readonly successStatusThreshold: number;
}

/** Static singleton holding the ENT-016 defaults. */
const staticConfig: EngineConfig = {
  acceptableParseDatePercentage: 90,
  acceptableColumnErrorPercentage: 0.3,
  successStatusThreshold: 0.8,
};

/**
 * Returns the engine configuration.
 *
 * Currently returns the static ENT-016 defaults.  Story 2.4 will replace this
 * with a store-backed implementation that reads user overrides from IDB.
 */
export function getEngineConfig(): EngineConfig {
  return staticConfig;
}
