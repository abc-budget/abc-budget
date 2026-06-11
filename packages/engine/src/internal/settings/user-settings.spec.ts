/**
 * Tests for UserSettingsServiceImpl.
 *
 * PORT of webapp/libs/engine/src/settings/user-settings.spec.ts.
 * Adaptations:
 *   - Container/IoC wiring replaced with direct constructor injection.
 *   - AbcEngine / createAbcEngine bootstrapping removed; tests instantiate
 *     UserSettingsServiceImpl directly with a DAO mock or a real IDB-backed DAO.
 *   - 'jest' → vitest API (vi.fn(), describe, it, expect, beforeEach, afterEach).
 *   - firstValueFrom from rxjs kept (verbatim).
 *   - BroadcastChannel mock pattern preserved verbatim.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { firstValueFrom } from 'rxjs';
import {
  InvalidSettingError,
  SettingKeys,
  UserSettingsServiceImpl,
  type UserSettingsDAO,
} from './user-settings';
import { UserSettingsIDBDAO } from './user-settings-idb';
import { openEngineDb, resetPersistenceForTests } from '../persistence/engine-db';
import type { UserSettingsValidator } from './types';

// ── Mock helpers ──────────────────────────────────────────────────────────────

function makeMockDao(overrides: Partial<UserSettingsDAO> = {}): UserSettingsDAO {
  return {
    getSetting: vi.fn().mockResolvedValue(undefined),
    setSetting: vi.fn().mockResolvedValue(undefined),
    removeSetting: vi.fn().mockResolvedValue(false),
    getAllSettings: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as UserSettingsDAO;
}

class MockCurrencyValidator implements UserSettingsValidator {
  key = SettingKeys.BASE_CURRENCY;
  validate(value: unknown): boolean {
    return typeof value === 'string' && ['USD', 'EUR', 'GBP', 'UAH'].includes(value);
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('UserSettingsServiceImpl — core API', () => {
  it('getSetting delegates to the DAO', async () => {
    const dao = makeMockDao({
      getSetting: vi.fn().mockResolvedValue('testValue'),
    });
    const svc = new UserSettingsServiceImpl(dao);
    const result = await svc.getSetting('testKey');
    expect(result).toBe('testValue');
    expect(dao.getSetting).toHaveBeenCalledWith('testKey');
  });

  it('setSetting delegates to the DAO and updates the BehaviorSubject', async () => {
    const dao = makeMockDao();
    const svc = new UserSettingsServiceImpl(dao);
    await svc.setSetting('k', 'v');
    expect(dao.setSetting).toHaveBeenCalledWith('k', 'v');
    const settings = await firstValueFrom(svc.getAllSettings<Record<string, unknown>>());
    expect(settings['k']).toBe('v');
  });

  it('returns undefined for non-existent settings', async () => {
    const svc = new UserSettingsServiceImpl(makeMockDao());
    const result = await svc.getSetting('nonExistent');
    expect(result).toBeUndefined();
  });

  it('validates settings using validators — valid value passes', async () => {
    const dao = makeMockDao();
    const svc = new UserSettingsServiceImpl(dao, [new MockCurrencyValidator()]);
    await expect(svc.setBaseCurrency('USD')).resolves.toBeUndefined();
  });

  it('validates settings using validators — invalid value throws InvalidSettingError', async () => {
    const svc = new UserSettingsServiceImpl(makeMockDao(), [new MockCurrencyValidator()]);
    await expect(svc.setBaseCurrency('INVALID')).rejects.toBeInstanceOf(InvalidSettingError);
  });
});

describe('UserSettingsServiceImpl — base currency', () => {
  it('allows getting and setting base currency', async () => {
    let stored: unknown = undefined;
    const dao = makeMockDao({
      getSetting: vi.fn().mockImplementation(() => Promise.resolve(stored)),
      setSetting: vi.fn().mockImplementation((_k: string, v: unknown) => {
        stored = v;
        return Promise.resolve();
      }),
    });
    const svc = new UserSettingsServiceImpl(dao);
    await svc.setBaseCurrency('EUR');
    const result = await svc.getBaseCurrency();
    expect(result).toBe('EUR');
  });

  it('returns undefined if base currency is not set', async () => {
    const svc = new UserSettingsServiceImpl(makeMockDao());
    const result = await svc.getBaseCurrency();
    expect(result).toBeUndefined();
  });
});

describe('UserSettingsServiceImpl — Observable settings', () => {
  it('returns an observable of all settings', async () => {
    const dao = makeMockDao();
    const svc = new UserSettingsServiceImpl(dao);
    await svc.setSetting('k1', 'v1');
    await svc.setSetting('k2', 'v2');
    const settings = await firstValueFrom(svc.getAllSettings<Record<string, unknown>>());
    expect(settings).toMatchObject({ k1: 'v1', k2: 'v2' });
  });

  it('emits updated settings when a setting is changed', async () => {
    const dao = makeMockDao();
    const svc = new UserSettingsServiceImpl(dao);
    await svc.setSetting('k', 'initial');
    const obs = svc.getAllSettings<Record<string, unknown>>();
    await svc.setSetting('k', 'updated');
    const settings = await firstValueFrom(obs);
    expect(settings['k']).toBe('updated');
  });
});

describe('UserSettingsServiceImpl — init + BroadcastChannel', () => {
  interface GlobalWithBC {
    BroadcastChannel?: typeof BroadcastChannel;
  }

  interface MockBC {
    postMessage: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    onmessage: ((event: MessageEvent) => void) | null;
  }

  let originalBC: typeof BroadcastChannel | undefined;
  let mockBC: MockBC;

  beforeEach(() => {
    const g = globalThis as unknown as GlobalWithBC;
    originalBC = g.BroadcastChannel;
    mockBC = { postMessage: vi.fn(), close: vi.fn(), onmessage: null };
    g.BroadcastChannel = vi.fn().mockImplementation(() => mockBC) as typeof BroadcastChannel;
  });

  afterEach(() => {
    const g = globalThis as unknown as GlobalWithBC;
    g.BroadcastChannel = originalBC;
  });

  it('sets up BroadcastChannel during init', async () => {
    const dao = makeMockDao();
    const svc = new UserSettingsServiceImpl(dao);
    await svc.init();
    expect(globalThis.BroadcastChannel).toHaveBeenCalledWith('user-settings-channel');
  });

  it('broadcasts changes when setting is updated', async () => {
    const dao = makeMockDao();
    const svc = new UserSettingsServiceImpl(dao);
    await svc.init();
    await svc.setSetting('testKey', 'testValue');
    expect(mockBC.postMessage).toHaveBeenCalledWith({
      key: 'testKey',
      value: 'testValue',
      source: expect.any(String),
    });
  });

  it('updates settings when receiving broadcast message', async () => {
    const dao = makeMockDao();
    const svc = new UserSettingsServiceImpl(dao);
    await svc.init();

    const messageEvent = { data: { key: 'broadcastKey', value: 'broadcastValue' } } as MessageEvent;
    if (mockBC.onmessage) {
      mockBC.onmessage(messageEvent);
    }

    const settings = await firstValueFrom(svc.getAllSettings<Record<string, string>>());
    expect(settings['broadcastKey']).toBe('broadcastValue');
  });

  it('init loads settings from DAO', async () => {
    const dao = makeMockDao({
      getAllSettings: vi.fn().mockResolvedValue({ s1: 'v1', s2: 'v2' }),
    });
    const svc = new UserSettingsServiceImpl(dao);
    await svc.init();
    const settings = await firstValueFrom(svc.getAllSettings<Record<string, string>>());
    expect(settings).toEqual({ s1: 'v1', s2: 'v2' });
  });
});

describe('UserSettingsIDBDAO — real IDB round-trip', () => {
  afterEach(() => {
    resetPersistenceForTests();
  });

  it('set/get/getAllSettings/remove round-trip against v3 DB', async () => {
    const db = await openEngineDb();
    const dao = new UserSettingsIDBDAO(() => db);

    // set + get
    await dao.setSetting('baseCurrency', 'UAH');
    const got = await dao.getSetting<string>('baseCurrency');
    expect(got).toBe('UAH');

    // getAllSettings
    const all = await dao.getAllSettings();
    expect(all['baseCurrency']).toBe('UAH');

    // update
    await dao.setSetting('baseCurrency', 'USD');
    const updated = await dao.getSetting<string>('baseCurrency');
    expect(updated).toBe('USD');

    // remove
    const removed = await dao.removeSetting('baseCurrency');
    expect(removed).toBe(true);
    const afterRemove = await dao.getSetting<string>('baseCurrency');
    expect(afterRemove).toBeUndefined();

    // remove non-existent → false
    const removedAgain = await dao.removeSetting('baseCurrency');
    expect(removedAgain).toBe(false);
  });
});

// ── close() coverage ─────────────────────────────────────────────────────────

describe('UserSettingsServiceImpl — close', () => {
  it('closes BroadcastChannel and completes the subject', async () => {
    interface GlobalWithBC { BroadcastChannel?: typeof BroadcastChannel; }
    const g = globalThis as unknown as GlobalWithBC;
    const orig = g.BroadcastChannel;
    const mockClose = vi.fn();
    const bc = { postMessage: vi.fn(), close: mockClose, onmessage: null };
    g.BroadcastChannel = vi.fn().mockImplementation(() => bc) as typeof BroadcastChannel;

    try {
      const dao = makeMockDao();
      const svc = new UserSettingsServiceImpl(dao);
      await svc.init();
      svc.close();
      expect(mockClose).toHaveBeenCalled();
    } finally {
      g.BroadcastChannel = orig;
    }
  });
});
