/**
 * Tests for FootprintDao — Story 3.3 Task 4.
 *
 * SCOPE FENCE: single-record `put` + `getAll` ONLY. The dedup batch write path,
 * zero-growth re-import proof, count-matches-bank proof, and `hash` non-unique
 * lookup index are STORY 3.4 — not exercised here.
 *
 * Harness mirrors internal/exchange-rate/dao.spec.ts (compound keyPath, direct
 * construction via an openTestDb opened through the migration framework).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FOOTPRINT_STORE, FootprintDao } from './footprint-dao';
import type { FootprintRecord } from './types';
import type { MigrationStep } from '../store/migrations/migration';
import { openDatabase } from '../store/migrations/open-with-migrations';

/** Opens a test DB with the footprint store via the migration framework. */
function openTestDb(name: string): Promise<IDBDatabase> {
  const step: MigrationStep = {
    toVersion: 1,
    migrate: (ctx) =>
      ctx.createStore(FOOTPRINT_STORE, {
        keyPath: ['hash', 'year', 'month'],
      }),
  };
  return openDatabase(name, [step]);
}

describe('FootprintDao', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: FootprintDao;

  beforeEach(async () => {
    dbName = `test-footprint-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    dao = new FootprintDao(() => db);
  });

  afterEach(async () => {
    if (db) {
      db.close();
    }
    await new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve();
    });
  });

  it('round-trips a FootprintRecord through put then getAll (all 5 fields preserved)', async () => {
    const record: FootprintRecord = {
      year: 2026,
      month: 6,
      amountUSD: 123.45,
      categoryId: 'cat-groceries',
      hash: 'hash-abc',
    };

    await dao.put(record);
    const all = await dao.getAll();

    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(record);
  });

  it('is natively idempotent: two puts of the same [hash,year,month] triple keep one row, second value wins', async () => {
    const first: FootprintRecord = {
      year: 2026,
      month: 6,
      amountUSD: 100,
      categoryId: 'cat-old',
      hash: 'same-hash',
    };
    // Same composite key triple; non-key fields differ (amountUSD + categoryId).
    const second: FootprintRecord = {
      year: 2026,
      month: 6,
      amountUSD: 250,
      categoryId: 'cat-new',
      hash: 'same-hash',
    };

    await dao.put(first);
    await dao.put(second);
    const all = await dao.getAll();

    expect(all).toHaveLength(1);
    expect(all[0].amountUSD).toBe(250);
    expect(all[0].categoryId).toBe('cat-new');
  });

  it('keeps records distinct when any one key element differs (hash, year, or month)', async () => {
    const base: FootprintRecord = {
      year: 2026,
      month: 6,
      amountUSD: 10,
      categoryId: null,
      hash: 'h',
    };

    // Different hash.
    await dao.put(base);
    await dao.put({ ...base, hash: 'h2' });
    expect(await dao.getAll()).toHaveLength(2);

    // Different year.
    await dao.put({ ...base, year: 2025 });
    expect(await dao.getAll()).toHaveLength(3);

    // Different month.
    await dao.put({ ...base, month: 7 });
    expect(await dao.getAll()).toHaveLength(4);
  });
});
