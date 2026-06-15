/**
 * Footprint DAO — IndexedDB implementation.
 * @module internal/footprint/footprint-dao
 * @internal
 *
 * SCOPE FENCE (Story 3.3 Task 4): single-record `put` + `getAll` over the
 * `footprint` store ONLY. The multi-record upsert/dedup BATCH write path, the
 * zero-growth re-import proof, the count-matches-bank proof, and the `hash`
 * non-unique lookup index are STORY 3.4 — explicitly out of scope here.
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
}
