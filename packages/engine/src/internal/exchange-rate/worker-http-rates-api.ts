/**
 * Worker-side plain-fetch implementation of ExchangeRateApi.
 *
 * Mirrors the app-side `HttpRatesApi` (apps/web/src/app/rates/http-rates-api.ts):
 * POST /api/rates (or VITE_RATES_URL override) with JSON { date }, parse the
 * { rates } map, FAIL LOUD on non-OK responses and network errors — no silent
 * fallbacks (EP-3 carry-forward: fail-loud).
 *
 * This closes the 2.6 worker carry-forward gap: the worker had an IDB rate cache
 * DAO but no remote source. It is self-derived (same-origin — Vite inlines the env
 * at build time), so nothing about rates crosses the wire in `init` and
 * CONTRACT_VERSION is untouched.
 *
 * @module exchange-rate/worker-http-rates-api
 * @internal
 */

import type { ExchangeRateApi } from './api';
import { getCachedRatesApi } from './rates-holder';

/**
 * Resolves the rates endpoint. `import.meta.env` is populated by Vite (the worker
 * build) and absent under a bare node typecheck — read it defensively so the file
 * typechecks without the Vite client types while still honouring VITE_RATES_URL.
 */
function ratesUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.['VITE_RATES_URL'] ?? '/api/rates';
}

/**
 * Resolves the BULK rates endpoint (the deployed `getUSDRatesBulk` CF, Story 5.2),
 * mirroring {@link ratesUrl}: honours a `VITE_RATES_BULK_URL` override and otherwise
 * derives the sibling `/bulk` path of the single-date `ratesUrl()` (e.g. `/api/rates`
 * → `/api/rates/bulk`). Read `import.meta.env` defensively so the file typechecks
 * without the Vite client types.
 */
function bulkRatesUrl(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env;
  return env?.['VITE_RATES_BULK_URL'] ?? `${ratesUrl()}/bulk`;
}

/** Formats a Date to "yyyy-MM-dd" — same derivation as the app impl + CachedExchangeRateApi. */
function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Worker-side HTTP-backed ExchangeRateApi. Same request shape as the app HttpRatesApi.
 */
export class WorkerHttpRatesApi implements ExchangeRateApi {
  async getExchangeRate(
    _baseCurrency: string,
    date: Date
  ): Promise<Record<string, number>> {
    const dateStr = toDateString(date);

    let response: Response;
    try {
      response = await fetch(ratesUrl(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ date: dateStr }),
      });
    } catch (err) {
      // Network-level failure (offline, DNS, etc.) — rethrow loudly.
      throw err;
    }

    if (!response.ok) {
      throw new Error(`rates request failed: HTTP ${response.status}`);
    }

    const payload = (await response.json()) as { rates: Record<string, number> };
    return payload.rates;
  }

  /**
   * Fetches the USD daily tables for a LIST of dates in ONE bulk request (Story 5.2)
   * against the deployed `getUSDRatesBulk` CF. De-duplicates the dates by yyyy-MM-dd,
   * POSTs `{ dates }` to {@link bulkRatesUrl}, and returns the merged `{ rates }` map
   * (date → currency-rate record) for the AVAILABLE dates. FAILS LOUD on a non-OK
   * response (EP-3 carry-forward) — `bulkWarmRates` is the layer that swallows.
   */
  async bulkGetExchangeRates(
    _base: string,
    dates: Date[]
  ): Promise<Record<string, Record<string, number>>> {
    const dateStrs = [...new Set(dates.map(toDateString))];
    const response = await fetch(bulkRatesUrl(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dates: dateStrs }),
    });
    if (!response.ok) {
      throw new Error(`bulk rates request failed: HTTP ${response.status}`);
    }
    const payload = (await response.json()) as {
      rates: Record<string, Record<string, number>>;
    };
    return payload.rates;
  }

  /**
   * Pre-populates the IDB rate cache for the DISTINCT operation dates of a batch so
   * a later commit-time cache-only read hits. Drives the SAME cache-then-remote
   * read-through (`CachedExchangeRateApi`) the convert-time service reads through
   * — obtained via the rates holder — so the key warmRates WRITES under is byte-
   * identical to the key the convert-time read CONSULTS (write-key === read-key).
   *
   * Idempotent: the cached read-through only hits the remote on a miss, so warming
   * an already-cached date issues no second fetch. Dates are de-duplicated by their
   * `toISOString().split('T')[0]` string before warming.
   *
   * Off the import path: this is the only network touch, invoked at commit time —
   * import stays rate-free (EP-2 proven offline).
   *
   * @param dates - Operation dates whose USD rates should be warmed.
   * @param base - Base currency to warm (defaults to 'USD' — the reserve bridge).
   */
  async warmRates(dates: Date[], base = 'USD'): Promise<void> {
    const cachedApi = await getCachedRatesApi();
    if (!cachedApi) {
      // No remote wired (no-IDB / not composed) — nothing to warm.
      return;
    }

    // De-duplicate by yyyy-MM-dd, keeping the first Date instance per key.
    const distinct = new Map<string, Date>();
    for (const date of dates) {
      const key = toDateString(date);
      if (!distinct.has(key)) {
        distinct.set(key, date);
      }
    }

    // Read-through each distinct date: cache miss → one fetch + write; cache hit → no fetch.
    for (const date of distinct.values()) {
      await cachedApi.getExchangeRate(base, date);
    }
  }
}
