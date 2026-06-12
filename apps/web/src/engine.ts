/**
 * THE engine wiring point (NFR-003 seam — the 1.1 promise pays off here).
 *
 * Story 2.6 (decision 4: always-worker, zero-threshold): the production
 * EngineClient is worker-backed.  The Worker is spawned ONCE at module init
 * (spawn-once pin — ~50–150ms amortized into startup); the transport handles
 * respawn-on-death by re-invoking the factory (lazy, on the next call).
 *
 * Worker entry resolution: the bare specifier `@abc-budget/engine/worker`
 * inside `new Worker(new URL(..., import.meta.url))` resolves through the
 * engine's exports map — verified in BOTH modes: the production build emits a
 * separate `engine-worker-*.js` chunk (URL rewritten to /assets/...), and the
 * dev server rewrites to the /@fs/ source path. (The `?worker` suffix import
 * also works; the URL form is kept — standard Worker syntax, no virtual module.)
 *
 * Contract mismatch (decision 2): the handshake failure path surfaces as a
 * promise REJECTION (ContractMismatchError), not an onEvent — `engineReady`
 * is the dedicated readiness probe that converts it into a plain status object
 * for the chrome (EngineStatusBanner wires it to the SW update mechanism).
 *
 * Carry-forward: the app-side HTTP rates api (createHttpRatesApi) cannot cross
 * the wire as a function — remote-rates injection into the worker composition
 * root is re-surfaced with the EP-3 rates UX (the worker composes IDB-cached
 * rates without a remote fallback until then).
 */
import { createWorkerEngineClient, type EngineClient, type WorkerLike } from '@abc-budget/engine';

/** Worker factory — invoked once at module init and once per respawn-on-death.
 *  The DOM Worker satisfies WorkerLike structurally at runtime; the cast bridges
 *  the onmessage parameter variance (MessageEvent vs the minimal {data}). */
function spawnEngineWorker(): WorkerLike {
  return new Worker(new URL('@abc-budget/engine/worker', import.meta.url), {
    type: 'module',
  }) as unknown as WorkerLike;
}

/** The app's EngineClient — ALWAYS worker-backed in production (NFR-007). */
export const engine: EngineClient = createWorkerEngineClient(spawnEngineWorker);

// ── Readiness / contract-mismatch surface ─────────────────────────────────────

/** Boot status of the worker handshake — consumed by EngineStatusBanner. */
export type EngineBootStatus =
  | { readonly state: 'ready' }
  | { readonly state: 'contract-mismatch'; readonly error: Error }
  | { readonly state: 'failed'; readonly error: Error };

/**
 * Dedicated readiness probe: one ping right after spawn.
 * - resolves 'ready' on a matched handshake;
 * - resolves 'contract-mismatch' when the hello/helloAck pair disagrees
 *   (pre-job pin — the rejection arrives before any real work is accepted);
 * - resolves 'failed' on any other boot error (e.g. handshake timeout — the
 *   'dead' onEvent carries that state to the banner as worker-died).
 * NEVER rejects (no unhandled rejection at module init).
 */
export const engineReady: Promise<EngineBootStatus> = engine.ping('boot').then(
  (): EngineBootStatus => ({ state: 'ready' }),
  (err: unknown): EngineBootStatus =>
    (err as Error)?.name === 'ContractMismatchError'
      ? { state: 'contract-mismatch', error: err as Error }
      : { state: 'failed', error: err as Error },
);
