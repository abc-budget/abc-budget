/**
 * @abc-budget/engine — the public barrel (NFR-003 boundary).
 *
 * RUNTIME surface (asserted EXACTLY by boundary.spec.ts):
 *   - createDirectEngineClient  — in-thread transport (vitest / QA rides this).
 *   - createWorkerEngineClient  — production Worker transport (Story 2.6).
 *
 * Everything else is TYPE-ONLY: DTOs, event payloads, options, and the
 * rehydrated error classes (exported as types so callers can annotate —
 * discriminate at runtime by `err.name`, never by instanceof across the wire).
 *
 * The `./qa` subpath SUNSET at 2.6 (decode() lives on EngineClient now).
 * The `./worker` subpath is the Vite worker ENTRY — spawn it, don't import it.
 */

// ── Runtime: the two client factories ────────────────────────────────────────
export { createDirectEngineClient } from './client/direct-client';
export { createWorkerEngineClient } from './client/worker-client';

// ── Client surface types ──────────────────────────────────────────────────────
export type {
  EngineClient,
  EngineVersion,
  EngineEventPayload,
  ProgressEventPayload,
  BlockedEventPayload,
  DeadEventPayload,
  ImportStartResult,
  ApplyColumnResult,
  ImportNextResult,
} from './client/engine-client';
export type { EngineInitOptions } from './client/direct-client';
export type { WorkerLike, WorkerClientOptions, ClockSeam } from './client/worker-client';

// ── DTO types (the wire shapes the UI renders) ────────────────────────────────
export type {
  SerializedMessage,
  SnapshotCellDTO,
  Stage2ColumnDTO,
  CollisionDTO,
  Stage2SnapshotDTO,
  CellErrorDTO,
  ColumnRejectionDTO,
  TransactionRowDTO,
  RowWindowDTO,
  RowErrorDTO,
  SkippedRowDTO,
  GenerateResultDTO,
  UnmappedColumnsDTO,
} from './client/dto';

// ── Decode result types (2.1 surface — now via EngineClient.decode) ──────────
export type { DecodeResult, DecodeMeta, DecodeIssue } from './internal/ingest/types';

// ── Error types (type-only: rehydrated client-side; discriminate by .name) ───
export type {
  ContractMismatchError,
  EngineWorkerDiedError,
  SessionAlreadyActiveError,
  SessionUnknownError,
  EngineError,
  WireError,
} from './client/errors';

// ── App-layer integration types ───────────────────────────────────────────────
export type { ExchangeRateApi } from './internal/exchange-rate/api';
