import { describe, expect, it } from 'vitest';
import { createDirectEngineClient } from './direct-client';

describe('EngineClient contract (direct transport)', () => {
  it('ping echoes the message', async () => {
    const client = createDirectEngineClient();
    expect(await client.ping('hello')).toBe('hello');
  });

  it('getVersion returns engine + contract', async () => {
    const client = createDirectEngineClient();
    const version = await client.getVersion();
    expect(typeof version.engine).toBe('string');
    expect(version.contract).toBe(2);
  });
});
