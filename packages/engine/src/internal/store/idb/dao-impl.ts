/**
 * IndexedDB implementation of the DAO interfaces
 * @module store/idb/dao-impl
 * @internal
 */

import type { BatchDao, Dao } from '../dao';
import type { Key } from '../key';
import { isCompoundKey } from '../key';

/** Provides the open database. Replaces the prior-art IoC lookup (its only resolve). */
export type DbProvider = () => IDBDatabase;

/**
 * Options for the IndexedDB DAO implementation
 * @template K - The key type, extends Key (SimpleKey or CompoundKey)
 * @template E - The entity type
 */
export interface IDBDaoOptions<K extends Key, E> {
  /**
   * The name of the object store
   */
  storeName: string;

  /**
   * The key path in the entity object
   */
  keyPath?: string | string[];

  /**
   * Function to extract the key from an entity
   * @param entity - The entity to extract the key from
   * @returns The extracted key
   */
  keyExtractor?: (entity: E) => K;
}

/**
 * Base IndexedDB DAO implementation
 * @template K - The key type, extends Key (SimpleKey or CompoundKey)
 * @template E - The entity type
 */
export class IDBDao<K extends Key, E> implements Dao<K, E> {
  protected readonly storeName: string;
  protected readonly keyPath?: string | string[];
  protected readonly keyExtractor?: (entity: E) => K;
  protected readonly dbProvider: DbProvider;

  /**
   * Creates a new IDBDao instance
   * @param dbProvider - Provides the open database instance
   * @param options - Options for the DAO
   */
  constructor(dbProvider: DbProvider, options: IDBDaoOptions<K, E>) {
    this.dbProvider = dbProvider;
    this.storeName = options.storeName;
    this.keyPath = options.keyPath;
    this.keyExtractor = options.keyExtractor;
  }

  /**
   * Gets the database instance from the provider
   * @returns The database instance
   */
  protected getDatabase(): IDBDatabase {
    return this.dbProvider();
  }

