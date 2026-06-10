import type { EngineClient, EngineVersion } from './engine-client';
import type { EngineMethod, EngineRequest, EngineResponse } from './protocol';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Builds an EngineClient backed by a Worker over postMessage. Spike/test only — not
 * exported from the package barrel. Proves the EngineClient contract is identical whether
 * the engine runs in-thread or in a worker (NFR-003 relocation seam).
 */
export function createWorkerEngineClient(worker: Worker): EngineClient {
  let nextId = 1;
  const pending = new Map<number, Pending>();

  worker.onmessage = (event: MessageEvent<EngineResponse>) => {
    const { id, ok, value, error } = event.data;
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (ok) entry.resolve(value);
    else entry.reject(new Error(error ?? 'engine worker error'));
  };

  const call = (method: EngineMethod, args: unknown[]): Promise<unknown> => {
    const id = nextId++;
    const request: EngineRequest = { id, method, args };
    return new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage(request);
    });
  };

  return {
    ping: (message) => call('ping', [message]) as Promise<string>,
    getVersion: () => call('getVersion', []) as Promise<EngineVersion>,
  };
}
