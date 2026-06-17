/**
 * EngineClient — the public interface for interacting with the engine.
 *
 * Contract v4: explicit session protocol; out-of-band progress/blocked/dead
 * events; base-currency surface (2.7 decision 1); categorization surface
 * (4.9a S3c — EP-4).
 * NO RxJS on this surface (NFR-003 boundary holds).
 * All types are DTO imports — no internal class instances cross this boundary.
 */

import type {
  Stage2SnapshotDTO,
  ColumnRejectionDTO,
  RowWindowDTO,
  GenerateResultDTO,
  UnmappedColumnsDTO,
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  CategorizedWindowDTO,
  WhyTreeDTO,
  RuleSummaryDTO,
} from './dto';
import type { DecodeResult } from '../internal/ingest/types';

export interface EngineVersion {
  /** semver of @abc-budget/engine */
  engine: string;
  /** integer EngineClient contract version — bumps per the bump rule in protocol.ts */
  contract: number;
}

// ── Out-of-band event payloads ────────────────────────────────────────────────

export interface ProgressEventPayload {
  readonly event: 'progress';
  readonly jobId: string;
  readonly phase: string;
  readonly done: number;
  readonly total: number;
}

export interface BlockedEventPayload {
  readonly event: 'blocked';
}

export interface DeadEventPayload {
  readonly event: 'dead';
}

/** Union of all out-of-band event payloads delivered via onEvent. */
export type EngineEventPayload = ProgressEventPayload | BlockedEventPayload | DeadEventPayload;

// ── Session result unions ─────────────────────────────────────────────────────

/** Result of importStart: the new sessionId + initial stage2 snapshot. */
export interface ImportStartResult {
  readonly sessionId: string;
  readonly stage2: Stage2SnapshotDTO;
}

/**
 * Result of importApplyColumn / importResetColumn:
 * either a fresh stage2 snapshot or a rejection DTO.
 */
export type ApplyColumnResult =
  | { readonly ok: true; readonly snapshot: Stage2SnapshotDTO }
  | { readonly ok: false; readonly rejection: ColumnRejectionDTO };

/**
 * Result of importNext: either the generated rows or an unmapped-columns error.
 */
export type ImportNextResult =
  | { readonly ok: true; readonly result: GenerateResultDTO }
  | { readonly ok: false; readonly unmapped: UnmappedColumnsDTO };

// ── EngineClient ──────────────────────────────────────────────────────────────

export interface EngineClient {
  // ── Baseline ───────────────────────────────────────────────────────────────

  /** Echoes the message back. Proves serializable args+returns survive a thread hop. */
  ping(message: string): Promise<string>;

  /** Returns the engine semver + contract version integer. */
  getVersion(): Promise<EngineVersion>;

  // ── Decode ─────────────────────────────────────────────────────────────────

  /**
   * Decode raw bytes (CSV/XLSX/XLS) into rows + meta.
   * Input bytes arrive as ArrayBuffer (transferable).
   * Returns a plain DecodeResult — already JSON-safe (no Date/Message).
   */
  decode(bytes: ArrayBuffer, fileName: string): Promise<DecodeResult>;

  // ── Import session ─────────────────────────────────────────────────────────

  /**
   * Start an import session from decoded rows.
   * Creates stage1 → stage2 worker-side.
   * Returns a sessionId and the initial stage2 snapshot.
   *
   * Throws SessionAlreadyActiveError if another session is active.
   */
  importStart(rows: Record<string, unknown>[]): Promise<ImportStartResult>;

