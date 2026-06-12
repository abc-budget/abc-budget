/**
 * Production WorkerTransport (Task 3, contract v2).
 *
 * Creates an EngineClient backed by a Web Worker over postMessage.
 * Implements: handshake gate, drain semantics, per-request timeouts with
 * progress-liveness, lazy respawn-on-death, out-of-band event fan-out,
 * and structured wire-error rehydration.
 *
 * ── Design choices ────────────────────────────────────────────────────────────
 *
 * RESPAWN: LAZY (on next call, not automatic on death).
 *   Rationale: automatic re-spawn would silently discard the death signal and
 *   immediately start a new handshake — callers that queued requests would get
 *   EngineWorkerDiedError anyway (pending map is drained on death), so the respawn
 *   is wasted work if no further call ever arrives. Lazy respawn means we fire
 *   the 'dead' event once, drain every pending request, and WAIT.  The next call
 *   re-invokes workerFactory ONCE, sets up a new worker, and sends a fresh hello.
 *   This keeps the re-spawn logic simple, predictable, and testable.
 *
 * HANDSHAKE TIMEOUT: rejects with EngineWorkerDiedError (phase: 'handshake').
 *   Rationale: distinguishes a "worker never replied" scenario from a contract
 *   mismatch.  The message includes the word "handshake" so callers / tests can
 *   identify the path (see WorkerTransport spec §TIMEOUTS).
 *
 * CLOCK SEAM: injectable (opts.clock) for deterministic tests; defaults to
 *   real {setTimeout, clearTimeout} in production.  No Date.now anywhere.
 *
 * ── Wire protocol ─────────────────────────────────────────────────────────────
 *
 *   Client → Worker: HelloMessage (kind:'hello') then EngineRequest (kind:'req')
 *   Worker → Client: HelloAck (kind:'helloAck') then EngineResponse (kind:'res')
 *                    or EngineEvent (kind:'evt') out-of-band
 */

import type {
  EngineClient,
  EngineVersion,
  EngineEventPayload,
  ImportStartResult,
  ApplyColumnResult,
  ImportNextResult,
} from './engine-client';
import type {
  HelloMessage,
  HelloAck,
  EngineRequest,
  EngineResponse,
  EngineEvent,
  WireMessage,
} from './protocol';
import { CONTRACT_VERSION } from './protocol';
import {
  ContractMismatchError,
  EngineWorkerDiedError,
  rehydrateEngineError,
} from './errors';
import type { WireError } from './errors';
import type { Stage2SnapshotDTO, RowWindowDTO } from './dto';
import type { DecodeResult } from '../internal/ingest/types';

// ── WorkerLike ─────────────────────────────────────────────────────────────────

/**
 * Structural type satisfied by both the real DOM Worker and the fake test double.
 * Keeps the transport decoupled from the DOM typings and fully testable in Node.
 */
export interface WorkerLike {
  postMessage(data: unknown): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

// ── ClockSeam ──────────────────────────────────────────────────────────────────

/**
 * Injectable timer abstraction.
 * Production: real {setTimeout, clearTimeout}.
 * Tests: a ManualClock that can be ticked deterministically.
 */
export interface ClockSeam {
  setTimeout(cb: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(id: ReturnType<typeof setTimeout>): void;
}

const realClock: ClockSeam = {
  setTimeout: (cb, ms) => setTimeout(cb, ms),
  clearTimeout: (id) => clearTimeout(id),
};

// ── Options ────────────────────────────────────────────────────────────────────

export interface WorkerClientOptions {
  /**
   * Milliseconds to wait for the HelloAck handshake response.
   * Default: 5000 (5 seconds).
   */
  handshakeTimeoutMs?: number;

  /**
   * Milliseconds before an unanswered RPC request is rejected.
   * A progress event carrying the request's jobId resets this window.
   * Default: 30000 (30 seconds).
   */
  requestTimeoutMs?: number;

