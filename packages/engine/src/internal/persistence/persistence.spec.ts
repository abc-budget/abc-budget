import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestDurability } from './durability';
import {
  ENGINE_DB_NAME,
  ENGINE_MIGRATIONS,
  initEnginePersistence,
  resetPersistenceForTests,
} from './engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

afterEach(() => {
  vi.unstubAllGlobals();
  resetPersistenceForTests();
});

describe('requestDurability', () => {
  it('returns persisted + usage/quota when the Storage API grants', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persist: async () => true,
        estimate: async () => ({ usage: 1024, quota: 2048 }),
      },
    });
    expect(await requestDurability()).toEqual({
      persisted: true,
      usageBytes: 1024,
      quotaBytes: 2048,
    });
  });

  it('records denial without throwing', async () => {
    vi.stubGlobal('navigator', {
      storage: {
        persist: async () => false,
        estimate: async () => ({ usage: 10, quota: 100 }),
      },
    });
    expect((await requestDurability()).persisted).toBe(false);
  });

  it('degrades to nulls when the Storage API is absent (node, worker spike)', async () => {
    vi.stubGlobal('navigator', undefined);
    expect(await requestDurability()).toEqual({
      persisted: false,
      usageBytes: null,
      quotaBytes: null,
    });
  });
});

describe('engine DB migration anchor', () => {
  // LEGITIMATE TEST UPDATE (Task 3, Story 1.6): v2 appended for exchangeRates store.
  // Step[0] (v1) remains a no-op anchor byte-identical to its original form.
  // Step[1] (v2) creates exactly the 'exchangeRates' object store.
  it('ENGINE_MIGRATIONS has 2 steps: v1 no-op anchor + v2 creates exchangeRates', async () => {
    expect(ENGINE_MIGRATIONS).toHaveLength(2);
    expect(ENGINE_MIGRATIONS[0].toVersion).toBe(1);
    expect(ENGINE_MIGRATIONS[1].toVersion).toBe(2);
    const db = await openDatabase(`${ENGINE_DB_NAME}-anchor-test`, ENGINE_MIGRATIONS);
    expect(db.version).toBe(2);
    expect(Array.from(db.objectStoreNames)).toEqual(['exchangeRates']);
    db.close();
  });

  it('initEnginePersistence opens the DB, requests durability, and memoizes', async () => {
    vi.stubGlobal('navigator', {
      storage: { persist: async () => true, estimate: async () => ({ usage: 1, quota: 2 }) },
    });
    const first = await initEnginePersistence();
    expect(first.opened).toBe(true);
    expect(first.durability).toEqual({ persisted: true, usageBytes: 1, quotaBytes: 2 });
    expect(await initEnginePersistence()).toBe(first); // memoized — same result object
  });

  it('is a non-fatal no-op where indexedDB is absent', async () => {
    const realIndexedDB = globalThis.indexedDB;
    vi.stubGlobal('indexedDB', undefined);
    try {
      const result = await initEnginePersistence();
      expect(result).toEqual({ opened: false, durability: null });
    } finally {
      vi.stubGlobal('indexedDB', realIndexedDB);
    }
  });
});
