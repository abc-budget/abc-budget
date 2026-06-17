/**
 * Engine worker host (Story 2.6, Task 4 — the worker side of the thread hop).
 *
 * `attachEngineHost(scope)` wires the contract-v4 message loop onto a worker
 * global scope:
 *
 *   - handshake: `hello {contract}` → `helloAck {contract: CONTRACT_VERSION}`
 *     (decision 2 — the client enforces exact-match; the host just reports its
 *     own version, so a mismatched pair surfaces client-side PRE-JOB).
 *   - requests: `req {id, method, args}` → dispatch over the EngineClient
 *     surface → `res {id, ok, value | error}`.  Errors cross the wire via
 *     `serializeEngineError` (HC-7 — names never mangled) and rehydrate
 *     client-side in the transport.
 *   - events: out-of-band `evt {event, payload}` — `progress` (HC-10 honest
 *     counts from decode/importNext; the jobId is REWRITTEN to the in-flight
 *     request id so the transport's progress-liveness window resets), and
 *     `blocked` (engine-DB onblocked → the loud multi-tab state, decision 1).
 *
 * DRY: the host is a wire shim over `createDirectEngineClient()` — the direct
 * client and the worker host run the IDENTICAL session logic and the IDENTICAL
 * composed object graph (composition-root.ts).  Transport differs; logic is
 * shared.
 *
 * Requests are processed SEQUENTIALLY (a promise chain): the import wizard is a
 * single flow, and serialization makes the progress→request attribution exact
 * (one in-flight job at a time owns the jobId).
 */

import type { EngineMethod, WireMessage, EngineEvent, EngineResponse, HelloAck } from '../../client/protocol';
import { CONTRACT_VERSION } from '../../client/protocol';
import { serializeEngineError } from '../../client/errors';
import { createDirectEngineClient } from '../../client/direct-client';
import type { EngineClient } from '../../client/engine-client';
import { onEngineDbBlocked } from '../persistence/engine-db';

// ── WorkerScopeLike ───────────────────────────────────────────────────────────

/**
 * Structural type satisfied by the real DedicatedWorkerGlobalScope (and by the
 * @vitest/web-worker shim).  Typed locally so the package compiles under the
 * DOM lib without pulling in the WebWorker lib.
 */
export interface WorkerScopeLike {
  postMessage(data: unknown): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

// ── Method allowlist ──────────────────────────────────────────────────────────

/** The exact contract-v5 method set — anything else is rejected loudly. */
const ENGINE_METHODS: ReadonlySet<EngineMethod> = new Set<EngineMethod>([
  'ping',
  'getVersion',
  'decode',
  'importStart',
  'importApplyColumn',
  'importResetColumn',
  'importConfirmRecall',
  'importResolveCollision',
  'importGetRows',
  'importNext',
  'importAbort',
  // v3 (2.7 decision 1): the base-currency surface — implemented by the direct
  // client this host shims over; settingsDao comes from the shared composition root.
  'getBaseCurrency',
  'setBaseCurrency',
  // v4 (4.9a S3c): the EP-4 categorization surface — same generic dispatch over
  // the direct client (the host calls client[method].apply); the impls land in
  // sibling Task 2.
  'importCategorizedRows',
  'importConditionFields',
  'importWhy',
  'importRulesList',
  'rulesCreate',
  'categoriesList',
  'categoriesCreate',
  // v5 (4.9b sandbox): rule editing + the RuleSandboxSession wire surface.
  'rulesClassify',
  'rulesSubmitEdit',
  'sandboxState',
  'sandboxApply',
  'sandboxCancel',
]);

// ── attachEngineHost ──────────────────────────────────────────────────────────

/**
 * Attach the engine host message loop to a worker scope.
 *
 * Composition happens lazily inside createDirectEngineClient (composeEngine —
 * no-throw where indexedDB is absent), so attaching never throws.
 */
export function attachEngineHost(scope: WorkerScopeLike): void {
  const client: EngineClient = createDirectEngineClient();

  // The request id currently being processed — progress events emitted during
  // its execution carry this id so the transport's liveness window resets.
  let currentJobId: string | null = null;

  // ── Out-of-band event forwarding ──────────────────────────────────────────

  client.onEvent((evt) => {
    const payload =
      evt.event === 'progress' && currentJobId !== null
        ? { ...evt, jobId: currentJobId }
        : evt;
    const wire: EngineEvent = { kind: 'evt', event: evt.event, payload };
    scope.postMessage(wire);
  });

  // Engine-DB blocked (decision 1 — loud multi-tab state, never a hang).
  onEngineDbBlocked(() => {
    const wire: EngineEvent = { kind: 'evt', event: 'blocked', payload: { event: 'blocked' } };
    scope.postMessage(wire);
  });

  // ── Sequential request processing ─────────────────────────────────────────

  let queue: Promise<void> = Promise.resolve();

  async function processRequest(id: number, method: string, args: unknown[]): Promise<void> {
    currentJobId = String(id);
    try {
      if (!ENGINE_METHODS.has(method as EngineMethod)) {
        throw new Error(`[abc-engine] Unknown engine method: '${method}' (contract v${CONTRACT_VERSION})`);
      }
      const fn = (client as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
      const value = await fn.apply(client, args);
      const res: EngineResponse = { kind: 'res', id, ok: true, value };
      scope.postMessage(res);
    } catch (err) {
      const res: EngineResponse = { kind: 'res', id, ok: false, error: serializeEngineError(err) };
      scope.postMessage(res);
    } finally {
      currentJobId = null;
    }
  }

  // ── Message loop ──────────────────────────────────────────────────────────

  scope.onmessage = (ev: { data: unknown }) => {
    const msg = ev.data as WireMessage;

    if (msg && msg.kind === 'hello') {
      // Decision 2: reply with OUR contract version; the client rejects on any
      // mismatch before a single request crosses (pre-job pin, 1-RTT).
      const ack: HelloAck = { kind: 'helloAck', contract: CONTRACT_VERSION };
      scope.postMessage(ack);
      return;
    }

    if (msg && msg.kind === 'req') {
      const { id, method, args } = msg;
      // Chain — one request at a time; rejections are handled inside.
      queue = queue.then(() => processRequest(id, method, args));
      return;
    }

    // Anything else (responses/events/acks echoed back) is ignored — the host
    // only consumes hello + req.
  };
}