  /**
   * Injectable timer seam for deterministic tests.
   * Default: real setTimeout/clearTimeout.
   */
  clock?: ClockSeam;
}

// ── Pending map entry ─────────────────────────────────────────────────────────

type TimerHandle = ReturnType<typeof setTimeout>;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  /** Timer handle for this request's per-request timeout. null for handshake-queued requests. */
  timer: TimerHandle | null;
  /** Job id string (= String(requestId)); used for progress liveness reset. */
  jobId: string;
}

// ── TransportState ─────────────────────────────────────────────────────────────

type TransportState =
  | { phase: 'handshaking' }
  | { phase: 'ready' }
  | { phase: 'dead' }
  | { phase: 'mismatch'; ours: number; theirs: number };

// ── Factory ────────────────────────────────────────────────────────────────────

/**
 * Create an EngineClient backed by a Worker.
 *
 * @param workerFactory  Called once at creation and once per respawn. Must return
 *                       a WorkerLike (real Worker or test double).
 * @param opts           Optional tuning: timeouts and clock seam.
 */
export function createWorkerEngineClient(
  workerFactory: () => WorkerLike,
  opts?: WorkerClientOptions,
): EngineClient {
  const handshakeTimeoutMs = opts?.handshakeTimeoutMs ?? 5000;
  const requestTimeoutMs = opts?.requestTimeoutMs ?? 30000;
  const clock: ClockSeam = opts?.clock ?? realClock;

  // ── State ──────────────────────────────────────────────────────────────────

  let nextId = 1;
  /** Requests that are in-flight (post-ack, waiting for a response). */
  const pending = new Map<number, Pending>();
  /** Requests queued before the handshake is complete. */
  let helloQueue: Array<{ id: number; request: EngineRequest; resolve: (v: unknown) => void; reject: (r: unknown) => void }> = [];
  let state: TransportState = { phase: 'handshaking' };
  let worker: WorkerLike;
  let handshakeTimer: TimerHandle | null = null;

  // ── Event listeners ────────────────────────────────────────────────────────

  const listeners = new Set<(event: EngineEventPayload) => void>();

  function emitEvent(event: EngineEventPayload): void {
    for (const cb of listeners) {
      try { cb(event); } catch { /* listener errors are non-fatal */ }
    }
  }

  // ── Drain ──────────────────────────────────────────────────────────────────

  /**
   * Reject every pending + queued request with EngineWorkerDiedError.
   * Clears all state. Called on onerror, handshake timeout, or terminate.
   */
  function drain(reason: Error): void {
    // Cancel handshake timer
    if (handshakeTimer !== null) {
      clock.clearTimeout(handshakeTimer);
      handshakeTimer = null;
    }

    // Drain pending (in-flight) map
    const pendingEntries = Array.from(pending.values());
    pending.clear();
    for (const entry of pendingEntries) {
      if (entry.timer !== null) clock.clearTimeout(entry.timer);
      entry.reject(reason);
    }

    // Drain hello queue
    const queued = helloQueue;
    helloQueue = [];
    for (const entry of queued) {
      entry.reject(reason);
    }
  }

  /**
   * Mark as dead, drain, emit 'dead' event.
   * @param jobsLost  The count passed to EngineWorkerDiedError.
   * @param message   Optional message override (for handshake timeout).
   */
  function die(jobsLost: number, message?: string): void {
    state = { phase: 'dead' };
    const err = message
      ? Object.assign(new EngineWorkerDiedError(jobsLost), { message })
      : new EngineWorkerDiedError(jobsLost);
    drain(err);
    emitEvent({ event: 'dead' });
  }

  // ── Worker wiring ──────────────────────────────────────────────────────────

  function wireWorker(w: WorkerLike): void {
    worker = w;
    state = { phase: 'handshaking' };

    w.onmessage = (ev: { data: unknown }) => handleMessage(ev.data as WireMessage);
    w.onerror = () => {
      const jobsLost = pending.size + helloQueue.length;
      die(jobsLost);
    };

    // Send hello — the first message
    const hello: HelloMessage = { kind: 'hello', contract: CONTRACT_VERSION };
    w.postMessage(hello);

    // Start handshake timeout
    handshakeTimer = clock.setTimeout(() => {
      const jobsLost = helloQueue.length;
      // Drain with a handshake-specific message
      state = { phase: 'dead' };
      const err = new EngineWorkerDiedError(jobsLost);
      // Override message to include 'handshake' word for test identification
      Object.defineProperty(err, 'message', {
        value: `[abc-engine] Worker handshake timed out after ${handshakeTimeoutMs}ms. ${jobsLost} queued job(s) lost.`,
        writable: false,
      });
      handshakeTimer = null;
      drain(err);
      emitEvent({ event: 'dead' });
    }, handshakeTimeoutMs);
  }

  // ── Respawn ────────────────────────────────────────────────────────────────

  /**
   * Spawn a fresh worker and reset transport state.
   * Called lazily on the next RPC call after death.
   */
  function respawn(): void {
    const freshWorker = workerFactory();
    helloQueue = [];
    nextId = nextId; // keep monotone id counter across respawns
    wireWorker(freshWorker);
  }

  // ── Message handler ────────────────────────────────────────────────────────

  function handleMessage(msg: WireMessage): void {
    if (msg.kind === 'helloAck') {
      const ack = msg as HelloAck;
      // Cancel the handshake timeout
      if (handshakeTimer !== null) {
        clock.clearTimeout(handshakeTimer);
        handshakeTimer = null;
      }

      if (ack.contract !== CONTRACT_VERSION) {
        // Contract mismatch — reject all queued + mark state
        state = { phase: 'mismatch', ours: CONTRACT_VERSION, theirs: ack.contract };
        const err = new ContractMismatchError(CONTRACT_VERSION, ack.contract);
        const queued = helloQueue;
        helloQueue = [];
        for (const entry of queued) {
          entry.reject(err);
        }
        return;
      }

      // Handshake successful — flush the hello queue
      state = { phase: 'ready' };
      const queued = helloQueue;
      helloQueue = [];
      for (const entry of queued) {
        // Send the request over the wire now
        worker.postMessage(entry.request);
        // Register in pending map with a per-request timeout
        const timer = clock.setTimeout(() => {
          const p = pending.get(entry.id);
          if (p) {
            pending.delete(entry.id);
            p.reject(new EngineWorkerDiedError(1));
          }
        }, requestTimeoutMs);
        pending.set(entry.id, {
          resolve: entry.resolve,
          reject: entry.reject,
          timer,
          jobId: String(entry.id),
        });
      }
      return;
    }

    if (msg.kind === 'res') {
      const resp = msg as EngineResponse;
      const entry = pending.get(resp.id);
      if (!entry) return;
      pending.delete(resp.id);
      if (entry.timer !== null) clock.clearTimeout(entry.timer);
      if (resp.ok) {
        entry.resolve(resp.value);
      } else {
        // Rehydrate wire error to typed instance
        const err = resp.error != null
          ? rehydrateEngineError(resp.error as WireError)
          : new Error('engine worker error (no error payload)');
        entry.reject(err);
      }
      return;
    }

    if (msg.kind === 'evt') {
      const evt = msg as EngineEvent;
      const payload = evt.payload as Record<string, unknown> | null;

      // Progress liveness: if this event carries a jobId that matches a pending
      // request, reset that request's timeout window.
      if (evt.event === 'progress' && payload && typeof payload.jobId === 'string') {
        const jobId = payload.jobId;
        // Find the pending entry by jobId string
        for (const [id, entry] of pending) {
          if (entry.jobId === jobId) {
            // Reset timer
            if (entry.timer !== null) clock.clearTimeout(entry.timer);
            const newTimer = clock.setTimeout(() => {
              const p = pending.get(id);
              if (p) {
                pending.delete(id);
                p.reject(new EngineWorkerDiedError(1));
              }
            }, requestTimeoutMs);
            // Update the timer on the entry (map entry is mutable)
            (entry as { timer: TimerHandle | null }).timer = newTimer;
            break;
          }
        }
      }

      // Fan out to all event listeners
      // Build a typed EngineEventPayload from the wire event
      let typedPayload: EngineEventPayload;
      if (evt.event === 'progress' && payload) {
        typedPayload = {
          event: 'progress',
          jobId: (payload.jobId as string) ?? '',
          phase: (payload.phase as string) ?? '',
          done: (payload.done as number) ?? 0,
          total: (payload.total as number) ?? 0,
        };
      } else if (evt.event === 'blocked') {
        typedPayload = { event: 'blocked' };
      } else if (evt.event === 'dead') {
        typedPayload = { event: 'dead' };
      } else {
        // Unknown event kind — skip fan-out
        return;
      }
      emitEvent(typedPayload);
      return;
    }
  }

  // ── Generic call ──────────────────────────────────────────────────────────

  function call(method: string, args: unknown[]): Promise<unknown> {
    // If currently dead → trigger lazy respawn
    if (state.phase === 'dead') {
      respawn();
    }

    // If mismatched → reject immediately
    if (state.phase === 'mismatch') {
      const ms = state as { phase: 'mismatch'; ours: number; theirs: number };
      return Promise.reject(new ContractMismatchError(ms.ours, ms.theirs));
    }

    const id = nextId++;
    const request: EngineRequest = { kind: 'req', id, method: method as import('./protocol').EngineMethod, args };

    if (state.phase === 'handshaking') {
      // Queue until handshake completes
      return new Promise<unknown>((resolve, reject) => {
        helloQueue.push({ id, request, resolve, reject });
      });
    }

    // Ready — send immediately, register in pending map
    return new Promise<unknown>((resolve, reject) => {
      worker.postMessage(request);
      const timer = clock.setTimeout(() => {
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          p.reject(new EngineWorkerDiedError(1));
        }
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer, jobId: String(id) });
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────

  // Spawn the first worker immediately
  wireWorker(workerFactory());

  // ── EngineClient facade ────────────────────────────────────────────────────

  return {
    ping: (message: string) => call('ping', [message]) as Promise<string>,

    getVersion: () => call('getVersion', []) as Promise<EngineVersion>,

    decode: (bytes: ArrayBuffer, fileName: string) =>
      call('decode', [bytes, fileName]) as Promise<DecodeResult>,

    importStart: (rows: Record<string, unknown>[]) =>
      call('importStart', [rows]) as Promise<ImportStartResult>,

    importApplyColumn: (
      sessionId: string,
      columnId: string,
      definition: string,
      params: Record<string, unknown> | null,
    ) => call('importApplyColumn', [sessionId, columnId, definition, params]) as Promise<ApplyColumnResult>,

    importResetColumn: (sessionId: string, columnId: string) =>
      call('importResetColumn', [sessionId, columnId]) as Promise<Stage2SnapshotDTO>,

    importConfirmRecall: (sessionId: string, columnId: string) =>
      call('importConfirmRecall', [sessionId, columnId]) as Promise<void>,

    importResolveCollision: (sessionId: string, confirm: boolean) =>
      call('importResolveCollision', [sessionId, confirm]) as Promise<void>,

    importGetRows: (sessionId: string, offset: number, count: number) =>
      call('importGetRows', [sessionId, offset, count]) as Promise<RowWindowDTO>,

    importNext: (sessionId: string) =>
      call('importNext', [sessionId]) as Promise<ImportNextResult>,

    importAbort: (sessionId: string) =>
      call('importAbort', [sessionId]) as Promise<void>,

    onEvent(cb: (event: EngineEventPayload) => void): () => void {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}
