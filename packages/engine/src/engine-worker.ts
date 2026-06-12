/**
 * Engine worker ENTRY (Story 2.6, Task 4).
 *
 * This is the module the production Worker is spawned from:
 *
 *   new Worker(new URL('./engine-worker.ts', import.meta.url), { type: 'module' })
 *
 * Vite bundles it as a worker entry chunk (the lazy luxon/xlsx imports stay
 * lazy inside the worker graph — the 2.2 build discipline, proven in Task 5).
 *
 * Task 5 exports this via the package exports map; until then it is internal
 * (the real-hop spec and the app wiring point are its only consumers).
 */

import { attachEngineHost } from './internal/worker/engine-worker-host';
import type { WorkerScopeLike } from './internal/worker/engine-worker-host';

// In a worker, `self` IS the DedicatedWorkerGlobalScope.  Typed structurally so
// the package compiles under the DOM lib without the WebWorker lib.
attachEngineHost(self as unknown as WorkerScopeLike);
