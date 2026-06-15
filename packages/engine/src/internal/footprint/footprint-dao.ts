/**
 * Footprint DAO — IndexedDB implementation.
 * @module internal/footprint/footprint-dao
 * @internal
 *
 * SCOPE (Story 3.4 Task 2): adds `findByHash` (lookup over the `hash` non-unique
 * index) and `putBatch` (single-transaction atomic multi-record upsert) on top of
 * the Story 3.3 `put` + `getAll`. The `hash` index itself is created by migration
 * v5 (a sibling 3.4 task); this DAO consumes it via the IDBDao `findByIndex` seam.
 *
 * Mirrors the IDBDao subclass + compound-keyPath pattern from
 * internal/exchange-rate/dao.ts and internal/importStatement/recall/pool-dao.ts.
 * Store: 'footprint', keyPath: ['hash', 'year', 'month'] (created in migration v4).
 */

import type { DbProvider } from '../store/idb/dao-impl';
import { IDBDao } from '../store/idb/dao-impl';
import type { CompoundKey } from '../store/key';
import type { FootprintRecord } from './types';

/**
 * Name of the footprint store in IndexedDB.
 */
export const FOOTPRINT_STORE = 'footprint';

/**
 * The composite key for a footprint row: the [hash, year, month] triple.
 */
export interface FootprintKey extends CompoundKey {
  hash: string;
  year: number;
  month: number;
}

/**
 * IndexedDB implementation of the footprint DAO.
 * Subclass of IDBDao following the compound-keyPath dao-impl pattern.
 */
export class FootprintDao extends IDBDao<FootprintKey, FootprintRecord> {
  /**
   * Creates a new FootprintDao.
   * @param dbProvider - Provides the open database instance
   */
  constructor(dbProvider: DbProvider) {
    super(dbProvider, {
      storeName: FOOTPRINT_STORE,
      keyPath: ['hash', 'year', 'month'],
      keyExtractor: (record: FootprintRecord): FootprintKey => ({
        hash: record.hash,
        year: record.year,
        month: record.month,
      }),
    });
  }

  /**
   * Writes a single footprint row (upsert — native [hash,year,month] idempotency:
   * a re-put of the same triple overwrites in place, last write wins).
   */
  async put(record: FootprintRecord): Promise<FootprintRecord> {
    return this.upsert(record);
  }

  /**
   * Returns every footprint row in the store.
   */
  async getAll(): Promise<FootprintRecord[]> {
    return this.list();
  }

  /**
   * Looks up footprint rows by their final `hash` via the non-unique `hash`
   * index (created in migration v5). Returns an array — the index is non-unique
   * by definition, though in practice each op's final hash maps to one row.
   */
  async findByHash(hash: string): Promise<FootprintRecord[]> {
    return this.findByIndex('hash', hash);
  }

  /**
   * Writes every record in ONE readwrite transaction (ATOMIC: a mid-batch
   * failure aborts the whole tx → zero writes). Uses native [hash,year,month]
   * upsert, so a repeated triple overwrites in place (last write wins). An empty
   * batch resolves immediately without opening a write transaction.
   */
  async putBatch(records: readonly FootprintRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const db = this.getDatabase();

    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(
          new Error(`Failed to put footprint batch: ${transaction.error?.message}`)
        );
      };
      transaction.onabort = () => {
        reject(
          new Error(`Footprint batch aborted: ${transaction.error?.message}`)
        );
      };

      for (const record of records) {
        store.put(record);
      }
    });
  }
}
