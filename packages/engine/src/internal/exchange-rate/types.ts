/**
 * Exchange rate type definitions
 * @module exchange-rate/types
 */

import type { CompoundKey } from '../store/key';

/**
 * Exchange rate entity structure
 */
export interface ExchangeRateEntity {
  /**
   * The base currency code
   */
  base: string;

  /**
   * The date in format "yyyy-MM-dd"
   */
  date: string;

  /**
   * Exchange rates with currency codes as keys and rates as values
   */
  [key: string]: string | number;
}

/**
 * Exchange rate key type
 */
export interface ExchangeRateKey extends CompoundKey {
  base: string;
  date: string;
}
