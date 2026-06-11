/**
 * Engine configuration — store-backed hydrated snapshot.
 * @module internal/settings/engine-config
 *
 * ✅ 2.4 store-backing: the snapshot is initialized to ENT-016 defaults and is
 * overlaid by `hydrateEngineConfig(dao)` at engine init and at import-session
 * start. `setEngineParam` validates range LOUDLY (NFR-009 teeth) and writes the
 * STORE ONLY — the snapshot is frozen for the duration of the current session.
 *
 * Call surface:
 *   `getEngineConfig()` → `EngineConfig`  (byte-compatible — 6 call sites untouched)
 *   `hydrateEngineConfig(dao)` → `Promise<void>`  (ONLY snapshot mutation point)
 *   `setEngineParam(dao, key, value)` → `Promise<void>`  (validates + store write)
 *
 * @note NFR-009: never surface raw config values in the UI — `setEngineParam` is
 * the ONLY write path for engineConfig.* keys.
 *
 * `resetEngineConfigForTests()` is a test seam; it is NOT exported from any barrel.
 */

import { SettingKeys, type UserSettingsDAO } from './user-settings';

// ── EngineConfig interface ────────────────────────────────────────────────────

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

  /**
   * Whether to run deterministic auto-detect heuristics on unknown column names
   * during recall (FEAT-013).
   *
   * When OFF (default): unknown names remain UNKNOWN (no prefill generated).
   * When ON: deterministic heuristics are applied — date try-parse via detectDateFormat,
   * status-pattern via distinct-value dominance check. Results carry state: 'guessed'.
   *
   * @default false — Auto-detect is opt-in; never AI, always deterministic.
   */
  readonly recallAutoDetectEnabled: boolean;
}

// ── InvalidEngineParamError ───────────────────────────────────────────────────

/**
 * Thrown by `setEngineParam` when a value is out of range or wrong type.
 * NFR-009: validation is LOUD — the caller must handle this error explicitly.
 */
export class InvalidEngineParamError extends Error {
  constructor(key: string, reason: string) {
    super(`[engine-config] Invalid value for ${key}: ${reason}`);
    this.name = 'InvalidEngineParamError';
  }
}

// ── ENT-016 defaults ──────────────────────────────────────────────────────────

const DEFAULTS: EngineConfig = {
  acceptableParseDatePercentage: 90,
  acceptableColumnErrorPercentage: 0.3,
  successStatusThreshold: 0.8,
  recallAutoDetectEnabled: false,
};

// ── Module-level snapshot ────────────────────────────────────────────────────

/** Current session snapshot. Initialized to defaults; replaced atomically by hydrateEngineConfig. */
let snapshot: EngineConfig = { ...DEFAULTS };

// ── Validation helpers ───────────────────────────────────────────────────────

/**
 * Validates a value for the given engineConfig.* key.
 * Throws InvalidEngineParamError on out-of-range or wrong type.
 */
function validateParam(
  key: SettingKeys,
  value: unknown,
): void {
  switch (key) {
    case SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE: {
      if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 100) {
        throw new InvalidEngineParamError(
          key,
          `must be a finite number in [0, 100], got ${String(value)}`,
        );
      }
      break;
    }
    case SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE: {
      if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 1) {
        throw new InvalidEngineParamError(
          key,
          `must be a finite number in [0, 1], got ${String(value)}`,
        );
      }
      break;
    }
    case SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD: {
      if (typeof value !== 'number' || !isFinite(value) || value < 0 || value > 1) {
        throw new InvalidEngineParamError(
          key,
          `must be a finite number in [0, 1], got ${String(value)}`,
        );
      }
      break;
    }
    case SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED: {
      if (typeof value !== 'boolean') {
        throw new InvalidEngineParamError(
          key,
          `must be a boolean, got ${typeof value}`,
        );
      }
      break;
    }
    default: {
      // Non-engineConfig keys are not handled by this function; pass through.
      break;
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the engine configuration snapshot for the current session.
 *
 * The snapshot is initialized to ENT-016 defaults and is overlaid by
 * `hydrateEngineConfig` at session start. It is NOT mutated by `setEngineParam`
 * mid-session — session-frozen by design (locked decision 1).
 *
 * Byte-compatible with the prior-art static surface — all 6 call sites unchanged.
 */
export function getEngineConfig(): EngineConfig {
  return snapshot;
}

/**
 * Loads engine-config overrides from the store and replaces the module snapshot.
 *
 * This is the ONLY mutation point for the snapshot. Call at engine init and at
 * import-session start. Missing keys fall back to ENT-016 defaults.
 *
 * @param dao — UserSettingsDAO backed by the v3 userSettings store.
 */
export async function hydrateEngineConfig(dao: UserSettingsDAO): Promise<void> {
  const [
    parseDatePct,
    columnErrorPct,
    successThreshold,
    autoDetect,
  ] = await Promise.all([
    dao.getSetting<number>(SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE),
    dao.getSetting<number>(SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE),
    dao.getSetting<number>(SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD),
    dao.getSetting<boolean>(SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED),
  ]);

  snapshot = {
    acceptableParseDatePercentage:
      parseDatePct !== undefined ? parseDatePct : DEFAULTS.acceptableParseDatePercentage,
    acceptableColumnErrorPercentage:
      columnErrorPct !== undefined ? columnErrorPct : DEFAULTS.acceptableColumnErrorPercentage,
    successStatusThreshold:
      successThreshold !== undefined ? successThreshold : DEFAULTS.successStatusThreshold,
    recallAutoDetectEnabled:
      autoDetect !== undefined ? autoDetect : DEFAULTS.recallAutoDetectEnabled,
  };
}

/**
 * Validates `value` for `key` and writes it to the store ONLY.
 *
 * The current-session snapshot is NOT mutated — the new value takes effect on the
 * next `hydrateEngineConfig` call (session-frozen by design, locked decision 1).
 *
 * Throws `InvalidEngineParamError` loudly if the value is out of range or wrong type.
 * Store is NOT written on validation failure.
 *
 * @param dao — UserSettingsDAO backed by the v3 userSettings store.
 * @param key — One of the ENGINE_* SettingKeys.
 * @param value — The new value (type enforced by the overloads below).
 */
export async function setEngineParam(
  dao: UserSettingsDAO,
  key: SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE,
  value: number,
): Promise<void>;
export async function setEngineParam(
  dao: UserSettingsDAO,
  key: SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE,
  value: number,
): Promise<void>;
export async function setEngineParam(
  dao: UserSettingsDAO,
  key: SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD,
  value: number,
): Promise<void>;
export async function setEngineParam(
  dao: UserSettingsDAO,
  key: SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED,
  value: boolean,
): Promise<void>;
export async function setEngineParam(
  dao: UserSettingsDAO,
  key: SettingKeys,
  value: unknown,
): Promise<void> {
  // Validate LOUDLY before any store write (NFR-009).
  validateParam(key, value);
  // Write store only — snapshot is frozen for the current session.
  await dao.setSetting(key, value);
}

// ── Test seam ────────────────────────────────────────────────────────────────

/**
 * Restores the snapshot to pristine ENT-016 defaults.
 *
 * TEST SEAM ONLY — not exported from any barrel.
 * Must be called in beforeEach/afterEach to isolate engine-config state between tests.
 */
export function resetEngineConfigForTests(): void {
  snapshot = { ...DEFAULTS };
}
