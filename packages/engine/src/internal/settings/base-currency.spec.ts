/**
 * Tests for base-currency helpers.
 * @module internal/settings/base-currency.spec
 *
 * Story 2.3, Task 1 — new spec.
 *
 * Contracts:
 *   - set/get round-trip with a valid ISO code
 *   - getBaseCurrency unset → BaseCurrencyNotSetError (loud, specific)
 *   - setBaseCurrency with invalid ISO → InvalidBaseCurrencyError
 *   - setBaseCurrency with valid non-UAH ISO (e.g. 'USD') is accepted
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getBaseCurrency,
  getBaseCurrencyOrNull,
  setBaseCurrency,
  BaseCurrencyNotSetError,
  InvalidBaseCurrencyError,
} from './base-currency';
import type { UserSettingsDAO } from './user-settings';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDao(storedValue: string | undefined = undefined): UserSettingsDAO {
  let stored: string | undefined = storedValue;
  return {
    getSetting: vi.fn().mockImplementation(() => Promise.resolve(stored)),
    setSetting: vi.fn().mockImplementation((_k: string, v: string) => {
      stored = v;
      return Promise.resolve();
    }),
    removeSetting: vi.fn().mockResolvedValue(false),
    getAllSettings: vi.fn().mockResolvedValue({}),
  } as UserSettingsDAO;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('setBaseCurrency + getBaseCurrency round-trip', () => {
  it('set UAH → get returns UAH', async () => {
    const dao = makeDao();
    await setBaseCurrency(dao, 'UAH');
    const result = await getBaseCurrency(dao);
    expect(result).toBe('UAH');
  });

  it('set USD → get returns USD', async () => {
    const dao = makeDao();
    await setBaseCurrency(dao, 'USD');
    const result = await getBaseCurrency(dao);
    expect(result).toBe('USD');
  });

  it('set EUR → get returns EUR', async () => {
    const dao = makeDao();
    await setBaseCurrency(dao, 'EUR');
    const result = await getBaseCurrency(dao);
    expect(result).toBe('EUR');
  });
});

describe('getBaseCurrency — unset → loud specific error', () => {
  it('throws BaseCurrencyNotSetError when no value is stored', async () => {
    const dao = makeDao(undefined);
    await expect(getBaseCurrency(dao)).rejects.toBeInstanceOf(BaseCurrencyNotSetError);
  });

  it('the error message names the missing setting context', async () => {
    const dao = makeDao(undefined);
    const err = await getBaseCurrency(dao).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(BaseCurrencyNotSetError);
    expect((err as Error).message).toMatch(/Base currency is not set/);
    expect((err as Error).message).toMatch(/use_base/);
  });

  it('throws BaseCurrencyNotSetError when stored value is empty string', async () => {
    const emptyDao: UserSettingsDAO = {
      getSetting: vi.fn().mockResolvedValue(''),
      setSetting: vi.fn().mockResolvedValue(undefined),
      removeSetting: vi.fn().mockResolvedValue(false),
      getAllSettings: vi.fn().mockResolvedValue({}),
    } as UserSettingsDAO;
    await expect(getBaseCurrency(emptyDao)).rejects.toBeInstanceOf(BaseCurrencyNotSetError);
  });
});

describe('getBaseCurrencyOrNull — the 2.7 gate probe (decision 1: no exception-driven control flow)', () => {
  it('returns null when no value is stored (NOT a throw)', async () => {
    const dao = makeDao(undefined);
    await expect(getBaseCurrencyOrNull(dao)).resolves.toBeNull();
  });

  it('returns null when the stored value is an empty string', async () => {
    const emptyDao: UserSettingsDAO = {
      getSetting: vi.fn().mockResolvedValue(''),
      setSetting: vi.fn().mockResolvedValue(undefined),
      removeSetting: vi.fn().mockResolvedValue(false),
      getAllSettings: vi.fn().mockResolvedValue({}),
    } as UserSettingsDAO;
    await expect(getBaseCurrencyOrNull(emptyDao)).resolves.toBeNull();
  });

  it('returns the stored ISO code after setBaseCurrency', async () => {
    const dao = makeDao();
    await setBaseCurrency(dao, 'PLN');
    await expect(getBaseCurrencyOrNull(dao)).resolves.toBe('PLN');
  });

  it('the loud-throw variant STAYS for use_base resolution (both coexist)', async () => {
    const dao = makeDao(undefined);
    await expect(getBaseCurrency(dao)).rejects.toBeInstanceOf(BaseCurrencyNotSetError);
    await expect(getBaseCurrencyOrNull(dao)).resolves.toBeNull();
  });
});

describe('setBaseCurrency — ISO validation via 1.6 reference', () => {
  it('rejects unknown ISO code with InvalidBaseCurrencyError', async () => {
    const dao = makeDao();
    await expect(setBaseCurrency(dao, 'INVALID')).rejects.toBeInstanceOf(InvalidBaseCurrencyError);
  });

  it('rejects empty string', async () => {
    const dao = makeDao();
    await expect(setBaseCurrency(dao, '')).rejects.toBeInstanceOf(InvalidBaseCurrencyError);
  });

  it('rejects lowercase iso code that is not in dataset', async () => {
    const dao = makeDao();
    // 'uah' lowercase — not in the byCode map (codes are uppercase in dataset)
    await expect(setBaseCurrency(dao, 'uah')).rejects.toBeInstanceOf(InvalidBaseCurrencyError);
  });

  it('accepts valid ISO codes: UAH, USD, EUR, PLN, GBP', async () => {
    for (const code of ['UAH', 'USD', 'EUR', 'PLN', 'GBP']) {
      const dao = makeDao();
      await expect(setBaseCurrency(dao, code)).resolves.toBeUndefined();
    }
  });

  it('does NOT call dao.setSetting for invalid ISO', async () => {
    const dao = makeDao();
    await setBaseCurrency(dao, 'BOGUS').catch(() => {});
    expect(dao.setSetting).not.toHaveBeenCalled();
  });

  it('the error message includes the rejected code', async () => {
    const dao = makeDao();
    const err = await setBaseCurrency(dao, 'XYZ999').catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(InvalidBaseCurrencyError);
    expect((err as Error).message).toMatch(/XYZ999/);
  });
});
