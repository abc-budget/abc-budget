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
   * Loads the MANUAL (isManual=1) footprints for a set of periods via the
   * compound `year_month_isManual` index (migration v8). Powers the Story 4.4
   * load-once override map: each period is an EXACT compound point-query
   * (`IDBKeyRange.only([year, month, 1])`), so we touch only the matching rows —
   * no scan of non-matching (other-period / derived) rows.
   *
   * Periods are de-duped by (year,month) before querying. Results across periods
   * are concatenated; periods partition the store, so there are no cross-period
   * duplicate rows. Empty `periods` resolves to `[]` without opening a tx.
   */
  async getManualByPeriods(
    periods: ReadonlyArray<{ year: number; month: number }>
  ): Promise<FootprintRecord[]> {
    if (periods.length === 0) {
      return [];
    }

    // De-dupe by (year,month) so a repeated period isn't queried twice.
    const distinct = new Map<string, { year: number; month: number }>();
    for (const { year, month } of periods) {
      distinct.set(`${year}-${month}`, { year, month });
    }

    const perPeriod = await Promise.all(
      [...distinct.values()].map(({ year, month }) =>
        this.getManualForPeriod(year, month)
      )
    );
    return perPeriod.flat();
  }

  /**
   * Single-period manual load: opens the `year_month_isManual` index in a
   * readonly tx and point-queries the manual tuple for the month
   * (`[year, month, 1]`). Mirrors the readonly-tx + index seam from
   * IDBDao.findByIndex, but with a compound key range (which findByIndex's
   * single-value equality cannot express).
   */
  private getManualForPeriod(
    year: number,
    month: number
  ): Promise<FootprintRecord[]> {
    const db = this.getDatabase();

    return new Promise<FootprintRecord[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('year_month_isManual');

      const request = index.getAll(IDBKeyRange.only([year, month, 1]));

      request.onerror = () => {
        reject(
          new Error(
            `Failed to load manual footprints for ${year}-${month}: ${request.error?.message}`
          )
        );
      };
      request.onsuccess = () => {
        resolve(request.result as FootprintRecord[]);
      };
    });
  }

  /**
   * Loads ALL footprints (isManual 0 AND 1) for a set of periods via the
   * `year_month_isManual` compound index, range-querying both isManual values
   * (`IDBKeyRange.bound([year,month,0],[year,month,1])`). This is the dup-detection
   * read: a committed row's footprint may be derived (isManual=0), so the
   * manual-only `getManualByPeriods` would MISS auto-categorized dups. Period-scoped
   * (one point-range per distinct period), never a per-op or full-store scan.
   * Periods are de-duped; empty `periods` resolves to `[]` without a tx.
   */
  async getByPeriods(
    periods: ReadonlyArray<{ year: number; month: number }>
  ): Promise<FootprintRecord[]> {
    if (periods.length === 0) {
      return [];
    }
    const distinct = new Map<string, { year: number; month: number }>();
    for (const { year, month } of periods) {
      distinct.set(`${year}-${month}`, { year, month });
    }
    const perPeriod = await Promise.all(
      [...distinct.values()].map(({ year, month }) => this.getForPeriod(year, month))
    );
    return perPeriod.flat();
  }

  /**
   * Single-period all-isManual load: opens `year_month_isManual` readonly and
   * range-queries [year,month,0]..[year,month,1] (both isManual values). Mirrors
   * getManualForPeriod but with a bound range instead of only([y,m,1]).
   */
  private getForPeriod(year: number, month: number): Promise<FootprintRecord[]> {
    const db = this.getDatabase();
    return new Promise<FootprintRecord[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);
      const index = store.index('year_month_isManual');
      const request = index.getAll(IDBKeyRange.bound([year, month, 0], [year, month, 1]));
      request.onerror = () => {
        reject(new Error(`Failed to load footprints for ${year}-${month}: ${request.error?.message}`));
      };
      request.onsuccess = () => {
        resolve(request.result as FootprintRecord[]);
      };
    });
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
