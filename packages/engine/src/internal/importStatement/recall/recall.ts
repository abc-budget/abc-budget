/**
 * Recall pool — columnName → type (+ params), NFC-keyed, collision-aware.
 * @module importStatement/recall/recall
 * @internal
 *
 * Implements FEAT-005 (pool), FEAT-013 (recall = deterministic lookup;
 * GUESSED ◇ ≠ confirmed ✓ ≠ unknown ?), FEAT-009 (N-of-M recognized).
 *
 * Locked decisions:
 *   LD-1: One pool entry per key. Collision = {kind: 'type-change' | 'params-change'};
 *         LWW after explicit confirmSave().
 *   LD-2: Pool key = columnName.normalize('NFC').trim() — applied BEFORE save AND at
 *         lookup. Stored columnName IS the normalized key.
 *
 * Determinism: no Date.now / Math.random anywhere. LWW is structural.
 */

import type { DbProvider } from '../../store/idb/dao-impl';
import type { ColumnDefinition, ColumnParams } from '../types';
import { IDBRecallPoolDAO } from './pool-dao';
import { detectDateFormat } from '../../utils/date/format-detector';
import { getEngineConfig } from '../../settings/engine-config';

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * The state of a prefill entry.
 *
 * 'guessed' ◇ — recalled from pool or auto-detected; one-click confirm needed.
 * Future: 'confirmed' ✓ — explicitly confirmed by the user (2.7/2.8).
 */
export type PrefillState = 'guessed';

/**
 * A prefill entry returned by recallFor.
 */
export interface PrefillEntry {
  readonly definition: ColumnDefinition;
  readonly params: ColumnParams | null;
  readonly state: PrefillState;
}

/**
 * N-of-M recognized count.
 * n = number of names found in pool (or auto-detected); m = total names queried.
 */
export interface RecognizedCount {
  readonly n: number;
  readonly m: number;
}

/**
 * Result of recallFor().
 */
export interface RecallResult {
  /** Map from normalized column name → prefill entry. Unknown names are absent. */
  readonly prefills: Map<string, PrefillEntry>;
  readonly recognized: RecognizedCount;
}

/**
 * Collision descriptor (LD-1).
 */
export interface CollisionDescriptor {
  readonly kind: 'type-change' | 'params-change';
  readonly existing: { readonly definition: ColumnDefinition; readonly params: ColumnParams | null };
  readonly incoming: { readonly definition: ColumnDefinition; readonly params: ColumnParams | null };
}

/**
 * Result of save().
 */
export type SaveResult =
  | { readonly outcome: 'saved' }
  | { readonly outcome: 'collision'; readonly collision: CollisionDescriptor };

/**
 * Options for recallFor() — controls auto-detect heuristics.
 */
export interface RecallOptions {
  /**
   * Sample values per column name (raw — not yet normalized).
   * Required for auto-detect heuristics. May be omitted if autoDetect is false.
   */
  readonly sampleValues?: Record<string, string[]>;
  /**
   * Whether to run auto-detect heuristics for unknown names.
   * Overrides the engine config flag for this call.
   * If omitted, falls back to getEngineConfig().recallAutoDetectEnabled.
   */
  readonly autoDetect?: boolean;
}

/**
 * The recall pool public interface.
 */
export interface RecallPool {
  /**
   * Gets all normalized keys currently in the pool.
   */
  getAllKeys(): Promise<string[]>;

  /**
   * Saves a column definition + params to the pool.
   * The name is normalized (NFC+trim) before save (LD-2).
   *
   * - New name: always saved.
   * - Identical entry (same definition + deep-equal params): no-op 'saved'.
   * - Same definition + different params: 'collision' with kind 'params-change'.
   * - Different definition: 'collision' with kind 'type-change'.
   */
  save(
    name: string,
    definition: ColumnDefinition,
    params: ColumnParams | null
  ): Promise<SaveResult>;

