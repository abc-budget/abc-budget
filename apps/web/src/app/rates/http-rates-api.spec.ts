/**
 * Unit tests for HttpRatesApi (http-rates-api.ts).
 * Uses vi.stubGlobal('fetch', ...) — no real network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHttpRatesApi } from './http-rates-api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(
  status: number,
  body: unknown
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createHttpRatesApi', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('POSTs {date} and returns the rates record on success', async () => {
    const mockRates = { EUR: 0.91, GBP: 0.78, UAH: 41.2 };
    const mockFetch = vi.fn().mockResolvedValue(
      makeResponse(200, { rates: mockRates })
    );
    vi.stubGlobal('fetch', mockFetch);

    const api = createHttpRatesApi();
    const result = await api.getExchangeRate('USD', new Date('2026-06-01'));

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/rates');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(options.body as string)).toEqual({ date: '2026-06-01' });
    expect(result).toEqual(mockRates);
  });

  it('throws loudly with status in message on HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(403, {})));

    const api = createHttpRatesApi();
    await expect(api.getExchangeRate('USD', new Date('2026-06-01'))).rejects.toThrow(
      'rates request failed: HTTP 403'
    );
  });

  it('throws loudly with status in message on HTTP 429', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(429, {})));

    const api = createHttpRatesApi();
    await expect(api.getExchangeRate('USD', new Date('2026-06-01'))).rejects.toThrow(
      'rates request failed: HTTP 429'
    );
  });

  it('throws loudly with status in message on HTTP 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeResponse(500, {})));

    const api = createHttpRatesApi();
    await expect(api.getExchangeRate('USD', new Date('2026-06-01'))).rejects.toThrow(
      'rates request failed: HTTP 500'
    );
  });

  it('rethrows loudly on network failure (fetch rejects)', async () => {
    const networkError = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkError));

    const api = createHttpRatesApi();
    await expect(api.getExchangeRate('USD', new Date('2026-06-01'))).rejects.toThrow(
      'Failed to fetch'
    );
  });

  it('uses VITE_RATES_URL env override when set', async () => {
    vi.stubEnv('VITE_RATES_URL', 'http://localhost:5001/abc-budget-2d379/europe-west1/getUSDRates');

    const mockFetch = vi.fn().mockResolvedValue(makeResponse(200, { rates: {} }));
    vi.stubGlobal('fetch', mockFetch);

    // Re-import after env stub to pick up the new RATES_URL.
    vi.resetModules();
    const { createHttpRatesApi: createFresh } = await import('./http-rates-api');
    await createFresh().getExchangeRate('USD', new Date('2026-06-01'));

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:5001/abc-budget-2d379/europe-west1/getUSDRates');
  });
});
