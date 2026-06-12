/**
 * Engine worker ENTRY (Story 2.6, Task 4).
 *
 * This is the module the production Worker is spawned from. It is PUBLIC via
 * the package exports map as `@abc-budget/engine/worker`; the app spawns it
 * with the standard Worker-URL shape (see apps/web/src/engine.ts) — Vite
 * resolves the bare specifier through this package's exports map:
 *
 *   new Worker(new URL('@abc-budget/engine/worker', import.meta.url), { type: 'module' })
 *
 * Vite bundles it as a worker entry chunk (the lazy luxon/xlsx imports stay
 * lazy inside the worker graph — the 2.2 build discipline, proven by
 * apps/web/build-checks/verify-build.mjs).
 */

import { attachEngineHost } from './internal/worker/engine-worker-host';
import type { WorkerScopeLike } from './internal/worker/engine-worker-host';

// In a worker, `self` IS the DedicatedWorkerGlobalScope.  Typed structurally so
// the package compiles under the DOM lib without the WebWorker lib.
attachEngineHost(self as unknown as WorkerScopeLike);