  /**
   * Read-only collision DETECT — returns the SAME SaveResult `save()` would,
   * but performs NO write (2.8 decision #4 defer-commit). Used at map time so
   * the UX surfaces collisions identically to today while the actual pool write
   * is deferred to advance (flushRecallWrites). The name is normalized (NFC+trim)
   * before the read (LD-2).
   *
   * - New name → { outcome: 'saved' } (would-write, but writes nothing).
   * - Identical entry → { outcome: 'saved' } (no-op either way).
   * - Same definition + different params → params-change collision.
   * - Different definition → type-change collision.
   */
  detectCollision(
    name: string,
    definition: ColumnDefinition,
    params: ColumnParams | null
  ): Promise<SaveResult>;

  /**
   * Last-Write-Wins overwrite — called after the user confirms a collision.
   * The name is normalized before the write (LD-2).
   */
  confirmSave(
    name: string,
    definition: ColumnDefinition,
    params: ColumnParams | null
  ): Promise<void>;

  /**
   * Looks up the given column names in the pool and returns GUESSED prefills
   * for known names (FEAT-013). Unknown names are absent from the result map.
   *
   * Names are normalized before lookup (LD-2) — so NFD/padded inputs hit the
   * same entry as their NFC/trimmed canonical form. The Map keys are the
   * normalized forms.
   *
   * When auto-detect is enabled (via options or engine config), deterministic
   * heuristics are applied to unknown names using sampleValues:
   *   - Date heuristic: detectDateFormat over sample → ColumnDefinition.DATE
   *   - Status heuristic: distinct-value dominance check → ColumnDefinition.STATUS
   * Results carry state: 'guessed'.
   */
  recallFor(names: string[], options?: RecallOptions): Promise<RecallResult>;
}

// ── normalizeKey ──────────────────────────────────────────────────────────────

/**
 * Normalizes a column name to its canonical pool key.
 * Applies NFC normalization + trim (LD-2).
 * Case and internal whitespace are preserved.
 */
export function normalizeKey(name: string): string {
  return name.normalize('NFC').trim();
}

// ── Deep-equality for params ──────────────────────────────────────────────────

/**
 * Canonical JSON for plain data values: object keys are sorted recursively so
 * the serialization is insensitive to key insertion order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const parts = Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);
  return `{${parts.join(',')}}`;
}

/**
 * Deep-equal comparison for ColumnParams | null.
 * Used to detect no-op saves vs. params-change collisions.
 * Key-order-insensitive (2.3 QA FINDING-2): semantically identical params with
 * different key insertion order must NOT raise a phantom params-change collision.
 * Deterministic: no Date.now/Math.random.
 */
function paramsEqual(a: ColumnParams | null, b: ColumnParams | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return stableStringify(a) === stableStringify(b);
}

// ── Auto-detect heuristics ────────────────────────────────────────────────────

/**
 * Status-pattern heuristic.
 *
 * A column qualifies as STATUS if:
 *   1. It has ≤ 10 distinct values (small categorical set).
 *   2. One value appears in ≥ 80% of rows (dominance — mirrors successStatusThreshold).
 *   3. Total values ≥ 10 (avoid false positives on tiny samples).
 *
 * Deterministic: counts only; no random sampling.
 */
function detectStatusPattern(values: string[]): boolean {
  if (values.length < 10) return false;

  const freq = new Map<string, number>();
  for (const v of values) {
    freq.set(v, (freq.get(v) ?? 0) + 1);
  }

  const distinctCount = freq.size;
  if (distinctCount > 10) return false;

  const { successStatusThreshold } = getEngineConfig();
  const maxFreq = Math.max(...freq.values());
  const dominance = maxFreq / values.length;

  return dominance >= successStatusThreshold;
}

/**
 * Runs auto-detect heuristics for a single unknown column.
 * Returns the detected definition + params, or null if nothing detected.
 *
 * Priority: DATE first, then STATUS.
 * Results are always 'guessed' — never confirmed.
 */
