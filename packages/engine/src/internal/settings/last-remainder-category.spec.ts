/**
 * Tests for last-remainder-category helpers.
 * @module internal/settings/last-remainder-category.spec
 *
 * Story 4.6, Task 1 (decision C) — new spec.
 *
 * Contracts:
 *   - set/get round-trips a string id
 *   - getLastRemainderCategoryId unset → null (no throw — unset is a normal default)
 *   - setLastRemainderCategoryId overwrite → last value wins
 */

import { describe, it, expect, vi } from 'vitest';
import {
  getLastRemainderCategoryId,
  setLastRemainderCategoryId,
} from './last-remainder-category';
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

describe('setLastRemainderCategoryId + getLastRemainderCategoryId round-trip', () => {
  it('set a category id → get returns the same id', async () => {
    const dao = makeDao();
    await setLastRemainderCategoryId(dao, 'cat-other-123');
    const result = await getLastRemainderCategoryId(dao);
    expect(result).toBe('cat-other-123');
  });
});

describe('getLastRemainderCategoryId — unset → null (normal default, no throw)', () => {
  it('returns null when no value is stored', async () => {
    const dao = makeDao(undefined);
    await expect(getLastRemainderCategoryId(dao)).resolves.toBeNull();
  });

  it('returns null when the stored value is an empty string', async () => {
    const emptyDao: UserSettingsDAO = {
      getSetting: vi.fn().mockResolvedValue(''),
      setSetting: vi.fn().mockResolvedValue(undefined),
      removeSetting: vi.fn().mockResolvedValue(false),
      getAllSettings: vi.fn().mockResolvedValue({}),
    } as UserSettingsDAO;
    await expect(getLastRemainderCategoryId(emptyDao)).resolves.toBeNull();
  });
});

describe('setLastRemainderCategoryId — overwrite is last-write-wins', () => {
  it('a second set replaces the first; get returns the latest id', async () => {
    const dao = makeDao();
    await setLastRemainderCategoryId(dao, 'cat-first');
    await setLastRemainderCategoryId(dao, 'cat-second');
    const result = await getLastRemainderCategoryId(dao);
    expect(result).toBe('cat-second');
  });
});
