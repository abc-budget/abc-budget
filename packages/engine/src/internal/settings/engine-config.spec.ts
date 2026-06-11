/**
 * Tests for the store-backed engine-config module.
 * @module internal/settings/engine-config.spec
 *
 * Story 2.4, Task 1 — failing-suite-first per plan checklist.
 *
 * Contracts:
 *   - pre-hydrate: getEngineConfig() returns pure ENT-016 defaults.
 *   - hydrate with empty store ≡ pure defaults (fresh-install determinism).
 *   - hydrate with stored overrides → snapshot = defaults ⊕ overrides (partial).
 *   - setEngineParam out-of-range → loud typed InvalidEngineParamError; store
 *     UNTOUCHED; snapshot UNTOUCHED.
 *   - THE TRIPLE PIN (founder note): (1) setEngineParam mid-session → same-session
 *     getEngineConfig() UNCHANGED; (2) value IS in the store; (3) re-hydrate → new
 *     value visible. One test, three asserts, in that order.
 *   - resetEngineConfigForTests() restores pristine defaults (test seam).
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  getEngineConfig,
  hydrateEngineConfig,
  setEngineParam,
  InvalidEngineParamError,
  resetEngineConfigForTests,
} from './engine-config';
import { SettingKeys, type UserSettingsDAO } from './user-settings';
import { UserSettingsIDBDAO } from './user-settings-idb';
import { openEngineDb, resetPersistenceForTests } from '../persistence/engine-db';

// ── ENT-016 defaults ──────────────────────────────────────────────────────────

const DEFAULTS = {
  acceptableParseDatePercentage: 90,
  acceptableColumnErrorPercentage: 0.3,
  successStatusThreshold: 0.8,
  recallAutoDetectEnabled: false,
} as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Creates a real IDB-backed DAO connected to the v3 engine DB. */
async function makeRealDao(): Promise<UserSettingsDAO> {
  const db = await openEngineDb();
  return new UserSettingsIDBDAO(() => db);
}

/** Creates a lightweight in-memory DAO for fast unit tests. */
function makeMemoryDao(initial: Record<string, unknown> = {}): UserSettingsDAO {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    getSetting: <T>(key: string) => Promise.resolve(store.get(key) as T | undefined),
    setSetting: <T>(key: string, value: T) => {
      store.set(key, value);
      return Promise.resolve();
    },
    removeSetting: (key: string) => {
      const had = store.has(key);
      store.delete(key);
      return Promise.resolve(had);
    },
    getAllSettings: () =>
      Promise.resolve(Object.fromEntries(store)),
  };
}

// ── Baseline ──────────────────────────────────────────────────────────────────

describe('engine-config — pre-hydrate baseline', () => {
  beforeEach(() => {
    resetEngineConfigForTests();
  });

  it('getEngineConfig() returns pure ENT-016 defaults before any hydrate', () => {
    const cfg = getEngineConfig();
    expect(cfg.acceptableParseDatePercentage).toBe(90);
    expect(cfg.acceptableColumnErrorPercentage).toBe(0.3);
    expect(cfg.successStatusThreshold).toBe(0.8);
    expect(cfg.recallAutoDetectEnabled).toBe(false);
  });
});

// ── Empty store ───────────────────────────────────────────────────────────────

describe('engine-config — hydrate with empty store ≡ defaults', () => {
  beforeEach(() => {
    resetEngineConfigForTests();
  });

  it('hydrate with empty store leaves all fields at defaults', async () => {
    const dao = makeMemoryDao();
    await hydrateEngineConfig(dao);
    expect(getEngineConfig()).toEqual(DEFAULTS);
  });
});

// ── Partial override ──────────────────────────────────────────────────────────

describe('engine-config — hydrate with stored overrides', () => {
  beforeEach(() => {
    resetEngineConfigForTests();
  });

  it('one key stored → that key overridden, other three remain at defaults', async () => {
    const dao = makeMemoryDao({
      [SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE]: 0.1,
    });
    await hydrateEngineConfig(dao);
    const cfg = getEngineConfig();
    expect(cfg.acceptableColumnErrorPercentage).toBe(0.1);
    // remaining three at defaults
    expect(cfg.acceptableParseDatePercentage).toBe(90);
    expect(cfg.successStatusThreshold).toBe(0.8);
    expect(cfg.recallAutoDetectEnabled).toBe(false);
  });

  it('all four keys stored → all four overridden', async () => {
    const dao = makeMemoryDao({
      [SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE]: 75,
      [SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE]: 0.2,
      [SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD]: 0.6,
      [SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED]: true,
    });
    await hydrateEngineConfig(dao);
    const cfg = getEngineConfig();
    expect(cfg.acceptableParseDatePercentage).toBe(75);
    expect(cfg.acceptableColumnErrorPercentage).toBe(0.2);
    expect(cfg.successStatusThreshold).toBe(0.6);
    expect(cfg.recallAutoDetectEnabled).toBe(true);
  });
});

// ── THE TRIPLE PIN ────────────────────────────────────────────────────────────

describe('engine-config — TRIPLE PIN: session-frozen snapshot (decision 1)', () => {
  beforeEach(() => {
    resetEngineConfigForTests();
    resetPersistenceForTests();
  });

  it(
    'setEngineParam mid-session leaves snapshot unchanged; ' +
      'value IS in store; re-hydrate makes it visible',
    async () => {
      const dao = makeMemoryDao();

      // Establish a session by hydrating (empty store → defaults).
      await hydrateEngineConfig(dao);
      const snapshotBefore = getEngineConfig().acceptableColumnErrorPercentage;
      expect(snapshotBefore).toBe(0.3); // sanity

      // (1) setEngineParam mid-session → same-session getEngineConfig() UNCHANGED.
      await setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 0.05);
      expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(snapshotBefore);

      // (2) Value IS in the store (DAO read).
      const storedValue = await dao.getSetting<number>(
        SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE,
      );
      expect(storedValue).toBe(0.05);

      // (3) Re-hydrate → new value visible.
      await hydrateEngineConfig(dao);
      expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(0.05);
    },
  );
});

