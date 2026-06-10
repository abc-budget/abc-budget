/**
 * Unit tests for FirebaseRatesApi (firebase-rates-api.ts).
 * All firebase/* modules are vi.mock'd — no real network or SDK init.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before any import of the module under test.
// ---------------------------------------------------------------------------

const mockHttpsCallable = vi.fn();
const mockGetFunctions = vi.fn();
const mockInitializeApp = vi.fn();
const mockGetApps = vi.fn();
const mockInitializeAppCheck = vi.fn();

vi.mock('firebase/app', () => ({
  initializeApp: mockInitializeApp,
  getApps: mockGetApps,
}));

vi.mock('firebase/functions', () => ({
  getFunctions: mockGetFunctions,
  httpsCallable: mockHttpsCallable,
}));

vi.mock('firebase/app-check', () => ({
  initializeAppCheck: mockInitializeAppCheck,
  ReCaptchaEnterpriseProvider: class {
    constructor(public key: string) {}
  },
}));

// ---------------------------------------------------------------------------
// Module under test — imported AFTER mocks are set up.
// ---------------------------------------------------------------------------

// We need a fresh module for each test to reset the module-level _app state.
// Use vi.resetModules() in beforeEach and dynamic import.

describe('createFirebaseRatesApi', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();

    // Default: no existing apps → initializeApp will be called.
    mockGetApps.mockReturnValue([]);

    // initializeApp returns a fake app object.
    const fakeApp = { name: '[DEFAULT]' };
    mockInitializeApp.mockReturnValue(fakeApp);

    // getFunctions returns a fake functions instance.
    const fakeFunctions = {};
    mockGetFunctions.mockReturnValue(fakeFunctions);
  });

  it('calls the callable with {date} and returns the rates record', async () => {
    // Arrange
    const mockRates = { EUR: 0.91, GBP: 0.78, UAH: 41.2 };
    const callableFn = vi.fn().mockResolvedValue({ data: mockRates });
    mockHttpsCallable.mockReturnValue(callableFn);

    const { createFirebaseRatesApi } = await import('./firebase-rates-api');
    const api = createFirebaseRatesApi();

    // Act
    const result = await api.getExchangeRate('USD', new Date('2026-06-01'));

    // Assert
    expect(callableFn).toHaveBeenCalledOnce();
    expect(callableFn).toHaveBeenCalledWith({ date: '2026-06-01' });
    expect(result).toEqual(mockRates);
  });

  it('throws loudly when the callable rejects', async () => {
    // Arrange
    const networkError = new Error('Network failure');
    const callableFn = vi.fn().mockRejectedValue(networkError);
    mockHttpsCallable.mockReturnValue(callableFn);

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { createFirebaseRatesApi } = await import('./firebase-rates-api');
    const api = createFirebaseRatesApi();

    // Act & Assert
    await expect(api.getExchangeRate('USD', new Date('2026-06-01'))).rejects.toThrow(
      'Network failure'
    );

    // Confirm the loud console.error was emitted
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch exchange rates'),
      networkError
    );

    consoleErrorSpy.mockRestore();
  });

  it('initialises App Check when VITE_APPCHECK_SITE_KEY is present', async () => {
    // Arrange — set the env var before importing
    import.meta.env.VITE_APPCHECK_SITE_KEY = 'test-site-key-123';

    const callableFn = vi.fn().mockResolvedValue({ data: {} });
    mockHttpsCallable.mockReturnValue(callableFn);

    const { createFirebaseRatesApi } = await import('./firebase-rates-api');
    createFirebaseRatesApi();
    // Trigger app init via a call
    await createFirebaseRatesApi().getExchangeRate('USD', new Date('2026-06-01'));

    expect(mockInitializeAppCheck).toHaveBeenCalled();

    // Cleanup
    import.meta.env.VITE_APPCHECK_SITE_KEY = undefined;
  });

  it('emits console.error and skips App Check when VITE_APPCHECK_SITE_KEY is absent', async () => {
    import.meta.env.VITE_APPCHECK_SITE_KEY = undefined;

    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const callableFn = vi.fn().mockResolvedValue({ data: {} });
    mockHttpsCallable.mockReturnValue(callableFn);

    const { createFirebaseRatesApi } = await import('./firebase-rates-api');
    await createFirebaseRatesApi().getExchangeRate('USD', new Date('2026-06-01'));

    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('VITE_APPCHECK_SITE_KEY is not set')
    );

    consoleErrorSpy.mockRestore();
  });
});
