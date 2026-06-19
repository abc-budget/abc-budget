/**
 * Exchange rate API interface
 * @module exchange-rate/api
 */

/**
 * Interface for exchange rate API
 */
export interface ExchangeRateApi {
  /**
   * Retrieves exchange rates for a specified base currency on a given date.
   *
   * @param baseCurrency - The currency code for the base currency (e.g., "USD", "EUR") for which exchange rates are requested.
   * @param date - The date for which the exchange rates are sought.
   * @returns A promise that resolves to a record containing currency codes mapped to their respective exchange rates against the base currency.
   */
  getExchangeRate(
    baseCurrency: string,
    date: Date
  ): Promise<Record<string, number>>;

  /**
   * Fetch the USD daily tables for a LIST of dates in ONE bulk request (Story 5.2).
   * Returns date(yyyy-MM-dd) → rate map for the AVAILABLE dates (cap-cut/failed omitted).
   *
   * @param baseCurrency - The base currency code (e.g. "USD").
   * @param dates - The dates whose rate tables are requested.
   * @returns A promise resolving to a map of yyyy-MM-dd → currency-rate record.
   */
  bulkGetExchangeRates(
    baseCurrency: string,
    dates: Date[]
  ): Promise<Record<string, Record<string, number>>>;
}