// ── Validation: out-of-range throws InvalidEngineParamError ──────────────────

describe('engine-config — setEngineParam validation matrix', () => {
  beforeEach(async () => {
    resetEngineConfigForTests();
    await hydrateEngineConfig(makeMemoryDao());
  });

  // acceptableParseDatePercentage ∈ [0, 100]
  it('acceptableParseDatePercentage: value below 0 → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE, -1),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('acceptableParseDatePercentage: value above 100 → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE, 101),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('acceptableParseDatePercentage: 0 is valid (boundary)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE, 0),
    ).resolves.toBeUndefined();
  });

  it('acceptableParseDatePercentage: 100 is valid (boundary)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE, 100),
    ).resolves.toBeUndefined();
  });

  // acceptableColumnErrorPercentage ∈ [0, 1]
  it('acceptableColumnErrorPercentage: value below 0 → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, -0.1),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('acceptableColumnErrorPercentage: value above 1 → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 1.1),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('acceptableColumnErrorPercentage: 0 is valid (boundary)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 0),
    ).resolves.toBeUndefined();
  });

  it('acceptableColumnErrorPercentage: 1 is valid (boundary)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, 1),
    ).resolves.toBeUndefined();
  });

  // successStatusThreshold ∈ [0, 1]
  it('successStatusThreshold: value below 0 → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD, -0.1),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('successStatusThreshold: value above 1 → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD, 1.5),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('successStatusThreshold: 0 is valid (boundary)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD, 0),
    ).resolves.toBeUndefined();
  });

  it('successStatusThreshold: 1 is valid (boundary)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD, 1),
    ).resolves.toBeUndefined();
  });

  // recallAutoDetectEnabled must be boolean
  it('recallAutoDetectEnabled: number → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED, 1 as unknown as boolean),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('recallAutoDetectEnabled: string → InvalidEngineParamError', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(
        dao,
        SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED,
        'true' as unknown as boolean,
      ),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('recallAutoDetectEnabled: true is valid', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED, true),
    ).resolves.toBeUndefined();
  });

  it('recallAutoDetectEnabled: false is valid', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED, false),
    ).resolves.toBeUndefined();
  });

  // Non-finite numbers rejected
  it('NaN → InvalidEngineParamError (acceptableParseDatePercentage)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE, NaN),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('Infinity → InvalidEngineParamError (successStatusThreshold)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD, Infinity),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });

  it('-Infinity → InvalidEngineParamError (acceptableColumnErrorPercentage)', async () => {
    const dao = makeMemoryDao();
    await expect(
      setEngineParam(dao, SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE, -Infinity),
    ).rejects.toBeInstanceOf(InvalidEngineParamError);
  });
});

// ── Validation: store and snapshot are untouched on error ────────────────────

describe('engine-config — out-of-range: store UNTOUCHED, snapshot UNTOUCHED', () => {
  it('store is not written on out-of-range setEngineParam', async () => {
    resetEngineConfigForTests();
    const dao = makeMemoryDao();
    await hydrateEngineConfig(dao);

    await setEngineParam(
      dao,
      SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE,
      -99,
    ).catch(() => {});
    const stored = await dao.getSetting<number>(
      SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE,
    );
    expect(stored).toBeUndefined();
  });

  it('snapshot is not mutated on out-of-range setEngineParam', async () => {
    resetEngineConfigForTests();
    const dao = makeMemoryDao();
    await hydrateEngineConfig(dao);

    const before = getEngineConfig().acceptableColumnErrorPercentage;
    await setEngineParam(
      dao,
      SettingKeys.ENGINE_ACCEPTABLE_COLUMN_ERROR_PERCENTAGE,
      -99,
    ).catch(() => {});
    expect(getEngineConfig().acceptableColumnErrorPercentage).toBe(before);
  });
});

// ── resetEngineConfigForTests seam ───────────────────────────────────────────

describe('engine-config — resetEngineConfigForTests()', () => {
  it('restores pristine defaults after overrides have been hydrated', async () => {
    const dao = makeMemoryDao({
      [SettingKeys.ENGINE_ACCEPTABLE_PARSE_DATE_PERCENTAGE]: 50,
      [SettingKeys.ENGINE_RECALL_AUTO_DETECT_ENABLED]: true,
    });
    await hydrateEngineConfig(dao);
    // confirm overrides are active
    expect(getEngineConfig().acceptableParseDatePercentage).toBe(50);
    expect(getEngineConfig().recallAutoDetectEnabled).toBe(true);

    // reset
    resetEngineConfigForTests();
    expect(getEngineConfig()).toEqual(DEFAULTS);
  });
});

// ── Real IDB round-trip ───────────────────────────────────────────────────────

describe('engine-config — real IDB round-trip (fake-indexeddb)', () => {
  beforeEach(() => {
    resetEngineConfigForTests();
    resetPersistenceForTests();
  });

  it('setEngineParam persists to v3 userSettings store; re-hydrate picks it up', async () => {
    const dao = await makeRealDao();

    await hydrateEngineConfig(dao);
    await setEngineParam(dao, SettingKeys.ENGINE_SUCCESS_STATUS_THRESHOLD, 0.65);

    // Not in current snapshot
    expect(getEngineConfig().successStatusThreshold).toBe(0.8);

    // Re-hydrate picks it up
    await hydrateEngineConfig(dao);
    expect(getEngineConfig().successStatusThreshold).toBe(0.65);
  });
});
