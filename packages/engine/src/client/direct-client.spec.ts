import { describe, expect, it } from 'vitest';
import { createDirectEngineClient } from './direct-client';
import { InvalidBaseCurrencyError } from '../internal/settings/base-currency';

describe('EngineClient contract (direct transport)', () => {
  it('ping echoes the message', async () => {
    const client = createDirectEngineClient();
    expect(await client.ping('hello')).toBe('hello');
  });

  it('getVersion returns engine + contract', async () => {
    const client = createDirectEngineClient();
    const version = await client.getVersion();
    expect(typeof version.engine).toBe('string');
    // DECLARED UPDATE (4.9c): contract 5 → 6 (Auto-Other remainder + typicality wire)
    expect(version.contract).toBe(6);
  });
});

// This spec file runs WITHOUT fake-indexeddb — the composition root composes with
// settingsDao === null. These tests pin the no-DB semantics of the v3 methods.
describe('base-currency surface — no-indexedDB semantics (decision 1)', () => {
  it('getBaseCurrency returns null when persistence is unavailable (probe never throws)', async () => {
    const client = createDirectEngineClient();
    await expect(client.getBaseCurrency()).resolves.toBeNull();
  });

  it('setBaseCurrency throws LOUD when persistence is unavailable (valid ISO)', async () => {
    const client = createDirectEngineClient();
    await expect(client.setBaseCurrency('USD')).rejects.toThrow(/persistence/i);
  });

  it('setBaseCurrency validates the ISO code FIRST (pure reference — no DB needed)', async () => {
    const client = createDirectEngineClient();
    await expect(client.setBaseCurrency('BOGUS')).rejects.toBeInstanceOf(InvalidBaseCurrencyError);
  });
});
