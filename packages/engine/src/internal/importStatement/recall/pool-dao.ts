/**
 * RecallPool DAO — IndexedDB implementation.
 * @module importStatement/recall/pool-dao
 * @internal
 *
 * Mirrors the IDBBatchDao subclass pattern from internal/exchange-rate/dao.ts.
 * Store: 'recallPool', keyPath: 'columnName' (created in migration v3).
 */

import type { DbProvider } from '../../store/idb/dao-impl';
import { IDBBatchDao } from '../../store/idb/dao-impl';
import type { ColumnDefinition, ColumnParams } from '../types';

/**
 * Name of the recall pool store in IndexedDB.
 */
export const RECALL_POOL_STORE = 'recallPool';

/**
 * A single entry in the recall pool.
 *
 * The `columnName` field is the NORMALIZED key (NFC + trim applied before save — LD-2).
 * No timestamps — LWW is structural (confirmSave overwrites; no Date.now in entries).
 */
export interface RecallPoolEntry {
  /** Normalized column name (NFC + trim) — the IDB key. */
  readonly columnName: string;
  /** The column definition (type). */
  readonly definition: ColumnDefinition;
  /** Optional params for this column type. Null if none. */
  readonly params: ColumnParams | null;
}

/**
 * IndexedDB implementation of the recall pool DAO.
 * Subclass of IDBBatchDao following the 1.2 dao-impl pattern.
 */
export class IDBRecallPoolDAO extends IDBBatchDao<string, RecallPoolEntry> {
  /**
   * Creates a new IDBRecallPoolDAO.
   * @param dbProvider - Provides the open database instance
   */
  constructor(dbProvider: DbProvider) {
    super(dbProvider, {
      storeName: RECALL_POOL_STORE,
      keyPath: 'columnName',
      keyExtractor: (entry: RecallPoolEntry): string => entry.columnName,
    });
  }

  /**
   * Gets a single entry by normalized column name.
   */
  async getEntry(normalizedName: string): Promise<RecallPoolEntry | null> {
    return this.read(normalizedName);
  }

  /**
   * Writes an entry (upsert — LWW semantics after confirmSave).
   */
  async putEntry(entry: RecallPoolEntry): Promise<void> {
    await this.upsert(entry);
  }
}
