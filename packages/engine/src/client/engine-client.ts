/**
 * EngineClient — the public interface for interacting with the engine.
 *
 * Contract v2: explicit session protocol; out-of-band progress/blocked/dead events.
 * NO RxJS on this surface (NFR-003 boundary holds).
 * All types are DTO imports — no internal class instances cross this boundary.
 */

import type {
  Stage2SnapshotDTO,
  ColumnRejectionDTO,
  RowWindowDTO,
  GenerateResultDTO,
  UnmappedColumnsDTO,
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
   * Completing this call frees the session from the registry.
   *
   * Throws SessionUnknownError if sessionId is not found.
   */
  importNext(sessionId: string): Promise<ImportNextResult>;

  /**
   * Abort an active session, freeing the worker-side stage graph.
   * No-op if the session is already gone.
   */
  importAbort(sessionId: string): Promise<void>;

  // ── Out-of-band events ─────────────────────────────────────────────────────

  /**
   * Subscribe to out-of-band engine events (progress / blocked / dead).
   * Returns an unsubscribe function.
   *
   * No RxJS — plain callback pattern (NFR-003 boundary holds).
   */
  onEvent(cb: (event: EngineEventPayload) => void): () => void;
}
