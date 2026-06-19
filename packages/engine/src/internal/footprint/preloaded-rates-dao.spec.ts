/**
 * Tests for PreloadedRatesDao — an in-memory ExchangeRateDAO backed by a date→entity
 * map preloaded ONCE per commit (the perf-map; zero IDB reads per row).
 */
import { describe, expect, it } from 'vitest';
import { PreloadedRatesDao } from './preloaded-rates-dao';

describe('PreloadedRatesDao', () => {
  it('serves findByBaseCurrencyAndDate from the preloaded map (no IDB)', async () => {
    const entity = { base: 'USD', date: '2023-09-30', EUR: 0.95 };
    const dao = new PreloadedRatesDao(new Map([['2023-09-30', entity]]));
    expect(await dao.findByBaseCurrencyAndDate('USD', '2023-09-30')).toEqual(entity);
    expect(await dao.findByBaseCurrencyAndDate('USD', '2023-10-01')).toBeNull(); // absent date → null (the loud gate fires upstream)
  });
});