  /**
   * Converts a key to a format suitable for IndexedDB
   * @param key - The key to convert
   * @returns The converted key
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  protected convertKey(key: K): any {
    if (isCompoundKey(key)) {
      // For compound keys, we need to match the structure expected by the keyPath
      if (!this.keyPath || typeof this.keyPath === 'string') {
        throw new Error('Compound key used but keyPath is not an array');
      }

      // Validate that all key parts are present
      for (const path of this.keyPath) {
        if (!(path in key)) {
          throw new Error(`Key part '${path}' not found in compound key`);
        }
      }

      // For compound keys, we need to create an array of the key parts in the same order as the keyPath
      // This is what IndexedDB expects for compound keys
      return Array.isArray(this.keyPath)
        ? this.keyPath.map((path) => key[path])
        : key;
    }

    // Simple key
    return key;
  }

  /**
   * Creates a new entity
   * @param entity - The entity to create
   * @returns A promise that resolves to the created entity
   */
  async create(entity: E): Promise<E> {
    const db = this.getDatabase();

    return new Promise<E>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let dataToAdd: unknown = entity;
      // If store is autoIncrement and entity has the keyPath property as undefined,
      // we must remove it so IndexedDB can generate a new key.
      if (store.autoIncrement && typeof this.keyPath === 'string') {
        const entityRecord = entity as Record<string, unknown>;
        if (entityRecord[this.keyPath] === undefined) {
          const dataCopy = { ...entityRecord };
          delete dataCopy[this.keyPath];
          dataToAdd = dataCopy;
        }
      }

      try {
        const request = store.add(dataToAdd);

        request.onerror = () => {
          reject(
            new Error(`Failed to create entity: ${request.error?.message}`)
          );
        };

        request.onsuccess = () => {
          // For autoincrement keys, we need to return a copy of the entity with the generated key
          if (store.autoIncrement && this.keyPath) {
            // In case of autoIncrement, IndexedDB supports only one field as a key and value type will be number
            // Create a shallow copy of the entity
            const entityCopy = { ...entity };

            // Get the generated key (always a number for autoincrement)
            const generatedKey = request.result;

            // Set the key in the entity copy (keyPath must be a string for autoincrement)
            if (typeof this.keyPath === 'string') {
              (entityCopy as Record<string, unknown>)[this.keyPath] =
                generatedKey;
            }

            resolve(entityCopy);
          } else {
            resolve(entity);
          }
        };
      } catch (e: unknown) {
        reject(
          new Error(`Failed to create entity: ${(e as Error).message || e}`)
        );
      }
    });
  }

  /**
   * Reads an entity by its key
   * @param key - The key of the entity to read
   * @returns A promise that resolves to the entity if found, or null if not found
   */
  async read(key: K): Promise<E | null> {
    const db = this.getDatabase();
    const convertedKey = this.convertKey(key);

    return new Promise<E | null>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);

      const request = store.get(convertedKey);

      request.onerror = () => {
        reject(new Error(`Failed to read entity: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve(request.result || null);
      };
    });
  }

  /**
   * Updates an existing entity
   * @param key - The key of the entity to update
   * @param entity - The updated entity data
   * @returns A promise that resolves to the updated entity if found, or null if not found
   */
  async update(key: K, entity: E): Promise<E | null> {
    const db = this.getDatabase();
    const convertedKey = this.convertKey(key);

    return new Promise<E | null>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // First check if the entity exists
      const getRequest = store.get(convertedKey);

      getRequest.onerror = () => {
        reject(
          new Error(
            `Failed to check entity existence: ${getRequest.error?.message}`
          )
        );
      };

      getRequest.onsuccess = () => {
        if (!getRequest.result) {
          resolve(null);
          return;
        }

        // Entity exists, update it
        const updateRequest = store.put(entity);

        updateRequest.onerror = () => {
          reject(
            new Error(
              `Failed to update entity: ${updateRequest.error?.message}`
            )
          );
        };

        updateRequest.onsuccess = () => {
          resolve(entity);
        };
      };
    });
  }

  /**
   * Creates a new entity or updates an existing one
   * @param entity - The entity data to upsert
   * @returns A promise that resolves to the upserted entity
   */
  async upsert(entity: E): Promise<E> {
    const db = this.getDatabase();
    // We don't need to use the convertedKey since we're using put with the entity directly

    return new Promise<E>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let dataToPut: unknown = entity;
      // If store is autoIncrement and entity has the keyPath property as undefined,
      // we must remove it so IndexedDB can generate a new key.
      if (store.autoIncrement && typeof this.keyPath === 'string') {
        const entityRecord = entity as Record<string, unknown>;
        if (entityRecord[this.keyPath] === undefined) {
          const dataCopy = { ...entityRecord };
          delete dataCopy[this.keyPath];
          dataToPut = dataCopy;
        }
      }

      try {
        // Use put which will create or update the entity
        const request = store.put(dataToPut);

        request.onerror = () => {
          reject(
            new Error(`Failed to upsert entity: ${request.error?.message}`)
          );
        };

        request.onsuccess = () => {
          // For autoincrement keys, we need to return a copy of the entity with the generated key
          if (store.autoIncrement && this.keyPath && !request.result) {
            // In case of autoIncrement, IndexedDB supports only one field as a key and value type will be number
            // Create a shallow copy of the entity
            const entityCopy = { ...entity };

            // Get the generated key (always a number for autoincrement)
            const generatedKey = request.result;

            // Set the key in the entity copy (keyPath must be a string for autoincrement)
            if (typeof this.keyPath === 'string') {
              (entityCopy as Record<string, unknown>)[this.keyPath] =
                generatedKey;
            }

            resolve(entityCopy);
          } else if (store.autoIncrement && this.keyPath && request.result) {
            // If we have a result (generated key), update the entity
            const entityCopy = { ...entity };
            if (typeof this.keyPath === 'string') {
              (entityCopy as Record<string, unknown>)[this.keyPath] =
                request.result;
            }
            resolve(entityCopy);
          } else {
            resolve(entity);
          }
        };
      } catch (e: unknown) {
        reject(
          new Error(`Failed to upsert entity: ${(e as Error).message || e}`)
        );
      }
    });
  }

  /**
   * Deletes an entity by its key
   * @param key - The key of the entity to delete
   * @returns A promise that resolves to true if the entity was deleted, or false if not found
   */
  async delete(key: K): Promise<boolean> {
    const db = this.getDatabase();
    const convertedKey = this.convertKey(key);

    return new Promise<boolean>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      // First check if the entity exists
      const getRequest = store.get(convertedKey);

      getRequest.onerror = () => {
        reject(
          new Error(
            `Failed to check entity existence: ${getRequest.error?.message}`
          )
        );
      };

      getRequest.onsuccess = () => {
        if (!getRequest.result) {
          resolve(false);
          return;
        }

        // Entity exists, delete it
        const deleteRequest = store.delete(convertedKey);

        deleteRequest.onerror = () => {
          reject(
            new Error(
              `Failed to delete entity: ${deleteRequest.error?.message}`
            )
          );
        };

        deleteRequest.onsuccess = () => {
          resolve(true);
        };
      };
    });
  }

  /**
   * Lists all entities
   * @returns A promise that resolves to an array of all entities
   */
  async list(): Promise<E[]> {
    const db = this.getDatabase();

    return new Promise<E[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);

      const request = store.getAll();

      request.onerror = () => {
        reject(new Error(`Failed to list entities: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  /**
   * Finds entities that match the given criteria
   * @param criteria - A function that takes an entity and returns true if it matches the criteria
   * @returns A promise that resolves to an array of matching entities
   */
  async find(criteria: (entity: E) => boolean): Promise<E[]> {
    const allEntities = await this.list();
    return allEntities.filter(criteria);
  }

  /**
   * Finds entities by index
   * @param indexName - The name of the index to search
   * @param value - The value to search for
   * @param criteria - Optional function to further filter the results
   * @returns A promise that resolves to an array of matching entities
   */
  async findByIndex(
    indexName: string,
    value: unknown,
    criteria?: (entity: E) => boolean
  ): Promise<E[]> {
    const db = this.getDatabase();

    return new Promise<E[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);

      // Check if the index exists
      if (!store.indexNames.contains(indexName)) {
        reject(
          new Error(
            `Index '${indexName}' not found in store '${this.storeName}'`
          )
        );
        return;
      }

      const index = store.index(indexName);
      const results: E[] = [];

      // Open a cursor to iterate through matching records
      const request = index.openCursor(IDBKeyRange.only(value));

      request.onerror = () => {
        reject(
          new Error(
            `Failed to find entities by index: ${request.error?.message}`
          )
        );
      };

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest)
          .result as IDBCursorWithValue;

        if (cursor) {
          // If criteria is provided, only add entities that match the criteria
          if (!criteria || criteria(cursor.value)) {
            results.push(cursor.value);
          }
          // Move to the next matching record
          cursor.continue();
        } else {
          // No more matching records, resolve with results
          resolve(results);
        }
      };
    });
  }

  /**
   * Gets all keys from the store
   * @returns A promise that resolves to an array of all keys
   */
  async getAllKeys(): Promise<K[]> {
    const db = this.getDatabase();

    return new Promise<K[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);

      const request = store.getAllKeys();

      request.onerror = () => {
        reject(new Error(`Failed to get all keys: ${request.error?.message}`));
      };

      request.onsuccess = () => {
        // The result is an array of IDBValidKey, we need to convert it to K[]
        // For compound keys, we need to convert the array back to an object
        const keys = request.result.map((key) => {
          if (
            Array.isArray(key) &&
            this.keyPath &&
            Array.isArray(this.keyPath)
          ) {
            // For compound keys, create an object with the key parts
            const compoundKey: Record<string, unknown> = {};
            for (let i = 0; i < this.keyPath.length; i++) {
              compoundKey[this.keyPath[i]] = key[i];
            }
            return compoundKey as unknown as K;
          }
          return key as unknown as K;
        });

        resolve(keys);
      };
    });
  }
}

