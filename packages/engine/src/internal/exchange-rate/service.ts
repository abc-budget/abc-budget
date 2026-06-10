/**
 * Exchange rate service implementation
 * @module exchange-rate/service
 */

import type { ExchangeRateApi } from './api';

/**
 * Abstract base class for exchange rate service
 */
export abstract class ExchangeRateService {
  /**
   * Converts an amount from one currency to another
   *
   * @param amount - The amount to convert
   * @param fromCurrency - The currency code to convert from
   * @param toCurrency - The currency code to convert to
   * @param date - The date for which to use exchange rates (defaults to current date)
   * @returns A promise that resolves to the converted amount
   */
  abstract convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date?: Date
  ): Promise<number>;
}

/**
 * Implementation of the ExchangeRateService
 */
export class ExchangeRateServiceImpl extends ExchangeRateService {
  private exchangeRateApi: ExchangeRateApi;
  private readonly USD = 'USD';

  /**
   * Creates a new ExchangeRateServiceImpl instance
   * @param api - The ExchangeRateApi implementation to use
   */
  constructor(api: ExchangeRateApi) {
    super();
    this.exchangeRateApi = api;
  }

  /**
   * Converts an amount from one currency to another
   *
   * @param amount - The amount to convert
   * @param fromCurrency - The currency code to convert from
   * @param toCurrency - The currency code to convert to
   * @param date - The date for which to use exchange rates (defaults to current date)
   * @returns A promise that resolves to the converted amount
   * @throws Error if conversion is not possible
   */
  async convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date = new Date()
  ): Promise<number> {
    // If the currencies are the same, no conversion needed
    if (fromCurrency === toCurrency) {
      return amount;
    }

    // Try conversion strategies in order of preference
    let result: number | null = null;

    // 1. Try USD-based direct conversion (when one currency is USD)
    if (fromCurrency === this.USD || toCurrency === this.USD) {
      result = await this.tryUsdDirectConversion(
        amount,
        fromCurrency,
        toCurrency,
        date
      );
      if (result !== null) return result;
    }

    // 2. Try double conversion through USD
    result = await this.tryUsdDoubleConversion(
      amount,
      fromCurrency,
      toCurrency,
      date
    );
    if (result !== null) return result;

    // 3. Try direct conversion as fallback
    result = await this.tryDirectConversion(
      amount,
      fromCurrency,
      toCurrency,
      date
    );
    if (result !== null) return result;

    // 4. Try inverse conversion as last resort
    result = await this.tryInverseConversion(
      amount,
      fromCurrency,
      toCurrency,
      date
    );
    if (result !== null) return result;

    // If all conversion methods fail, throw an error
    throw new Error(`Cannot convert from ${fromCurrency} to ${toCurrency}`);
  }

  /**
   * Attempts direct conversion when one of the currencies is USD
   * @returns The converted amount or null if conversion failed
   */
  private async tryUsdDirectConversion(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date
  ): Promise<number | null> {
    try {
      const rates = await this.exchangeRateApi.getExchangeRate(this.USD, date);

      if (fromCurrency === this.USD && rates[toCurrency]) {
        // USD to other currency
        return amount * rates[toCurrency];
      } else if (toCurrency === this.USD && rates[fromCurrency]) {
        // Other currency to USD
        return amount / rates[fromCurrency];
      }
    } catch (error) {
      // Log error and continue to next strategy
      console.error('USD direct conversion failed:', error);
    }

    return null;
  }

  /**
   * Attempts double conversion through USD for non-USD currency pairs
   * @returns The converted amount or null if conversion failed
   */
  private async tryUsdDoubleConversion(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date
  ): Promise<number | null> {
    try {
      const usdRates = await this.exchangeRateApi.getExchangeRate(
        this.USD,
        date
      );

      // Check if we have rates for both currencies
      if (usdRates[fromCurrency] && usdRates[toCurrency]) {
        // Convert: fromCurrency -> USD -> toCurrency
        const amountInUsd = amount / usdRates[fromCurrency];
        return amountInUsd * usdRates[toCurrency];
      }
    } catch (error) {
      console.error('USD double conversion failed:', error);
    }

    return null;
  }

  /**
   * Attempts direct conversion using fromCurrency as base
   * @returns The converted amount or null if conversion failed
   */
  private async tryDirectConversion(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date
  ): Promise<number | null> {
    try {
      const rates = await this.exchangeRateApi.getExchangeRate(
        fromCurrency,
        date
      );
      if (rates[toCurrency]) {
        return amount * rates[toCurrency];
      }
    } catch (error) {
      console.error('Direct conversion failed:', error);
    }

    return null;
  }

  /**
   * Attempts inverse conversion using toCurrency as base
   * @returns The converted amount or null if conversion failed
   */
  private async tryInverseConversion(
    amount: number,
    fromCurrency: string,
    toCurrency: string,
    date: Date
  ): Promise<number | null> {
    try {
      const toRates = await this.exchangeRateApi.getExchangeRate(
        toCurrency,
        date
      );
      if (toRates[fromCurrency]) {
        return amount / toRates[fromCurrency];
      }
    } catch (error) {
      console.error('Inverse conversion failed:', error);
    }

    return null;
  }
}
