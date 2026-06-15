/**
 * Cache-only, fail-loud implementation of ExchangeRateApi.
 * @module exchange-rate/cache-only-rates-api
 * @internal
 *
 * Story 3.3 Task 6. Reads ONLY from the local DAO — the exact same USD-base rows
 * that `warmRates` writes. It NEVER delegates to a remote, NEVER fetches, and
 * NEVER returns an empty/zero map on a miss. A miss is a LOUD
 * `RatesUnavailableError` so the ENT-020 reserve bridge fails closed rather than
 * silently producing a wrong USD amount.
 *
 * The storage key is `date.toISOString().split('T')[0]` (UTC yyyy-MM-dd) — byte
 * identical to `CachedExchangeRateApi`, so reads land on exactly the rows the
 * cached writer wrote (the warm↔read seam).
 */

import type { ExchangeRateApi } from './api';
import type { ExchangeRateDAO } from './dao';

/**
 * Thrown when no cached rate row exists for the requested base currency / date.
 * The message NAMES the missing date so a fail-loud rejection is diagnosable.
 */
export class RatesUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RatesUnavailableError';
  }
}

/**
 * An ExchangeRateApi that serves rates EXCLUSIVELY from the local cache (DAO).
 * On a cache miss it throws `RatesUnavailableError` instead of reaching out to
 * any network — making it offline-safe and fail-loud.
 */
export class CacheOnlyRatesApi implements ExchangeRateApi {
  private readonly dao: ExchangeRateDAO;

  /**
   * @param dao - The ExchangeRateDAO backing the local cache.
   */
  constructor(dao: ExchangeRateDAO) {
    this.dao = dao;
  }

  /**
   * Retrieves the cached exchange rate map for a base currency on a date.
   *
   * @param baseCurrency - The base currency code (e.g. "USD").
   * @param date - The date for which rates are sought.
   * @returns The rate map (currency code → rate against the base).
   * @throws {RatesUnavailableError} If no cached row exists for that date.
   */
  async getExchangeRate(
    baseCurrency: string,
    date: Date
  ): Promise<Record<string, number>> {
    // IDENTICAL key format to CachedExchangeRateApi (UTC yyyy-MM-dd).
    const formattedDate = date.toISOString().split('T')[0];

    const cachedRate = await this.dao.findByBaseCurrencyAndDate(
      baseCurrency,
      formattedDate
    );

    if (!cachedRate) {
      // Row miss: fail loud, name the base + date. NEVER fetch, NEVER return {}.
      throw new RatesUnavailableError(
        `No cached exchange rates for ${baseCurrency} on ${formattedDate}`
      );
    }

    // Convert the stored entity to the rate map exactly like CachedExchangeRateApi.
    const result: Record<string, number> = {};
    Object.entries(cachedRate).forEach(([key, value]) => {
      if (key !== 'base' && key !== 'date') {
        result[key] =
          typeof value === 'string' ? parseFloat(value) : (value as number);
      }
    });

    return result;
  }
}
