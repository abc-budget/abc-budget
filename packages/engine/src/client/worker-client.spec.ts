import '@vitest/web-worker';
import { describe, expect, it } from 'vitest';
import { createWorkerEngineClient } from './worker-client';

describe('worker transport seam (zero-UI-change proof)', () => {
  it('ping survives a real thread hop with serializable args/returns', async () => {
    const worker = new Worker(new URL('../internal/engine.worker.ts', import.meta.url), {
      type: 'module',
    });
    const client = createWorkerEngineClient(worker);

    expect(await client.ping('hello')).toBe('hello');
    const version = await client.getVersion();
    expect(version.contract).toBe(2);

    worker.terminate();
  });
});
