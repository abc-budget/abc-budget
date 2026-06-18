/**
 * Wire envelope for the EngineClient transport (contract v4).
 *
 * CONTRACT VERSION BUMP RULE (decision 2, 2026-06-12):
 *   Increment CONTRACT_VERSION whenever ANY of the following change:
 *     - The EngineMethod union (additions AND removals).
 *     - The argument or return shape of any method.
 *     - The envelope field names or semantics (HelloMessage, HelloAck,
 *       EngineRequest, EngineResponse, EngineEvent).
 *     - The EngineEventPayload discriminant or payload shape.
 *   Additions are NOT backwards-compatible — they also bump the integer.
 *   This resolves the 1.1 contract-versioning carry-forward.
 *
 * CONTRACT HISTORY:
 *   v1 — spike: ping + getVersion only (no handshake).
 *   v2 — production: explicit session protocol; hello/helloAck handshake;
 *        full import method set; out-of-band progress/blocked/dead events.
 *   v3 — Story 2.7 (the bump rule's first real exercise): the base-currency
 *        surface joins — EngineMethod += getBaseCurrency | setBaseCurrency
 *        (decision 1, the cold-start gate's probe + persist); AND
 *        GenerateResultDTO += structuralErrors (decision 2 — the structural
 *        DATE-error channel rides the same bump: importNext's return shape
 *        changed). No compat path — exact-match handshake by design.
 *   v4 — Story 4.9a S3c (EP-4 categorization surface): the categorization wire
 *        methods join — EngineMethod += importCategorizedRows | importConditionFields
 *        | importWhy | importRulesList | rulesCreate | categoriesList |
 *        categoriesCreate. New serializable DTOs (CategoryDTO, ConditionDTO,
 *        ConditionFieldDTO, CategorizedRowDTO, CategorizedWindowDTO, WhyRuleDTO,
 *        WhyTreeDTO, RuleSummaryDTO) ride the same bump — additions bump the
 *        integer (no compat path — exact-match handshake by design).
 *   v5 — Story 4.9b (rule editing + sandbox): EngineMethod +=
 *        rulesClassify | rulesSubmitEdit | sandboxState | sandboxApply |
 *        sandboxCancel. New DTOs: EditActionDTO, SandboxStateDTO.
 *        importCategorizedRows opts gains changedOnly?.
 */

/** The current contract version. Increment per the bump rule above. */
export const CONTRACT_VERSION = 5;

// ── Handshake ─────────────────────────────────────────────────────────────────

/**
 * First message sent by the client after the worker is spawned.
 * Carries the client's expected contract version.
 * The worker replies with HelloAck carrying its own contract version.
 * ANY mismatch → ContractMismatchError; no requests are accepted.
 */
export interface HelloMessage {
  readonly kind: 'hello';
  readonly contract: number;
}

/**
 * Worker's reply to HelloMessage.
 * Carries the worker's implemented contract version.
 */
export interface HelloAck {
  readonly kind: 'helloAck';
  readonly contract: number;
}

// ── Request / Response ────────────────────────────────────────────────────────

/**
 * All method names available via the EngineClient contract.
 *
 * BUMP RULE: any addition or removal bumps CONTRACT_VERSION.
 */
export type EngineMethod =
  | 'ping'
  | 'getVersion'
  | 'decode'
  | 'importStart'
  | 'importApplyColumn'
  | 'importResetColumn'
  | 'importConfirmRecall'
  | 'importResolveCollision'
  | 'importGetRows'
  | 'importNext'
  | 'importAbort'
  | 'getBaseCurrency'
  | 'setBaseCurrency'
  // v4 (4.9a S3c): the EP-4 categorization surface.
  | 'importCategorizedRows'
  | 'importConditionFields'
  | 'importWhy'
  | 'importRulesList'
  | 'rulesCreate'
  | 'categoriesList'
  | 'categoriesCreate'
  // v5 (4.9b sandbox): rule editing + the RuleSandboxSession wire surface.
  | 'rulesClassify'
  | 'rulesSubmitEdit'
  | 'sandboxState'
  | 'sandboxApply'
  | 'sandboxCancel';

/** A client → worker RPC call. */
export interface EngineRequest {
  readonly kind: 'req';
  /** Monotonically increasing per-client counter; used to match responses. */
  readonly id: number;
  readonly method: EngineMethod;
  readonly args: unknown[];
}

/** A worker → client RPC response. */
export interface EngineResponse {
  readonly kind: 'res';
  /** Matches the id from the corresponding EngineRequest. */
  readonly id: number;
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}

// ── Out-of-band events ────────────────────────────────────────────────────────

/**
 * Worker-initiated events (no request id — out of band).
 * The client fan-fans these through EngineClient.onEvent.
 */
export interface EngineEvent {
  readonly kind: 'evt';
  readonly event: 'progress' | 'blocked' | 'dead';
  readonly payload: unknown;
}

/** Union of all wire messages. */
export type WireMessage = HelloMessage | HelloAck | EngineRequest | EngineResponse | EngineEvent;
