/**
 * Tests for FootprintDao — Story 3.3 Task 4 (put + getAll) and Story 3.4 Task 2
 * (findByHash + atomic putBatch).
 *
 * Story 3.4 NOTE: the `findByHash` tests need the `hash` non-unique lookup index,
 * which migration v5 (a sibling 3.4 task) adds to the `footprint` store. The
 * harness therefore opens the engine DB through the REAL `ENGINE_MIGRATIONS`
 * lineage (not a hand-rolled store), so the index exists once v5 has landed.
 *
 * Harness mirrors internal/exchange-rate/dao.spec.ts (compound keyPath, direct
 * construction via an openTestDb opened through the migration framework).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FootprintDao } from './footprint-dao';
import type { FootprintRecord } from './types';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/**
 * Opens a test DB with the footprint store via the REAL engine migration
 * lineage, so the `hash` lookup index (migration v5) is present for findByHash.
 */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
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

  // ── Story 3.4 (Task 2): findByHash over the `hash` lookup index ─────────────
  describe('findByHash', () => {
    it('returns the single row whose hash matches', async () => {
      const records: FootprintRecord[] = [
        { year: 2026, month: 1, amountUSD: 10, categoryId: null, hash: 'h-a' },
        { year: 2026, month: 2, amountUSD: 20, categoryId: null, hash: 'h-b' },
        { year: 2026, month: 3, amountUSD: 30, categoryId: null, hash: 'h-c' },
      ];
      await dao.putBatch(records);

      const found = await dao.findByHash('h-b');

      expect(found).toHaveLength(1);
      expect(found[0]).toEqual(records[1]);
    });

    it('returns [] for an absent hash', async () => {
      await dao.putBatch([
        { year: 2026, month: 1, amountUSD: 10, categoryId: null, hash: 'h-a' },
      ]);

      expect(await dao.findByHash('nope')).toEqual([]);
    });
  });

  // ── Story 3.4 (Task 2): single-transaction atomic putBatch ──────────────────
  describe('putBatch', () => {
    it('writes N records in ONE call → getAll().length === N', async () => {
      const records: FootprintRecord[] = [
        { year: 2026, month: 1, amountUSD: 1, categoryId: null, hash: 'h-1' },
        { year: 2026, month: 2, amountUSD: 2, categoryId: null, hash: 'h-2' },
        { year: 2026, month: 3, amountUSD: 3, categoryId: null, hash: 'h-3' },
        { year: 2026, month: 4, amountUSD: 4, categoryId: null, hash: 'h-4' },
      ];

      await dao.putBatch(records);

      expect(await dao.getAll()).toHaveLength(records.length);
    });

    it('is idempotent: re-putting the SAME triples keeps the count and applies last-write-wins on non-key fields', async () => {
      const first: FootprintRecord[] = [
        { year: 2026, month: 1, amountUSD: 1, categoryId: null, hash: 'h-1' },
        { year: 2026, month: 2, amountUSD: 2, categoryId: null, hash: 'h-2' },
      ];
      await dao.putBatch(first);
      expect(await dao.getAll()).toHaveLength(2);

      // Same [hash,year,month] triples; amountUSD changed on the second batch.
      const second: FootprintRecord[] = [
        { year: 2026, month: 1, amountUSD: 111, categoryId: null, hash: 'h-1' },
        { year: 2026, month: 2, amountUSD: 222, categoryId: null, hash: 'h-2' },
      ];
      await dao.putBatch(second);

      // Count UNCHANGED — native [hash,year,month] upsert overwrote in place.
      expect(await dao.getAll()).toHaveLength(2);
      // Last write wins: the second batch's amountUSD is what's stored.
      const row1 = await dao.findByHash('h-1');
      expect(row1[0].amountUSD).toBe(111);
      const row2 = await dao.findByHash('h-2');
      expect(row2[0].amountUSD).toBe(222);
    });

    it('putBatch([]) is a no-op (no throw, count unchanged)', async () => {
      await dao.putBatch([
        { year: 2026, month: 1, amountUSD: 1, categoryId: null, hash: 'h-1' },
      ]);
      expect(await dao.getAll()).toHaveLength(1);

      await expect(dao.putBatch([])).resolves.toBeUndefined();
      expect(await dao.getAll()).toHaveLength(1);
    });
  });
});
