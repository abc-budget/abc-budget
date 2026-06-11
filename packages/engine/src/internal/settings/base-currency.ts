/**
 * Convenience helpers for the base-currency setting.
 * @module internal/settings/base-currency
 * @internal
 *
 * NEW in Story 2.3, Task 1.
 *
 * `getBaseCurrency()` — reads from the injected UserSettingsDAO; throws a loud,
 * specific error when the setting is absent (the 2.7 gate sets it before any
 * currency-resolution code runs).
 *
 * `setBaseCurrency(iso)` — validates via the 1.6 getCurrency reference before
 * persisting.
 */

import { getCurrency } from '../currency/reference';
import type { UserSettingsDAO } from './user-settings';
import { SettingKeys } from './user-settings';

// ── Errors ────────────────────────────────────────────────────────────────────

/**
 * Thrown when `getBaseCurrency` is called but no base currency has been set.
 *
 * This is a LOUD error by design: the `use_base` currency option requires a
 * base currency to be configured before any statement import begins.  The 2.7
 * gate (setup wizard) sets the base currency; callers that reach this error
 * before the gate runs have a flow bug.
 */
export class BaseCurrencyNotSetError extends Error {
  constructor() {
    super(
      '[abc-engine] Base currency is not set. ' +
        'Configure a base currency (Story 2.7 gate) before importing statements ' +
        'that use the "use_base" currency option.',
    );
    this.name = 'BaseCurrencyNotSetError';
  }
}

/**
 * Thrown when `setBaseCurrency` is called with an unknown ISO currency code.
 */
export class InvalidBaseCurrencyError extends Error {
  constructor(iso: string) {
    super(
      `[abc-engine] Invalid base currency code: "${iso}". ` +
        'Must be a valid ISO 4217 alpha code from the currency reference dataset.',
    );
    this.name = 'InvalidBaseCurrencyError';
  }
}

// ── Functions ─────────────────────────────────────────────────────────────────

/**
 * Returns the stored base currency ISO code.
 *
 * @param dao - The user settings DAO to read from
 * @throws {BaseCurrencyNotSetError} if no base currency has been set
 */
export async function getBaseCurrency(dao: UserSettingsDAO): Promise<string> {
  const value = await dao.getSetting<string>(SettingKeys.BASE_CURRENCY);
  if (value === undefined || value === null || value === '') {
    throw new BaseCurrencyNotSetError();
  }
  return value;
}

/**
 * Persists the base currency after validating the ISO code via the 1.6 currency reference.
 *
 * @param dao - The user settings DAO to write to
 * @param iso - ISO 4217 alpha code (e.g. 'UAH', 'USD')
 * @throws {InvalidBaseCurrencyError} if `iso` is not a known currency code
 */
export async function setBaseCurrency(dao: UserSettingsDAO, iso: string): Promise<void> {
  if (!getCurrency(iso)) {
    throw new InvalidBaseCurrencyError(iso);
  }
  await dao.setSetting(SettingKeys.BASE_CURRENCY, iso);
}
