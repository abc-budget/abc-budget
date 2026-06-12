import type { EngineRequest, EngineResponse } from '../client/protocol';
import { createPingEngine } from './ping-engine';

// In a worker, `self` is the worker global scope. We type only what we use, so the
// package can compile under the DOM lib without pulling in the WebWorker lib.
const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<EngineRequest>) => void) | null;
  postMessage: (data: EngineResponse) => void;
};

const engine = createPingEngine();

ctx.onmessage = async (event) => {
  const { id, method, args } = event.data;
  try {
    const fn = engine[method as keyof typeof engine] as (...a: unknown[]) => Promise<unknown>;
    const value = await fn(...args);
    ctx.postMessage({ kind: 'res', id, ok: true, value });
  } catch (error) {
    ctx.postMessage({ kind: 'res', id, ok: false, error: String(error) });
  }
};