async function autoDetectColumn(
  name: string,
  sampleValues: Record<string, string[]>
): Promise<{ definition: ColumnDefinition; params: ColumnParams | null } | null> {
  // Lazy import ColumnDefinition to avoid circular at module-load time
  const { ColumnDefinition: CD } = await import('../types');

  const values = sampleValues[name] ?? sampleValues[normalizeKey(name)] ?? [];
  if (values.length === 0) return null;

  // 1. Date heuristic
  const dateFormat = await detectDateFormat(values);
  if (dateFormat !== null) {
    return {
      definition: CD.DATE as ColumnDefinition,
      params: { format: 'auto' } as ColumnParams,
    };
  }

  // 2. Status heuristic
  if (detectStatusPattern(values)) {
    return {
      definition: CD.STATUS as ColumnDefinition,
      params: { successValue: 'auto' } as ColumnParams,
    };
  }

  return null;
}

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * Creates a RecallPool backed by the IDBRecallPoolDAO.
 *
 * @param dbProvider - Provides the open database instance (migration v3 or test DB).
 */
export function createRecallPool(dbProvider: DbProvider): RecallPool {
  const dao = new IDBRecallPoolDAO(dbProvider);

  return {
    async getAllKeys(): Promise<string[]> {
      return dao.getAllKeys() as Promise<string[]>;
    },

    async detectCollision(
      name: string,
      definition: ColumnDefinition,
      params: ColumnParams | null
    ): Promise<SaveResult> {
      // READ + COMPARE only — never writes (2.8 decision #4). save() reuses this.
      const key = normalizeKey(name);
      const existing = await dao.getEntry(key);

      if (!existing) {
        // New entry: a save() here WOULD write, so the outcome is 'saved'.
        return { outcome: 'saved' };
      }

      // Identical: definition same + params deep-equal → no-op 'saved'
      if (existing.definition === definition && paramsEqual(existing.params, params)) {
        return { outcome: 'saved' };
      }

      // Collision
      const kind: 'type-change' | 'params-change' =
        existing.definition !== definition ? 'type-change' : 'params-change';

      return {
        outcome: 'collision',
        collision: {
          kind,
          existing: { definition: existing.definition, params: existing.params },
          incoming: { definition, params },
        },
      };
    },

    async save(
      name: string,
      definition: ColumnDefinition,
      params: ColumnParams | null
    ): Promise<SaveResult> {
      // Detect first (read + compare); only write on the would-save path. A
      // collision returns WITHOUT writing — the safe no-clobber default (LD-1).
      const result = await this.detectCollision(name, definition, params);
      if (result.outcome === 'saved') {
        const key = normalizeKey(name);
        const existing = await dao.getEntry(key);
        // Only a genuinely new entry needs a write; an identical entry is a no-op.
        if (!existing) {
          await dao.putEntry({ columnName: key, definition, params });
        }
      }
      return result;
    },

    async confirmSave(
      name: string,
      definition: ColumnDefinition,
      params: ColumnParams | null
    ): Promise<void> {
      const key = normalizeKey(name);
      await dao.putEntry({ columnName: key, definition, params });
    },

    async recallFor(names: string[], options?: RecallOptions): Promise<RecallResult> {
      const prefills = new Map<string, PrefillEntry>();

      // Normalize all incoming names → lookup keys
      const normalizedNames = names.map((n) => normalizeKey(n));

      // Batch-read from pool
      const entries = await dao.batchRead(normalizedNames);
      for (const entry of entries) {
        prefills.set(entry.columnName, {
          definition: entry.definition,
          params: entry.params,
          state: 'guessed',
        });
      }

      // Auto-detect for unknown names if enabled
      const engineAutoDetect = getEngineConfig().recallAutoDetectEnabled;
      const autoDetect = options?.autoDetect ?? engineAutoDetect;

      if (autoDetect && options?.sampleValues) {
        for (const normalizedName of normalizedNames) {
          if (prefills.has(normalizedName)) continue; // already known

          // Find the raw name to look up sample values (try normalized or original)
          const rawName = names.find((n) => normalizeKey(n) === normalizedName) ?? normalizedName;

          const detected = await autoDetectColumn(rawName, options.sampleValues);
          if (detected !== null) {
            prefills.set(normalizedName, {
              definition: detected.definition,
              params: detected.params,
              state: 'guessed',
            });
          }
        }
      }

      return {
        prefills,
        recognized: {
          n: prefills.size,
          m: names.length,
        },
      };
    },
  };
}
