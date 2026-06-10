import type { EngineClient } from './engine-client';
import type { ExchangeRateApi } from '../internal/exchange-rate/api';
import { createPingEngine } from '../internal/ping-engine';
import { initEnginePersistence } from '../internal/persistence/engine-db';
import { setRemoteRatesApi } from '../internal/exchange-rate/rates-holder';

/** Options accepted by the direct engine client factory. */
export interface EngineInitOptions {
  /**
   * Remote ExchangeRateApi implementation supplied by the app layer.
   * When provided, the engine wires a 2-level cache (IDB → remote).
   * When absent, rate conversion is unavailable until EP-2 surfaces it.
   */
  exchangeRateApi?: ExchangeRateApi;
}

/** Builds an EngineClient that calls the engine directly, in the same thread. */
export function createDirectEngineClient(options?: EngineInitOptions): EngineClient {
  // Wire the remote rates api into the module-level holder before any lazy construction.
  setRemoteRatesApi(options?.exchangeRateApi);

  // Fire-and-forget: opens the engine DB (v2 migrations) + requests durability. Memoized;
  // no-throw where indexedDB is absent. Failure handling hardens in EP-3 (fail-loud).
  void initEnginePersistence();
  return createPingEngine();
}
