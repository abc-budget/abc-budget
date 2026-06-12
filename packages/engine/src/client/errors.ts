/**
 * Wire-error codec for the EngineClient transport (contract v2).
 *
 * Provides:
 *   serializeEngineError(err) → WireError  — serialize any Error to a plain object.
 *   rehydrateEngineError(wire) → Error     — reconstruct a typed Error from the wire.
 *
 * Typed errors (rehydrated to their exact class):
 *   ColumnTransformRejection   — 2.4 column-transform gate
 *   UnmappedColumnsError       — 2.4 Q-009 explicit stop
 *   BaseCurrencyNotSetError    — 2.3 base-currency missing
 *   ContractMismatchError      — NEW (2.6): hello/helloAck version mismatch
 *   EngineWorkerDiedError      — NEW (2.6): worker death / drain
 *   SessionAlreadyActiveError  — NEW (2.6): importStart while active
 *   SessionUnknownError        — NEW (2.6): post-respawn session not found
 *
 * Unknown errors → EngineError, preserving original name + message (HC-7).
 */

import { ColumnTransformRejection } from '../internal/importStatement/stage2/errors';
import { UnmappedColumnsError } from '../internal/importStatement/stage2/errors';
import { BaseCurrencyNotSetError } from '../internal/settings/base-currency';
import { NativeMessage, LocalizableMessage } from '../internal/utils/messages/message';
import type { Message } from '../internal/utils/messages/message';
import type { SerializedMessage } from './dto';

// ── New error classes ─────────────────────────────────────────────────────────

/**
 * Thrown when the client's CONTRACT_VERSION does not match the worker's.
 * The transport rejects all pending + future requests before any job is
 * accepted (decision 2 pin: mismatch pre-job).
 */
export class ContractMismatchError extends Error {
  /** The contract version the client expects. */
  readonly ours: number;
  /** The contract version the worker implements. */
  readonly theirs: number;

  constructor(ours: number, theirs: number) {
    super(
      `[abc-engine] Contract mismatch: client expects v${ours}, worker implements v${theirs}. ` +
        'Reload the app to get a matching version pair.',
    );
    this.name = 'ContractMismatchError';
    this.ours = ours;
    this.theirs = theirs;
    Object.setPrototypeOf(this, ContractMismatchError.prototype);
  }
}

/**
 * Thrown (client-side) when the worker dies unexpectedly or is terminated.
 * Every pending request rejects with this error — no hung promises.
 */
export class EngineWorkerDiedError extends Error {
  /** Number of in-flight requests that were cancelled by the death. */
  readonly jobsLost: number;

  constructor(jobsLost: number) {
    super(
      `[abc-engine] Worker died. ${jobsLost} in-flight job(s) lost. ` +
        'The worker will be respawned; start a new session.',
    );
    this.name = 'EngineWorkerDiedError';
    this.jobsLost = jobsLost;
    Object.setPrototypeOf(this, EngineWorkerDiedError.prototype);
  }
}

/**
 * Thrown by importStart when another session is already active.
 * The caller must call importAbort(existingSessionId) first.
 * PIN (decision-1 semantics): one active session at a time.
 */
export class SessionAlreadyActiveError extends Error {
  /** The session id that is currently active. */
  readonly activeSessionId: string;

  constructor(activeSessionId: string) {
    super(
      `[abc-engine] Session '${activeSessionId}' is already active. ` +
        'Call importAbort first.',
    );
    this.name = 'SessionAlreadyActiveError';
    this.activeSessionId = activeSessionId;
    Object.setPrototypeOf(this, SessionAlreadyActiveError.prototype);
  }
}

/**
 * Thrown when a session method is called for a sessionId that does not exist
 * in the worker registry.  This happens after a worker respawn: the old session
 * graph is gone and cannot be resurrected — the caller must use importStart.
 */
export class SessionUnknownError extends Error {
  /** The session id that was not found. */
  readonly sessionId: string;

  constructor(sessionId: string) {
    super(
      `[abc-engine] Session '${sessionId}' is unknown. ` +
        'After a worker respawn, use importStart to begin a new session.',
    );
    this.name = 'SessionUnknownError';
    this.sessionId = sessionId;
    Object.setPrototypeOf(this, SessionUnknownError.prototype);
  }
}

/**
 * Fallback error class for unknown/unrecognized wire errors (HC-7).
 * Preserves the original error name so callers can still discriminate by name
 * string even when the class is not known on this side of the wire.
 */
export class EngineError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
    Object.setPrototypeOf(this, EngineError.prototype);
  }
}

// ── Wire shape ────────────────────────────────────────────────────────────────

/** Serialized error as it travels over the wire. */
export interface WireError {
  readonly name: string;
  readonly message: string;
  readonly payload: unknown;
}

// ── Payloads ──────────────────────────────────────────────────────────────────

interface ColumnRejectionPayload {
  errorCount: number;
  totalCount: number;
  threshold: number;
  cellErrors: Array<{ rowIndex: number; message: SerializedMessage }>;
}

