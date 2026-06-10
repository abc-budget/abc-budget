/**
 * Comprehensive unit tests for ExchangeRateServiceImpl.convert()
 * Ported from webapp/libs/engine/src/exchange-rate/service.convert.spec.ts
 * Adaptation: Container/IoCKeys removed; ExchangeRateServiceImpl now takes api directly.
 *   jest.fn() → vi.fn(); jest.spyOn() → vi.spyOn(); createMock removed (plain object).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExchangeRateApi } from './api';
import { ExchangeRateServiceImpl } from './service';

describe('ExchangeRateServiceImpl.convert', () => {
  let apiMock: ExchangeRateApi & { getExchangeRate: ReturnType<typeof vi.fn> };
  let service: ExchangeRateServiceImpl;
  const date = new Date('2024-01-15T00:00:00Z');

  beforeEach(() => {
    apiMock = {
      getExchangeRate: vi.fn(),
    };
    service = new ExchangeRateServiceImpl(apiMock);
  });

  it('returns same amount when fromCurrency equals toCurrency (no API calls)', async () => {
    const result = await service.convert(123.45, 'EUR', 'EUR', date);
    expect(result).toBe(123.45);
    expect(apiMock.getExchangeRate).not.toHaveBeenCalled();
  });

  it('USD direct conversion: USD -> EUR using USD base rates', async () => {
    apiMock.getExchangeRate.mockImplementation(async (base: string, d: Date) => {
      expect(d).toBe(date);
      const rates: Record<string, number> = {};
      if (base === 'USD') rates['EUR'] = 0.9;
      return rates;
    });

    const result = await service.convert(100, 'USD', 'EUR', date);
    expect(result).toBeCloseTo(90);
    expect(apiMock.getExchangeRate).toHaveBeenCalledWith('USD', date);
  });

  it('USD direct conversion: EUR -> USD using USD base rates', async () => {
    apiMock.getExchangeRate.mockResolvedValue({ EUR: 0.8 });

    const result = await service.convert(80, 'EUR', 'USD', date);
    // amount / rate[EUR] = 80 / 0.8 = 100
    expect(result).toBeCloseTo(100);
    expect(apiMock.getExchangeRate).toHaveBeenCalledWith('USD', date);
  });

  it('USD double conversion for non-USD pair via USD: EUR -> GBP', async () => {
    apiMock.getExchangeRate.mockImplementation(async (base: string, d: Date) => {
      expect(d).toBe(date);
      const rates: Record<string, number> = {};
      if (base === 'USD') {
        rates['EUR'] = 0.8;
        rates['GBP'] = 0.6;
      }
      return rates;
    });

    const result = await service.convert(80, 'EUR', 'GBP', date);
    // 80 EUR -> USD = 80 / 0.8 = 100; then USD -> GBP = 100 * 0.6 = 60
    expect(result).toBeCloseTo(60);
    expect(apiMock.getExchangeRate).toHaveBeenCalledWith('USD', date);
  });

  it('Direct conversion with fromCurrency as base', async () => {
    apiMock.getExchangeRate.mockImplementation(async (base: string, d: Date) => {
      expect(d).toBe(date);
      const rates: Record<string, number> = {};
      if (base === 'EUR') rates['GBP'] = 0.7;
      return rates;
    });

    const result = await service.convert(100, 'EUR', 'GBP', date);
    expect(result).toBeCloseTo(70);
    expect(apiMock.getExchangeRate).toHaveBeenCalledWith('EUR', date);
  });

  it('Inverse conversion with toCurrency as base', async () => {
    apiMock.getExchangeRate.mockImplementation(async (base: string, d: Date) => {
      expect(d).toBe(date);
      const rates: Record<string, number> = {};
      if (base === 'GBP') rates['EUR'] = 0.5;
      return rates;
    });

    const result = await service.convert(100, 'EUR', 'GBP', date);
    // Using toCurrency base: amount / toRates[fromCurrency] = 100 / 0.5 = 200
    expect(result).toBeCloseTo(200);
    expect(apiMock.getExchangeRate).toHaveBeenCalledWith('GBP', date);
  });

  it('Logs error and falls back when a strategy throws, still returns via later strategy', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {
      /* noop */
    });
    apiMock.getExchangeRate.mockImplementation(async (base: string) => {
      const rates: Record<string, number> = {};
      if (base === 'USD') {
        // Cause USD double conversion to fail and force fallback
        throw new Error('Network error');
      }
      if (base === 'EUR') {
        // Direct conversion fallback succeeds
        rates['GBP'] = 0.7;
      }
      return rates;
    });

    const result = await service.convert(100, 'EUR', 'GBP', date);
    expect(result).toBeCloseTo(70);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it('Throws when all strategies fail', async () => {
    apiMock.getExchangeRate.mockResolvedValue({});
    await expect(service.convert(10, 'CHF', 'JPY', date)).rejects.toThrow(
      'Cannot convert from CHF to JPY'
    );
  });
});
