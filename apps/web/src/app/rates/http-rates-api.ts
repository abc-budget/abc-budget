/**
 * Plain-fetch HTTP implementation of ExchangeRateApi.
 *
 * Calls POST /api/rates (or VITE_RATES_URL override) with JSON { date }.
 * In production the Hosting rewrite forwards /api/rates to the
 * getUSDRates Cloud Function (europe-west1).
 *
 * Fails loudly on non-OK responses and network errors — no silent fallbacks
 * (EP-3 carry-forward: fail-loud).
 */

import type { ExchangeRateApi } from '@abc-budget/engine';

const RATES_URL = (import.meta.env.VITE_RATES_URL as string | undefined) ?? '/api/rates';

/** Formats a Date to "yyyy-MM-dd" — same derivation as the previous rates impl. */
function toDateString(date: Date): string {
  return date.toISOString().split('T')[0];
}

class HttpRatesApi implements ExchangeRateApi {
  async getExchangeRate(
    _baseCurrency: string,
    date: Date
  ): Promise<Record<string, number>> {
    const dateStr = toDateString(date);

    let response: Response;
    try {
      response = await fetch(RATES_URL, {
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
}

/** Factory — creates the HTTP-backed ExchangeRateApi. */
export function createHttpRatesApi(): ExchangeRateApi {
  return new HttpRatesApi();
}
