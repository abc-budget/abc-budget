/**
 * Module-level holder for the exchange-rate service.
 * Lazily constructs IDBExchangeRateDAO + CachedExchangeRateApi + ExchangeRateServiceImpl
 * on first use so that environments without indexedDB are unaffected until rates are needed.
 * @internal
 */

import type { ExchangeRateApi } from './api';
import { CachedExchangeRateApi } from './cached-api';
import { IDBExchangeRateDAO } from './dao';
import { ExchangeRateService, ExchangeRateServiceImpl } from './service';
import { openEngineDb } from '../persistence/engine-db';

let _remoteApi: ExchangeRateApi | undefined;
let _servicePromise: Promise<ExchangeRateService> | null = null;

/**
 * Stores the injected remote ExchangeRateApi provided by the app layer.
 * Called once from createDirectEngineClient.
 */
export function setRemoteRatesApi(api: ExchangeRateApi | undefined): void {
  _remoteApi = api;
}

/**
 * Returns a lazily-constructed ExchangeRateService backed by IDB + the injected remote api.
 * Returns null if no remote api was injected (rates simply unavailable).
 * The lazy construction is async (awaits openEngineDb once) and memoized.
 */
export async function getRatesService(): Promise<ExchangeRateService | null> {
  if (!_remoteApi) {
    return null;
  }

  if (!_servicePromise) {
    const remoteApi = _remoteApi; // capture for the closure
    _servicePromise = (async () => {
      const db = await openEngineDb();
      const dao = new IDBExchangeRateDAO(() => db);
      const cachedApi = new CachedExchangeRateApi(dao, remoteApi);
      return new ExchangeRateServiceImpl(cachedApi);
    })();
  }

  return _servicePromise;
}

/** Test seam — resets the holder state. Not exported from the package barrel. */
export function resetRatesHolderForTests(): void {
  _remoteApi = undefined;
  _servicePromise = null;
}