/**
 * IndexedDB implementation of the BatchDao interface
 * @template K - The key type, extends Key (SimpleKey or CompoundKey)
 * @template E - The entity type
 */
export class IDBBatchDao<K extends Key, E>
  extends IDBDao<K, E>
  implements BatchDao<K, E>
{
  /**
   * Creates multiple entities in a batch operation
   * @param entities - The entities to create
   * @returns A promise that resolves to the created entities
   */
  async batchCreate(entities: E[]): Promise<E[]> {
    const db = this.getDatabase();

    return new Promise<E[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let hasError = false;
      const updatedEntities: E[] = [...entities]; // Create a copy of the entities array

      transaction.onerror = () => {
        hasError = true;
        reject(
          new Error(
            `Failed to batch create entities: ${transaction.error?.message}`
          )
        );
      };

      transaction.oncomplete = () => {
        if (!hasError) {
          resolve(updatedEntities);
        }
      };

      // Check if the store has autoIncrement and a keyPath
      const hasAutoIncrement = store.autoIncrement && this.keyPath;

      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];
        const request = store.add(entity);

        // For autoincrement keys, we need to update the entity with the generated key
        if (hasAutoIncrement) {
          // Use a closure to capture the current index
          ((index) => {
            request.onsuccess = () => {
              // For autoincrement keys, we need to return a copy of the entity with the generated key
              // In case of autoIncrement, IndexedDB supports only one field as a key and value type will be number
              // Create a shallow copy of the entity
              const entityCopy = { ...entity };

              // Get the generated key (always a number for autoincrement)
              const generatedKey = request.result;

              // Set the key in the entity copy (keyPath must be a string for autoincrement)
              if (typeof this.keyPath === 'string') {
                (entityCopy as Record<string, unknown>)[this.keyPath] =
                  generatedKey;
              }

              // Update the entity in our results array
              updatedEntities[index] = entityCopy;
            };
          })(i);
        }
      }
    });
  }

  /**
   * Reads multiple entities by their keys in a batch operation
   * @param keys - The keys of the entities to read
   * @returns A promise that resolves to an array of found entities (missing entities are excluded)
   */
  async batchRead(keys: K[]): Promise<E[]> {
    const db = this.getDatabase();

    return new Promise<E[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readonly');
      const store = transaction.objectStore(this.storeName);

      const results: E[] = [];
      let hasError = false;

      transaction.onerror = () => {
        hasError = true;
        reject(
          new Error(
            `Failed to batch read entities: ${transaction.error?.message}`
          )
        );
      };

      transaction.oncomplete = () => {
        if (!hasError) {
          resolve(results);
        }
      };

      for (const key of keys) {
        const convertedKey = this.convertKey(key);
        const request = store.get(convertedKey);

        request.onsuccess = () => {
          if (request.result) {
            results.push(request.result);
          }
        };
      }
    });
  }

  /**
   * Updates multiple entities in a batch operation
   * @param updates - An array of key-entity pairs to update
   * @returns A promise that resolves to the updated entities (entities not found are excluded)
   */
  async batchUpdate(updates: Array<{ key: K; entity: E }>): Promise<E[]> {
    const db = this.getDatabase();

    return new Promise<E[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const results: E[] = [];
      let hasError = false;

      transaction.onerror = () => {
        hasError = true;
        reject(
          new Error(
            `Failed to batch update entities: ${transaction.error?.message}`
          )
        );
      };

      transaction.oncomplete = () => {
        if (!hasError) {
          resolve(results);
        }
      };

      for (const update of updates) {
        const convertedKey = this.convertKey(update.key);

        // First check if the entity exists
        const getRequest = store.get(convertedKey);

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            // Entity exists, update it
            const updateRequest = store.put(update.entity);

            updateRequest.onsuccess = () => {
              results.push(update.entity);
            };
          }
        };
      }
    });
  }

  /**
   * Creates or updates multiple entities in a batch operation
   * @param entities - The entities to upsert
   * @returns A promise that resolves to the upserted entities
   */
  async batchUpsert(entities: E[]): Promise<E[]> {
    const db = this.getDatabase();

    return new Promise<E[]>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const results: E[] = [];
      let hasError = false;

      transaction.onerror = () => {
        hasError = true;
        reject(
          new Error(
            `Failed to batch upsert entities: ${transaction.error?.message}`
          )
        );
      };

      transaction.oncomplete = () => {
        if (!hasError) {
          resolve(results);
        }
      };

      // Check if the store has autoIncrement and a keyPath
      const hasAutoIncrement = store.autoIncrement && this.keyPath;

      for (let i = 0; i < entities.length; i++) {
        const entity = entities[i];

        let dataToPut: unknown = entity;
        // If store is autoIncrement and entity has the keyPath property as undefined,
        // we must remove it so IndexedDB can generate a new key.
        if (hasAutoIncrement && typeof this.keyPath === 'string') {
          const entityRecord = entity as Record<string, unknown>;
          if (entityRecord[this.keyPath] === undefined) {
            const dataCopy = { ...entityRecord };
            delete dataCopy[this.keyPath];
            dataToPut = dataCopy;
          }
        }

        try {
          // Use put which will create or update the entity
          const request = store.put(dataToPut);

          // For autoincrement keys, we need to update the entity with the generated key
          if (hasAutoIncrement) {
            // Use a closure to capture the current index
            ((_index) => {
              request.onsuccess = () => {
                // For autoincrement keys, we need to return a copy of the entity with the generated key
                // In case of autoIncrement, IndexedDB supports only one field as a key and value type will be number
                // Create a shallow copy of the entity
                const entityCopy = { ...entity };

                // Get the generated key (always a number for autoincrement)
                const generatedKey = request.result;

                // Set the key in the entity copy (keyPath must be a string for autoincrement)
                if (typeof this.keyPath === 'string') {
                  (entityCopy as Record<string, unknown>)[this.keyPath] =
                    generatedKey;
                }

                // Add the entity to our results array
                results.push(entityCopy);
              };
            })(i);
          } else {
            request.onsuccess = () => {
              results.push(entity);
            };
          }
        } catch (e: unknown) {
          hasError = true;
          reject(
            new Error(
              `Failed to batch upsert entities: ${(e as Error).message || e}`
            )
          );
          break;
        }
      }
    });
  }

  /**
   * Deletes multiple entities by their keys in a batch operation
   * @param keys - The keys of the entities to delete
   * @returns A promise that resolves to the number of entities deleted
   */
  async batchDelete(keys: K[]): Promise<number> {
    const db = this.getDatabase();

    return new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, 'readwrite');
      const store = transaction.objectStore(this.storeName);

      let deletedCount = 0;
      let hasError = false;

      transaction.onerror = () => {
        hasError = true;
        reject(
          new Error(
            `Failed to batch delete entities: ${transaction.error?.message}`
          )
        );
      };

      transaction.oncomplete = () => {
        if (!hasError) {
          resolve(deletedCount);
        }
      };

      for (const key of keys) {
        const convertedKey = this.convertKey(key);

        // First check if the entity exists
        const getRequest = store.get(convertedKey);

        getRequest.onsuccess = () => {
          if (getRequest.result) {
            // Entity exists, delete it
            const deleteRequest = store.delete(convertedKey);

            deleteRequest.onsuccess = () => {
              deletedCount++;
            };
          }
        };
      }
    });
  }
}
