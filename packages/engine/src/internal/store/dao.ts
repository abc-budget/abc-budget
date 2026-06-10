/**
 * Data Access Object (DAO) interfaces
 * @module store/dao
 * @internal
 */

import type { Key } from './key';

/**
 * Basic Data Access Object (DAO) interface for CRUD operations
 * @template K - The key type, extends Key (SimpleKey or CompoundKey)
 * @template E - The entity type
 */
export interface Dao<K extends Key, E> {
  /**
   * Creates a new entity
   * @param entity - The entity to create
   * @returns A promise that resolves to the created entity
   */
  create(entity: E): Promise<E>;

  /**
   * Reads an entity by its key
   * @param key - The key of the entity to read
   * @returns A promise that resolves to the entity if found, or null if not found
   */
  read(key: K): Promise<E | null>;

  /**
   * Updates an existing entity
   * @param key - The key of the entity to update
   * @param entity - The updated entity data
   * @returns A promise that resolves to the updated entity if found, or null if not found
   */
  update(key: K, entity: E): Promise<E | null>;

  /**
   * Creates a new entity or updates an existing one
   * @param entity - The entity data to upsert
   * @returns A promise that resolves to the upserted entity
   */
  upsert(entity: E): Promise<E>;

  /**
   * Deletes an entity by its key
   * @param key - The key of the entity to delete
   * @returns A promise that resolves to true if the entity was deleted, or false if not found
   */
  delete(key: K): Promise<boolean>;

  /**
   * Lists all entities
   * @returns A promise that resolves to an array of all entities
   */
  list(): Promise<E[]>;

  /**
   * Finds entities that match the given criteria
   * @param criteria - A function that takes an entity and returns true if it matches the criteria
   * @returns A promise that resolves to an array of matching entities
   */
  find(criteria: (entity: E) => boolean): Promise<E[]>;

  /**
   * Finds entities by index
   * @param indexName - The name of the index to search
   * @param value - The value to search for
   * @param criteria - Optional function to further filter the results
   * @returns A promise that resolves to an array of matching entities
   */
  findByIndex(
    indexName: string,
    value: unknown,
    criteria?: (entity: E) => boolean
  ): Promise<E[]>;

  /**
   * Gets all keys from the store
   * @returns A promise that resolves to an array of all keys
   */
  getAllKeys(): Promise<K[]>;
}

/**
 * Extended DAO interface with batch operations
 * @template K - The key type, extends Key (SimpleKey or CompoundKey)
 * @template E - The entity type
 */
export interface BatchDao<K extends Key, E> extends Dao<K, E> {
  /**
   * Creates multiple entities in a batch operation
   * @param entities - The entities to create
   * @returns A promise that resolves to the created entities
   */
  batchCreate(entities: E[]): Promise<E[]>;

  /**
   * Reads multiple entities by their keys in a batch operation
   * @param keys - The keys of the entities to read
   * @returns A promise that resolves to an array of found entities (missing entities are excluded)
   */
  batchRead(keys: K[]): Promise<E[]>;

  /**
   * Updates multiple entities in a batch operation
   * @param updates - An array of key-entity pairs to update
   * @returns A promise that resolves to the updated entities (entities not found are excluded)
   */
  batchUpdate(updates: Array<{ key: K; entity: E }>): Promise<E[]>;

  /**
   * Creates or updates multiple entities in a batch operation
   * @param entities - The entities to upsert
   * @returns A promise that resolves to the upserted entities
   */
  batchUpsert(entities: E[]): Promise<E[]>;

  /**
   * Deletes multiple entities by their keys in a batch operation
   * @param keys - The keys of the entities to delete
   * @returns A promise that resolves to the number of entities deleted
   */
  batchDelete(keys: K[]): Promise<number>;
}
