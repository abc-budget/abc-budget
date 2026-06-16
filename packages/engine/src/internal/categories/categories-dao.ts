/**
 * Categories DAO — IndexedDB implementation (Story 4.3a Task 3, ENT-018).
 * @module internal/categories/categories-dao
 * @internal
 *
 * SCOPE: an `IDBDao<string, Category>` over the `categories` store (created by
 * migration v6, a sibling 4.3a task). DAO only — NO service logic (no
 * validation, no «base» resolution, no id generation; the entity supplies its
 * own service-minted string id — that's Task 4).
 *
 * Mirrors the IDBDao subclass pattern from internal/footprint/footprint-dao.ts
 * and internal/exchange-rate/dao.ts. Store: 'categories', keyPath:'id' (single
 * STRING keyPath, like userSettings keyPath:'key') — NO autoIncrement, so the
 * entity's own `id` flows through `create` untouched.
 *
 * PORTS the prior-art CategoriesDAO surface (getActive / getArchived /
 * getByCurrency) from webapp/libs/engine/src/categories/dao.ts.
 */

import type { DbProvider } from '../store/idb/dao-impl';
import { IDBDao } from '../store/idb/dao-impl';
import type { Category } from './types';

/**
 * Name of the categories store in IndexedDB.
 */
export const CATEGORIES_STORE = 'categories';

/**
 * IndexedDB implementation of the categories DAO.
 *
 * Key is the entity's own STRING `id` (single keyPath:'id', NO autoIncrement) —
 * the service mints it before persisting (Task 4); this DAO never generates one.
 */
export class CategoriesDAO extends IDBDao<string, Category> {
  /**
   * Creates a new CategoriesDAO.
   * @param dbProvider - Provides the open database instance
   */
  constructor(dbProvider: DbProvider) {
    super(dbProvider, {
      storeName: CATEGORIES_STORE,
      keyPath: 'id',
      keyExtractor: (entity: Category): string => entity.id as string,
    });
  }

  /**
   * Returns all non-archived categories (`isArchived === false`).
   *
   * NOTE: implemented by filtering `list()` rather than `findByIndex('isArchived', …)`.
   * IndexedDB cannot index a boolean key reliably across engines (booleans are
   * not valid index keys per spec; fake-indexeddb rejects them), so the
   * `isArchived` index — though present in the v6 store for forward use — is NOT
   * queried here. Filtering `list()` is the simpler, robust path.
   */
  async getActive(): Promise<Category[]> {
    return this.find((c) => c.isArchived === false);
  }

  /**
   * Returns all archived categories (`isArchived === true`).
   *
   * Filters `list()` for the same boolean-index reason as {@link getActive}.
   */
  async getArchived(): Promise<Category[]> {
    return this.find((c) => c.isArchived === true);
  }

  /**
   * Returns all categories with the given currency code, via the `currency`
   * non-unique index (created in migration v6). Currency is a string, so the
   * index query is safe here.
   * @param code - The currency ISO code (or the living «base» sentinel)
   */
  async getByCurrency(code: string): Promise<Category[]> {
    return this.findByIndex('currency', code);
  }
}