interface UnmappedPayload {
  unmappedColumns: Array<{ id: string; name: string }>;
}

interface ContractMismatchPayload {
  ours: number;
  theirs: number;
}

interface WorkerDiedPayload {
  jobsLost: number;
}

interface SessionAlreadyActivePayload {
  activeSessionId: string;
}

interface SessionUnknownPayload {
  sessionId: string;
}

// ── serializeEngineError ──────────────────────────────────────────────────────

/**
 * Serialize any Error to a plain wire object.
 * Typed errors carry a structured payload; unknown errors carry null payload.
 */
export function serializeEngineError(err: unknown): WireError {
  if (err instanceof ColumnTransformRejection) {
    const payload: ColumnRejectionPayload = {
      errorCount: err.errorCount,
      totalCount: err.totalCount,
      threshold: err.threshold,
      cellErrors: err.cellErrors.map((ce) => ({
        rowIndex: ce.rowIndex,
        message: ce.error.isLocalizable()
          ? { key: ce.error.getText(), params: (ce.error as LocalizableMessage).getParams() }
          : { text: ce.error.getText() },
      })),
    };
    return { name: 'ColumnTransformRejection', message: (err as Error).message, payload };
  }

  if (err instanceof UnmappedColumnsError) {
    const payload: UnmappedPayload = {
      unmappedColumns: err.unmappedColumns.map((c) => ({ id: c.id, name: c.name })),
    };
    return { name: 'UnmappedColumnsError', message: (err as Error).message, payload };
  }

  if (err instanceof BaseCurrencyNotSetError) {
    return { name: 'BaseCurrencyNotSetError', message: err.message, payload: null };
  }

  if (err instanceof ContractMismatchError) {
    const payload: ContractMismatchPayload = { ours: err.ours, theirs: err.theirs };
    return { name: 'ContractMismatchError', message: err.message, payload };
  }

  if (err instanceof EngineWorkerDiedError) {
    const payload: WorkerDiedPayload = { jobsLost: err.jobsLost };
    return { name: 'EngineWorkerDiedError', message: err.message, payload };
  }

  if (err instanceof SessionAlreadyActiveError) {
    const payload: SessionAlreadyActivePayload = { activeSessionId: err.activeSessionId };
    return { name: 'SessionAlreadyActiveError', message: err.message, payload };
  }

  if (err instanceof SessionUnknownError) {
    const payload: SessionUnknownPayload = { sessionId: err.sessionId };
    return { name: 'SessionUnknownError', message: err.message, payload };
  }

  // Unknown error — preserve name + message (HC-7)
  const e = err as { name?: string; message?: string };
  return {
    name: e?.name ?? 'Error',
    message: e?.message ?? String(err),
    payload: null,
  };
}

// ── rehydrateEngineError ──────────────────────────────────────────────────────

/**
 * Reconstruct a typed Error from a wire payload.
 * Returns the exact class when the name is recognized; otherwise returns
 * EngineError with the original name preserved (HC-7).
 */
export function rehydrateEngineError(wire: WireError): Error {
  switch (wire.name) {
    case 'ColumnTransformRejection': {
      const p = wire.payload as ColumnRejectionPayload;
      const cellErrors = (p?.cellErrors ?? []).map((ce) => ({
        rowIndex: ce.rowIndex,
        error: rehydrateMessage(ce.message),
      }));
      return new ColumnTransformRejection(
        p?.errorCount ?? 0,
        p?.totalCount ?? 0,
        p?.threshold ?? 0,
        cellErrors,
        'engine.importStatement.column-parse-error',
      );
    }

    case 'UnmappedColumnsError': {
      const p = wire.payload as UnmappedPayload;
      return new UnmappedColumnsError(p?.unmappedColumns ?? []);
    }

    case 'BaseCurrencyNotSetError': {
      return new BaseCurrencyNotSetError();
    }

    case 'ContractMismatchError': {
      const p = wire.payload as ContractMismatchPayload;
      return new ContractMismatchError(p?.ours ?? 0, p?.theirs ?? 0);
    }

    case 'EngineWorkerDiedError': {
      const p = wire.payload as WorkerDiedPayload;
      return new EngineWorkerDiedError(p?.jobsLost ?? 0);
    }

    case 'SessionAlreadyActiveError': {
      const p = wire.payload as SessionAlreadyActivePayload;
      return new SessionAlreadyActiveError(p?.activeSessionId ?? '');
    }

    case 'SessionUnknownError': {
      const p = wire.payload as SessionUnknownPayload;
      return new SessionUnknownError(p?.sessionId ?? '');
    }

    default:
      // HC-7: unknown error — preserve original name, never mangle
      return new EngineError(wire.name ?? 'Error', wire.message ?? '');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reconstruct a Message from its serialized form (used for cellErrors). */
function rehydrateMessage(sm: SerializedMessage): Message {
  if ('text' in sm) {
    return new NativeMessage(sm.text);
  }
  return new LocalizableMessage(sm.key, sm.params);
}
