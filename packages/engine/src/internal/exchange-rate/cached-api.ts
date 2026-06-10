/**
 * Cached implementation of ExchangeRateApi
 * @module exchange-rate/cached-api
 */

import type { ExchangeRateApi } from './api';
import type { ExchangeRateDAO } from './dao';

/**
 * A cached implementation of ExchangeRateApi that uses ExchangeRateDAO for caching
 * and delegates to another ExchangeRateApi implementation when cache misses occur.
 */
export class CachedExchangeRateApi implements ExchangeRateApi {
  private exchangeRateDAO: ExchangeRateDAO;
  private targetApi: ExchangeRateApi;

  /**
   * Creates a new CachedExchangeRateApi instance
   * @param dao - The ExchangeRateDAO for caching
   * @param targetApi - The ExchangeRateApi implementation to delegate to on cache misses
   */
  constructor(dao: ExchangeRateDAO, targetApi: ExchangeRateApi) {
    this.exchangeRateDAO = dao;
    this.targetApi = targetApi;
  }

  /**
   * Retrieves exchange rates for a specified base currency on a given date.
   * First checks the cache (ExchangeRateDAO), and if not found, calls the target API
   * and caches the result.
   *
   * @param baseCurrency - The currency code for the base currency (e.g., "USD", "EUR")
   * @param date - The date for which the exchange rates are sought
   * @returns A promise that resolves to a record containing currency codes mapped to their respective exchange rates
   */
  async getExchangeRate(
    baseCurrency: string,
    date: Date
  ): Promise<Record<string, number>> {
    // Format date as yyyy-MM-dd for storage
    const formattedDate = date.toISOString().split('T')[0];

    // Try to get from cache
    const cachedRate = await this.exchangeRateDAO.findByBaseCurrencyAndDate(
      baseCurrency,
      formattedDate
    );

    if (cachedRate) {
      // Convert cached entity to the expected return format
      const result: Record<string, number> = {};

      // Extract all properties that are not 'base' or 'date' as they are exchange rates
      Object.entries(cachedRate).forEach(([key, value]) => {
        if (key !== 'base' && key !== 'date') {
          // Convert string rates to numbers if needed
          result[key] =
            typeof value === 'string' ? parseFloat(value) : (value as number);
        }
      });

      return result;
    }

    // Cache miss - call the target API
    const rates = await this.targetApi.getExchangeRate(baseCurrency, date);

    // Cache the result
    const entity = {
      base: baseCurrency,
      date: formattedDate,
      ...rates,
    };

    await this.exchangeRateDAO.create(entity);

    return rates;
  }
}