  /**
   * Apply a column definition to the active session.
   * Returns a snapshot on success, or a ColumnRejectionDTO when >threshold errors.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importApplyColumn(
    sessionId: string,
    columnId: string,
    definition: string,
    params: Record<string, unknown> | null,
  ): Promise<ApplyColumnResult>;

  /**
   * Reset a column to its initial state.
   * Returns the updated stage2 snapshot.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importResetColumn(sessionId: string, columnId: string): Promise<Stage2SnapshotDTO>;

  /**
   * Confirm a GUESSED recall mapping for a column (GUESSED → confirmed).
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importConfirmRecall(sessionId: string, columnId: string): Promise<void>;

  /**
   * Resolve a save collision with LWW confirm.
   * @param confirm true = overwrite existing (LWW), false = keep existing
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importResolveCollision(sessionId: string, confirm: boolean): Promise<void>;

  /**
   * Get a windowed slice of generated rows (row economy).
   * Returns a RowWindowDTO with offset, total, and the requested slice.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importGetRows(sessionId: string, offset: number, count: number): Promise<RowWindowDTO>;

  /**
   * Advance to stage3 and generate all rows.
   * Returns GenerateResultDTO on success, or UnmappedColumnsDTO when columns remain unmapped.
   * Flushes the staged recall writes to the pool (2.8 decision #4 — the advance is
   * the user's endorsement). DECLARED CHANGE (2.8 decision #4 + PM clarification):
   * completing this call NO LONGER frees the session — it stays live for S3c to
   * reuse. Only importAbort frees the session now.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importNext(sessionId: string): Promise<ImportNextResult>;

  /**
   * Abort an active session, freeing the worker-side stage graph.
   * No-op if the session is already gone.
   */
  importAbort(sessionId: string): Promise<void>;

  // ── Base currency (contract v3 — Story 2.7, decision 1) ───────────────────

  /**
   * The cold-start gate's PROBE: returns the stored base-currency ISO code,
   * or null when unset (no exception-driven control flow — unset is an
   * expected first-run state). Also null where persistence is unavailable.
   *
   * NFR-009 holds: raw settings stay internal — only this dedicated surface
   * crosses the boundary.
   */
  getBaseCurrency(): Promise<string | null>;

  /**
   * Persist the base currency. Validates `iso` against the 1.6 currency
   * reference; invalid codes throw InvalidBaseCurrencyError (typed across
   * the wire).
   *
   * LIVE-READ pin (decision 1): the value is read live from the DAO at
   * `use_base` resolution time — setBaseCurrency() → importStart in one
   * breath resolves to the just-set currency, never a stale snapshot.
   *
   * Throws loud when persistence is unavailable (no indexedDB) — a set that
   * cannot persist must never look successful.
   */
  setBaseCurrency(iso: string): Promise<void>;

  // ── Categorization (contract v4 — Story 4.9a S3c, EP-4) ───────────────────

  /**
   * Get a windowed slice of categorized rows for the live session.
   *
   * @param opts.offset  First row index in the (segment-filtered) result set.
   * @param opts.count   Window size (row economy — full data flows only here).
   * @param opts.segment 'all' = every row; 'uncat' = only uncategorized rows.
   * @param opts.draft   Optional draft conditions to preview a not-yet-saved
   *                     rule against the window (sandbox eval) without persisting.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importCategorizedRows(
    sessionId: string,
    opts: { offset: number; count: number; segment: 'all' | 'uncat'; draft?: ConditionDTO[] },
  ): Promise<CategorizedWindowDTO>;

  /**
   * List the condition fields available for rule-building against the session's
   * rows (field + value-kind + valid operators + enumerated options).
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importConditionFields(sessionId: string): Promise<ConditionFieldDTO[]>;

  /**
   * Explain why a row is categorized the way it is: the manual override (if
   * any), every evaluated rule's win/miss/neutral status with per-condition
   * met-state, and the winning rule id.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importWhy(sessionId: string, rowIndex: number): Promise<WhyTreeDTO>;

  /**
   * List the rules currently applied to the session, each with its conditions,
   * target category, and applied-row count.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importRulesList(sessionId: string): Promise<RuleSummaryDTO[]>;

  /**
   * Persist a new rule (conditions → categoryId). Returns the new rule id.
   */
  rulesCreate(conditions: ConditionDTO[], categoryId: string): Promise<{ ruleId: number }>;

  /** List all categories (id + display fields). */
  categoriesList(): Promise<CategoryDTO[]>;

  /** Create a new category. Returns the created category (with its new id). */
  categoriesCreate(input: { name: string; icon: string; currency: string }): Promise<CategoryDTO>;

  // ── Out-of-band events ─────────────────────────────────────────────────────

  /**
   * Subscribe to out-of-band engine events (progress / blocked / dead).
   * Returns an unsubscribe function.
   *
   * No RxJS — plain callback pattern (NFR-003 boundary holds).
   */
  onEvent(cb: (event: EngineEventPayload) => void): () => void;
}
