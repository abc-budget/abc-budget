/**
 * Exchange Rate DAO interface and implementation
 * @module exchange-rate/dao
 * @internal
 */

import type { DbProvider } from '../store/idb/dao-impl';
import type { Dao } from '../store/dao';
import { IDBDao } from '../store/idb/dao-impl';
import type { ExchangeRateEntity, ExchangeRateKey } from './types';

/**
 * Name of the exchange rates store in IndexedDB
 */
export const EXCHANGE_RATES_STORE = 'exchangeRates';

/**
 * Configuration for the exchange rates store
 */
export const EXCHANGE_RATES_STORE_CONFIG = {
  name: EXCHANGE_RATES_STORE,
  keyPath: ['base', 'date'],
  indexes: [
    {
      name: 'base',
      keyPath: 'base',
      options: {
        unique: false,
      },
    },
    {
      name: 'date',
      keyPath: 'date',
      options: {
        unique: false,
      },
    },
  ],
};

/**
 * Exchange Rate DAO interface
 */
export interface ExchangeRateDAO extends Dao<
  ExchangeRateKey,
  ExchangeRateEntity
> {
  /**
   * Finds exchange rates for a specific base currency
   * @param baseCurrency - The base currency code
   * @param criteria - Optional function to further filter the results
   * @returns A promise that resolves to an array of exchange rate entities
   */
  findByBaseCurrency(
    baseCurrency: string,
    criteria?: (entity: ExchangeRateEntity) => boolean
  ): Promise<ExchangeRateEntity[]>;

  /**
   * Finds exchange rates for a specific date
   * @param date - The date in format "yyyy-MM-dd"
   * @param criteria - Optional function to further filter the results
   * @returns A promise that resolves to an array of exchange rate entities
   */
  findByDate(
    date: string,
    criteria?: (entity: ExchangeRateEntity) => boolean
  ): Promise<ExchangeRateEntity[]>;

  /**
   * Finds an exchange rate for a specific base currency and date
   * @param baseCurrency - The base currency code
   * @param date - The date in format "yyyy-MM-dd"
   * @returns A promise that resolves to the exchange rate entity if found, or null if not found
   */
  findByBaseCurrencyAndDate(
    baseCurrency: string,
    date: string
  ): Promise<ExchangeRateEntity | null>;
}

/**
 * IndexedDB implementation of the ExchangeRateDAO interface
 */
export class IDBExchangeRateDAO
  extends IDBDao<ExchangeRateKey, ExchangeRateEntity>
  implements ExchangeRateDAO
{
  /**
   * Creates a new IDBExchangeRateDAO instance
   * @param dbProvider - Provides the open database instance
   */
  constructor(dbProvider: DbProvider) {
    super(dbProvider, {
      storeName: EXCHANGE_RATES_STORE,
      keyPath: ['base', 'date'],
      keyExtractor: (entity: ExchangeRateEntity): ExchangeRateKey => ({
        base: entity.base,
        date: entity.date,
      }),
    });
  }

  /**
   * Finds exchange rates for a specific base currency
   * @param baseCurrency - The base currency code
   * @param _criteria - Optional function to further filter the results
   * @returns A promise that resolves to an array of exchange rate entities
   */
  async findByBaseCurrency(
    baseCurrency: string,
    _criteria?: (entity: ExchangeRateEntity) => boolean
  ): Promise<ExchangeRateEntity[]> {
    return this.findByIndex('base', baseCurrency, _criteria);
  }

  /**
   * Finds exchange rates for a specific date
   * @param date - The date in format "yyyy-MM-dd"
   * @param _criteria - Optional function to further filter the results
   * @returns A promise that resolves to an array of exchange rate entities
   */
  async findByDate(
    date: string,
    _criteria?: (entity: ExchangeRateEntity) => boolean
  ): Promise<ExchangeRateEntity[]> {
    return this.findByIndex('date', date, _criteria);
  }

  /**
   * Finds an exchange rate for a specific base currency and date
   * @param baseCurrency - The base currency code
   * @param date - The date in format "yyyy-MM-dd"
   * @returns A promise that resolves to the exchange rate entity if found, or null if not found
   */
  async findByBaseCurrencyAndDate(
    baseCurrency: string,
    date: string
  ): Promise<ExchangeRateEntity | null> {
    const key: ExchangeRateKey = { base: baseCurrency, date };
    return this.read(key);
  }
}
