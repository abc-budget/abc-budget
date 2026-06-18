/**
 * @abc-budget/engine — the public barrel (NFR-003 boundary).
 *
 * RUNTIME surface (asserted EXACTLY by boundary.spec.ts):
 *   - createDirectEngineClient  — in-thread transport (vitest / QA rides this).
 *   - createWorkerEngineClient  — production Worker transport (Story 2.6).
 *   - localeToCurrency          — pure locale→ISO mapping (Story 2.7, decision 1).
 *
 * Everything else is TYPE-ONLY: DTOs, event payloads, options, and the
 * rehydrated error classes (exported as types so callers can annotate —
 * discriminate at runtime by `err.name`, never by instanceof across the wire).
 *
 * The `./qa` subpath SUNSET at 2.6 (decode() lives on EngineClient now).
 * The `./worker` subpath is the Vite worker ENTRY — spawn it, don't import it.
 */

// ── Runtime: the two client factories (contract v5) ──────────────────────────
export { createDirectEngineClient } from './client/direct-client';
export { createWorkerEngineClient } from './client/worker-client';

// ── Runtime: pure helpers (DECLARED boundary change, 2.7 decision 1) ─────────
// localeToCurrency is a PURE function (no DAO, no engine state) — the
// cold-start base-currency gate preselects from navigator.language with it.
// Runtime surface is now EXACTLY three keys (boundary.spec.ts asserts).
export { localeToCurrency } from './internal/currency/reference';

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
  // ── Categorization DTOs (contract v4 — Story 4.9a S3c, EP-4) ──────────────
  // TYPE-ONLY: the UI imports these to render the review surface. They add NO
  // runtime symbol — boundary.spec.ts still asserts exactly 3 runtime keys.
  CategoryDTO,
  ConditionDTO,
  RuleOperatorId,
  ConditionFieldDTO,
  CategorizedRowDTO,
  CategorizedWindowDTO,
  WhyRuleDTO,
  WhyTreeDTO,
  RuleSummaryDTO,
  // ── Rule editing + sandbox DTOs (contract v5 — Story 4.9b) ─────────────────
  EditActionDTO,
  SandboxStateDTO,
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
export type { InvalidBaseCurrencyError } from './internal/settings/base-currency';

// ── App-layer integration types ───────────────────────────────────────────────
export type { ExchangeRateApi } from './internal/exchange-rate/api';
