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
let _cachedApiPromise: Promise<CachedExchangeRateApi> | null = null;

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
 *
 * ✅ Clear-on-reject (Story 2.3, Task 1): on rejection the memoized promise is cleared
 * so the next caller retries rather than receiving the same rejected promise forever.
 * This resolves the 1.6 ⚠️ guardrail (both layers now clear on reject).
 */
export async function getRatesService(): Promise<ExchangeRateService | null> {
  if (!_remoteApi) {
    return null;
  }

  if (!_servicePromise) {
    _servicePromise = (async () => {
      const cachedApi = await buildCachedApi();
      return new ExchangeRateServiceImpl(cachedApi);
    })().catch((err) => {
      // Clear memoization so the next call retries
      _servicePromise = null;
      return Promise.reject(err);
    });
  }

  return _servicePromise;
}

/**
 * Returns the lazily-constructed, memoized cache-then-remote read-through
 * (`CachedExchangeRateApi`) that backs the convert-time `ExchangeRateService`.
 * Returns null if no remote api was injected.
 *
 * This is the SAME instance the service reads through at convert time, so a
 * `getExchangeRate('USD', date)` call here writes the cache under the identical
 * key a later convert-time read consults — the write-key === read-key invariant
 * that `WorkerHttpRatesApi.warmRates` relies on.
 */
export async function getCachedRatesApi(): Promise<CachedExchangeRateApi | null> {
  if (!_remoteApi) {
    return null;
  }
  return buildCachedApi();
}

/**
 * Lazily builds + memoizes the CachedExchangeRateApi over the live engine DB and
 * the injected remote api. Shared by getRatesService + getCachedRatesApi so both
 * read through the SAME cache instance.
 *
 * ✅ Clear-on-reject: on rejection the memoized promise is cleared so the next
 * caller retries rather than receiving the same rejected promise forever.
 */
function buildCachedApi(): Promise<CachedExchangeRateApi> {
  if (!_remoteApi) {
    return Promise.reject(new Error('no remote rates api injected'));
  }

  if (!_cachedApiPromise) {
    const remoteApi = _remoteApi; // capture for the closure
    _cachedApiPromise = (async () => {
      const db = await openEngineDb();
      const dao = new IDBExchangeRateDAO(() => db);
      return new CachedExchangeRateApi(dao, remoteApi);
    })().catch((err) => {
      _cachedApiPromise = null;
      return Promise.reject(err);
    });
  }

  return _cachedApiPromise;
}

/** Test seam — resets the holder state. Not exported from the package barrel. */
export function resetRatesHolderForTests(): void {
  _remoteApi = undefined;
  _servicePromise = null;
  _cachedApiPromise = null;
}
