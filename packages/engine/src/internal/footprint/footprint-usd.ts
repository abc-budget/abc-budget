/**
 * The ENT-020 reserve bridge: convert an operation's (amount, currency) to USD.
 * @module internal/footprint/footprint-usd
 * @internal
 *
 * Story 3.3 Task 6 — HIGHEST-RISK. A deterministic-but-WRONG USD is a SILENT
 * money error, so this module is cache-only, fail-loud, and DELEGATES the
 * multiply/divide direction to the single tested converter
 * (`ExchangeRateServiceImpl`) rather than re-implementing the math.
 *
 * CONVENTION (from exchange-rate/service.ts `tryUsdDirectConversion`): stored
 * rates are USD-base, UNITS-PER-USD; other→USD DIVIDES (`amount / rates[from]`).
 *
 * The swallow gotcha: `convert()` wraps its rate lookup in a try/catch that logs
 * and returns null, so a cache miss surfaced through `convert()` becomes a
 * GENERIC "Cannot convert" error, not a precise `RatesUnavailableError`. To get
 * BOTH a precise fail-loud error AND the correct direction we PRE-CHECK presence
 * against the cache-only api (which throws `RatesUnavailableError` loudly), then
 * delegate to `convert()` — which now provably hits the USD-direct DIVIDE path
 * with no swallow reachable.
 */

import {
  CacheOnlyRatesApi,
  RatesUnavailableError,
} from '../exchange-rate/cache-only-rates-api';
import type { ExchangeRateDAO } from '../exchange-rate/dao';
import { ExchangeRateServiceImpl } from '../exchange-rate/service';

const USD = 'USD';

/**
 * Converts `amount` of `currency` on `opDate` into USD, reading rates ONLY from
 * the local cache. Deterministic and offline-safe — no `fetch`, no `Date.now`,
 * no `Math.random` is reachable from here.
 *
 * @param amount - The amount in `currency`.
 * @param currency - The source currency code (e.g. "UAH").
 * @param opDate - The operation date whose cached rates to use.
 * @param dao - The ExchangeRateDAO backing the local cache.
 * @returns The amount in USD.
 * @throws {RatesUnavailableError} If the date's row is missing, or the row is
 *   present but lacks `currency`.
 */
export async function toAmountUSD(
  amount: number,
  currency: string,
  opDate: Date,
  dao: ExchangeRateDAO
): Promise<number> {
  // 1. Identity: USD→USD needs no lookup and no division.
  if (currency === USD) {
    return amount;
  }

  const cacheOnlyApi = new CacheOnlyRatesApi(dao);

  // 2. PRE-CHECK presence. A row miss throws RatesUnavailableError (date in
  //    message). This is what guarantees a PRECISE fail-loud error despite the
  //    convert() swallow — we surface the miss here, before convert() can mask it.
  const formattedDate = opDate.toISOString().split('T')[0];
  const rates = await cacheOnlyApi.getExchangeRate(USD, opDate);
  if (rates[currency] === undefined) {
    // Currency-level miss: row present, this currency absent. Name both.
    throw new RatesUnavailableError(
      `No cached USD rate for ${currency} on ${formattedDate}`
    );
  }

  // 3. DELEGATE direction to the tested converter. Presence is pre-verified, so
  //    convert() takes the USD-direct path and DIVIDES (amount / rates[from]) —
  //    correct direction, no swallow reachable. Do NOT hand-roll amount / rate.
  return new ExchangeRateServiceImpl(cacheOnlyApi).convert(
    amount,
    currency,
    USD,
    opDate
  );
}
