/**
 * Wire envelope for the EngineClient transport (contract v2).
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
 */

/** The current contract version. Increment per the bump rule above. */
export const CONTRACT_VERSION = 2;

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
  | 'importAbort';

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
