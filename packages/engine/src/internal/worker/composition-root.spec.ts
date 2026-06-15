/**
 * Tests for the engine composition root — Story 3.3, Task 7 (worker rates wiring).
 *
 * Pins:
 *   - composeEngine() with NO rates option still wires a non-null, working remote:
 *     the self-derived same-origin WorkerHttpRatesApi (closes the 2.6 carry-forward gap).
 *   - An explicit options.exchangeRateApi override is preserved (still used as-is).
 *   - CONTRACT_VERSION literal is UNCHANGED (still 3 — no bump, no init rates param,
 *     handshake schema untouched).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { composeEngine } from './composition-root';
import { WorkerHttpRatesApi } from '../exchange-rate/worker-http-rates-api';
import type { ExchangeRateApi } from '../exchange-rate/api';
import * as ratesHolder from '../exchange-rate/rates-holder';
import { CONTRACT_VERSION } from '../../client/protocol';

describe('composeEngine — rates remote wiring (Task 7)', () => {
  let setRemoteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    setRemoteSpy = vi.spyOn(ratesHolder, 'setRemoteRatesApi');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    ratesHolder.resetRatesHolderForTests();
  });

  it('wires a self-derived WorkerHttpRatesApi when no exchangeRateApi option is given', async () => {
    await composeEngine();

    expect(setRemoteSpy).toHaveBeenCalledTimes(1);
    const wired = setRemoteSpy.mock.calls[0][0];
    expect(wired).toBeInstanceOf(WorkerHttpRatesApi);
  });

  it('preserves an explicit exchangeRateApi override', async () => {
    const override: ExchangeRateApi = {
      getExchangeRate: vi.fn().mockResolvedValue({}),
    };

    await composeEngine({ exchangeRateApi: override });

    expect(setRemoteSpy).toHaveBeenCalledTimes(1);
    expect(setRemoteSpy.mock.calls[0][0]).toBe(override);
  });
});

describe('composeEngine — contract is untouched', () => {
  it('CONTRACT_VERSION literal is unchanged (no bump; no init rates param)', () => {
    // The worker self-derives /api/rates internally — nothing about rates crosses the
    // wire in init, so the handshake contract stays frozen at 3.
    expect(CONTRACT_VERSION).toBe(3);
  });
});
