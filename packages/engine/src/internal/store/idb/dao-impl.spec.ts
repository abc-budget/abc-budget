/**
 * Jest tests migrated from tests-old/store-idb.spec.ts
 * Tests for the IndexedDB implementation of the store module
 */
import 'fake-indexeddb/auto';
import type { CompoundKey } from '../key';
import { isCompoundKey } from '../key';
import { IDBBatchDao, IDBDao } from './dao-impl';
import type { MigrationStep, StoreSpec } from '../migrations/migration';
import { openDatabase } from '../migrations/open-with-migrations';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/** Inlined from @abc-budget/utils (trivial type guard). */
function hasId<T extends { id?: string | number | null }>(
  entity: T,
): entity is T & { id: NonNullable<T['id']> } {
  return entity.id != null;
}

/** Prior-art IDBConfig shape, kept so the test bodies don't change. */
interface TestDbConfig {
  name: string;
  version: number;
  stores: Array<{ name: string } & StoreSpec>;
}

/** Opens a test DB via the migration framework: one step creating all configured stores. */
function openTestDb(config: TestDbConfig): Promise<IDBDatabase> {
  const step: MigrationStep = {
    toVersion: 1,
    migrate: (ctx) => {
      for (const { name, ...spec } of config.stores) ctx.createStore(name, spec);
    },
  };
  return openDatabase(config.name, [step]);
}

// Define a test entity interface
interface TestEntity {
  id: string;
  name: string;
  value: number;
  createdAt: Date;
}

// Define a test entity with compound key
interface CompoundKeyEntity {
  userId: string;
  categoryId: string;
  name: string;
  value: number;
  createdAt: Date;
}

describe('IndexedDB Store Implementation', () => {
  let dbName: string;
  let db: IDBDatabase;

  // Setup before each test
  beforeEach(async () => {
    // Create a unique database name for each test to avoid conflicts
    dbName = `test-db-${Date.now()}`;

    // Define database configuration
    const dbConfig: TestDbConfig = {
      name: dbName,
      version: 1,
      stores: [
        {
          name: 'testEntities',
          keyPath: 'id',
          indexes: [
            { name: 'name', keyPath: 'name', options: { unique: false } },
            {
              name: 'createdAt',
              keyPath: 'createdAt',
              options: { unique: false },
            },
          ],
        },
      ],
    };

    // Open the database directly first to ensure it works
    db = await openTestDb(dbConfig);
  });

  // Cleanup after each test
  afterEach(() => {
    // Close the database connection
    if (db) {
      db.close();
    }

    // Delete the test database
    return new Promise<void>((resolve) => {
      const deleteRequest = indexedDB.deleteDatabase(dbName);
      deleteRequest.onsuccess = () => resolve();
      deleteRequest.onerror = () => resolve(); // Resolve anyway to continue tests
    });
  });

  describe('IDBDao', () => {
    let dao: IDBDao<string, TestEntity>;

    beforeEach(() => {
      // Create a DAO instance
      dao = new IDBDao<string, TestEntity>(() => db, {
        storeName: 'testEntities',
        keyPath: 'id',
      });
    });

    // Define an interface for testing autoincrement keys
    interface AutoIncrementEntity {
      id?: number;
      name: string;
      value: number;
    }

    it('should populate autoincrement key in the returned entity', async () => {
      // Create a new database with autoincrement
      const autoIncrementDbName = `test-autoincrement-db-${Date.now()}`;

      // Define database configuration with autoincrement
      const dbConfig: TestDbConfig = {
        name: autoIncrementDbName,
        version: 1,
        stores: [
          {
            name: 'autoIncrementEntities',
            keyPath: 'id',
            autoIncrement: true,
            indexes: [
              { name: 'name', keyPath: 'name', options: { unique: false } },
            ],
          },
        ],
      };

      // Open the database
      const autoIncrementDb = await openTestDb(dbConfig);

      try {
        // Create a DAO instance for autoincrement entities
        const autoIncrementDao = new IDBDao<number, AutoIncrementEntity>(
          () => autoIncrementDb,
          {
            storeName: 'autoIncrementEntities',
            keyPath: 'id',
          }
        );

        // Create an entity without an ID (should be auto-generated)
        const entity: AutoIncrementEntity = {
          name: 'Auto Increment Entity',
          value: 42,
        };

        // Act
        const savedEntity = await autoIncrementDao.create(entity);

        // Assert
        expect(savedEntity.id).toBeDefined();
        expect(typeof savedEntity.id).toBe('number');
        expect(hasId(savedEntity)).toBe(true);
        if (!hasId(savedEntity)) {
          throw new Error('Expected savedEntity to have an id');
        }
        expect(savedEntity.id).toBeGreaterThan(0);
        expect(savedEntity.name).toBe(entity.name);
        expect(savedEntity.value).toBe(entity.value);

        // Verify we can retrieve the entity with the generated ID
        const retrievedEntity = await autoIncrementDao.read(savedEntity.id);
        expect(retrievedEntity).not.toBeNull();
        if (!retrievedEntity) {
          throw new Error('Expected retrievedEntity to be defined');
        }
        expect(retrievedEntity.id).toBe(savedEntity.id);
      } finally {
        // Clean up
        if (autoIncrementDb) {
          autoIncrementDb.close();
        }

        // Delete the test database
        await new Promise<void>((resolve) => {
          const deleteRequest = indexedDB.deleteDatabase(autoIncrementDbName);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => resolve(); // Resolve anyway to continue tests
        });
      }
    });

    it('should create entity with id: undefined for autoincrement keys', async () => {
      // Create a new database with autoincrement
      const autoIncrementDbName = `test-autoincrement-undefined-db-${Date.now()}`;

      // Define database configuration with autoincrement
      const dbConfig: TestDbConfig = {
        name: autoIncrementDbName,
        version: 1,
        stores: [
          {
            name: 'autoIncrementEntities',
            keyPath: 'id',
            autoIncrement: true,
          },
        ],
      };

      // Open the database
      const autoIncrementDb = await openTestDb(dbConfig);

      try {
        // Create a DAO instance for autoincrement entities
        const autoIncrementDao = new IDBDao<number, AutoIncrementEntity>(
          () => autoIncrementDb,
          {
            storeName: 'autoIncrementEntities',
            keyPath: 'id',
          }
        );

        // Create an entity with id: undefined (should be auto-generated without throwing DataError)
        const entity: AutoIncrementEntity = {
          id: undefined,
          name: 'Undefined ID Entity',
          value: 42,
        };

        // Act
        const savedEntity = await autoIncrementDao.create(entity);

        // Assert
        expect(savedEntity.id).toBeDefined();
        expect(typeof savedEntity.id).toBe('number');
        expect(savedEntity.id).toBeGreaterThan(0);
        expect(savedEntity.name).toBe(entity.name);
      } finally {
        if (autoIncrementDb) {
          autoIncrementDb.close();
        }
        await new Promise<void>((resolve) => {
          const deleteRequest = indexedDB.deleteDatabase(autoIncrementDbName);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => resolve();
        });
      }
    });

    it('should upsert entity with id: undefined for autoincrement keys', async () => {
      // Create a new database with autoincrement
      const autoIncrementDbName = `test-autoincrement-upsert-undefined-db-${Date.now()}`;

      // Define database configuration with autoincrement
      const dbConfig: TestDbConfig = {
        name: autoIncrementDbName,
        version: 1,
        stores: [
          {
            name: 'autoIncrementEntities',
            keyPath: 'id',
            autoIncrement: true,
          },
        ],
      };

      // Open the database
      const autoIncrementDb = await openTestDb(dbConfig);

      try {
        // Create a DAO instance for autoincrement entities
        const autoIncrementDao = new IDBDao<number, AutoIncrementEntity>(
          () => autoIncrementDb,
          {
            storeName: 'autoIncrementEntities',
            keyPath: 'id',
          }
        );

        // Create an entity with id: undefined
        const entity: AutoIncrementEntity = {
          id: undefined,
          name: 'Undefined ID Entity',
          value: 42,
        };

        // Act
        const savedEntity = await autoIncrementDao.upsert(entity);

        // Assert
        expect(savedEntity.id).toBeDefined();
        expect(typeof savedEntity.id).toBe('number');
        expect(savedEntity.id).toBeGreaterThan(0);
        expect(savedEntity.name).toBe(entity.name);
      } finally {
        if (autoIncrementDb) {
          autoIncrementDb.close();
        }
        await new Promise<void>((resolve) => {
          const deleteRequest = indexedDB.deleteDatabase(autoIncrementDbName);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => resolve();
        });
      }
    });

    it('should create and read an entity', async () => {
      // Arrange
      const testEntity: TestEntity = {
        id: 'test-1',
        name: 'Test Entity',
        value: 42,
        createdAt: new Date(),
      };

      // Act
      await dao.create(testEntity);
      const retrievedEntity = await dao.read('test-1');

      // Assert
      expect(retrievedEntity).not.toBeNull();
      expect(retrievedEntity?.id).toBe('test-1');
      expect(retrievedEntity?.name).toBe('Test Entity');
      expect(retrievedEntity?.value).toBe(42);
    });

    it('should update an entity', async () => {
      // Arrange
      const testEntity: TestEntity = {
        id: 'test-1',
        name: 'Test Entity',
        value: 42,
        createdAt: new Date(),
      };

      await dao.create(testEntity);

      // Act
      const updatedEntity: TestEntity = {
        ...testEntity,
        name: 'Updated Entity',
        value: 100,
      };

      await dao.update('test-1', updatedEntity);
      const retrievedEntity = await dao.read('test-1');

      // Assert
      expect(retrievedEntity).not.toBeNull();
      expect(retrievedEntity?.name).toBe('Updated Entity');
      expect(retrievedEntity?.value).toBe(100);
    });

    it('should delete an entity', async () => {
      // Arrange
      const testEntity: TestEntity = {
        id: 'test-1',
        name: 'Test Entity',
        value: 42,
        createdAt: new Date(),
      };

      await dao.create(testEntity);

      // Act
      const deleteResult = await dao.delete('test-1');
      const retrievedEntity = await dao.read('test-1');

      // Assert
      expect(deleteResult).toBe(true);
      expect(retrievedEntity).toBeNull();
    });

    it('should upsert a new entity if it does not exist', async () => {
      // Arrange
      const testEntity: TestEntity = {
        id: 'test-1',
        name: 'Test Entity',
        value: 42,
        createdAt: new Date(),
      };

      // Act
      await dao.upsert(testEntity);
      const retrievedEntity = await dao.read('test-1');

      // Assert
      expect(retrievedEntity).not.toBeNull();
      expect(retrievedEntity?.id).toBe('test-1');
      expect(retrievedEntity?.name).toBe('Test Entity');
      expect(retrievedEntity?.value).toBe(42);
    });

    it('should upsert an existing entity if it already exists', async () => {
      // Arrange
      const testEntity: TestEntity = {
        id: 'test-1',
        name: 'Test Entity',
        value: 42,
        createdAt: new Date(),
      };

      await dao.create(testEntity);

      // Act
      const updatedEntity: TestEntity = {
        ...testEntity,
        name: 'Updated Entity',
        value: 100,
      };

      await dao.upsert(updatedEntity);
      const retrievedEntity = await dao.read('test-1');

      // Assert
      expect(retrievedEntity).not.toBeNull();
      expect(retrievedEntity?.name).toBe('Updated Entity');
      expect(retrievedEntity?.value).toBe(100);
    });

    it('should list all entities', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
      ];

      await dao.create(testEntities[0]);
      await dao.create(testEntities[1]);

      // Act
      const allEntities = await dao.list();

      // Assert
      expect(allEntities.length).toBe(2);
      expect(allEntities.find((e) => e.id === 'test-1')).toBeDefined();
      expect(allEntities.find((e) => e.id === 'test-2')).toBeDefined();
    });

    it('should find entities by criteria', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          id: 'test-3',
          name: 'Another Entity',
          value: 100,
          createdAt: new Date(),
        },
      ];

      await dao.create(testEntities[0]);
      await dao.create(testEntities[1]);
      await dao.create(testEntities[2]);

      // Act
      const foundEntities = await dao.find((entity) =>
        entity.name.includes('Test')
      );

      // Assert
      expect(foundEntities.length).toBe(2);
      expect(foundEntities.find((e) => e.id === 'test-1')).toBeDefined();
      expect(foundEntities.find((e) => e.id === 'test-2')).toBeDefined();
      expect(foundEntities.find((e) => e.id === 'test-3')).toBeUndefined();
    });

    it('should find entities by index', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 1',
          value: 84,
          createdAt: new Date(),
        },
        {
          id: 'test-3',
          name: 'Another Entity',
          value: 100,
          createdAt: new Date(),
        },
      ];

      await dao.create(testEntities[0]);
      await dao.create(testEntities[1]);
      await dao.create(testEntities[2]);

      // Act
      const foundEntities = await dao.findByIndex('name', 'Test Entity 1');

      // Assert
      expect(foundEntities.length).toBe(2);
      expect(foundEntities.find((e) => e.id === 'test-1')).toBeDefined();
      expect(foundEntities.find((e) => e.id === 'test-2')).toBeDefined();
      expect(foundEntities.find((e) => e.id === 'test-3')).toBeUndefined();
    });

    it('should find entities by index with criteria', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 1',
          value: 84,
          createdAt: new Date(),
        },
        {
          id: 'test-3',
          name: 'Another Entity',
          value: 100,
          createdAt: new Date(),
        },
      ];

      await dao.create(testEntities[0]);
      await dao.create(testEntities[1]);
      await dao.create(testEntities[2]);

      // Act
      const foundEntities = await dao.findByIndex(
        'name',
        'Test Entity 1',
        (entity) => entity.value > 50
      );

      // Assert
      expect(foundEntities.length).toBe(1);
      expect(foundEntities.find((e) => e.id === 'test-1')).toBeUndefined();
      expect(foundEntities.find((e) => e.id === 'test-2')).toBeDefined();
      expect(foundEntities.find((e) => e.id === 'test-3')).toBeUndefined();
    });

    it('should get all keys from the store', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          id: 'test-3',
          name: 'Test Entity 3',
          value: 100,
          createdAt: new Date(),
        },
      ];

      await dao.create(testEntities[0]);
      await dao.create(testEntities[1]);
      await dao.create(testEntities[2]);

      // Act
      const keys = await dao.getAllKeys();

      // Assert
      expect(keys.length).toBe(3);
      expect(keys).toContain('test-1');
      expect(keys).toContain('test-2');
      expect(keys).toContain('test-3');
    });

    it('should return empty array when getting keys from empty store', async () => {
      // Act
      const keys = await dao.getAllKeys();

      // Assert
      expect(keys.length).toBe(0);
      expect(keys).toEqual([]);
    });
  });

  describe('IDBBatchDao', () => {
    let batchDao: IDBBatchDao<string, TestEntity>;

    beforeEach(() => {
      // Create a BatchDao instance
      batchDao = new IDBBatchDao<string, TestEntity>(() => db, {
        storeName: 'testEntities',
        keyPath: 'id',
      });
    });

    // Define an interface for testing autoincrement keys in batch operations
    interface AutoIncrementBatchEntity {
      id?: number;
      name: string;
      value: number;
    }

    it('should populate autoincrement keys in the returned entities for batchCreate', async () => {
      // Create a new database with autoincrement
      const autoIncrementDbName = `test-autoincrement-batch-db-${Date.now()}`;

      // Define database configuration with autoincrement
      const dbConfig: TestDbConfig = {
        name: autoIncrementDbName,
        version: 1,
        stores: [
          {
            name: 'autoIncrementBatchEntities',
            keyPath: 'id',
            autoIncrement: true,
            indexes: [
              { name: 'name', keyPath: 'name', options: { unique: false } },
            ],
          },
        ],
      };

      // Open the database
      const autoIncrementDb = await openTestDb(dbConfig);

      try {
        // Create a BatchDao instance for autoincrement entities
        const autoIncrementBatchDao = new IDBBatchDao<
          number,
          AutoIncrementBatchEntity
        >(() => autoIncrementDb, {
          storeName: 'autoIncrementBatchEntities',
          keyPath: 'id',
        });

        // Create entities without IDs (should be auto-generated)
        const entities: AutoIncrementBatchEntity[] = [
          { name: 'Auto Increment Batch Entity 1', value: 42 },
          { name: 'Auto Increment Batch Entity 2', value: 84 },
          { name: 'Auto Increment Batch Entity 3', value: 126 },
        ];

        // Act
        const savedEntities = await autoIncrementBatchDao.batchCreate(entities);

        // Assert
        expect(savedEntities.length).toBe(3);

        // Check each entity has an auto-generated ID
        for (let i = 0; i < savedEntities.length; i++) {
          expect(savedEntities[i].id).toBeDefined();
          expect(typeof savedEntities[i].id).toBe('number');
          expect(hasId(savedEntities[i])).toBe(true);
          if (!hasId(savedEntities[i])) {
            throw new Error(`Expected savedEntities[${i}] to have an id`);
          }
          expect(savedEntities[i].id).toBeGreaterThan(0);
          expect(savedEntities[i].name).toBe(entities[i].name);
          expect(savedEntities[i].value).toBe(entities[i].value);
        }

        // Verify we can retrieve the entities with the generated IDs
        for (const entity of savedEntities) {
          expect(hasId(entity)).toBe(true);
          if (!hasId(entity)) {
            throw new Error('Expected entity to have an id');
          }
          const retrievedEntity = await autoIncrementBatchDao.read(entity.id);
          expect(retrievedEntity).not.toBeNull();
          if (!retrievedEntity) {
            throw new Error('Expected retrievedEntity to be defined');
          }
          expect(retrievedEntity.id).toBe(entity.id);
          expect(retrievedEntity.name).toBe(entity.name);
          expect(retrievedEntity.value).toBe(entity.value);
        }
      } finally {
        // Clean up
        if (autoIncrementDb) {
          autoIncrementDb.close();
        }

        // Delete the test database
        await new Promise<void>((resolve) => {
          const deleteRequest = indexedDB.deleteDatabase(autoIncrementDbName);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => resolve(); // Resolve anyway to continue tests
        });
      }
    });

    it('should populate autoincrement keys in the returned entities for batchUpsert with id: undefined', async () => {
      // Create a new database with autoincrement
      const autoIncrementDbName = `test-autoincrement-batch-upsert-undefined-db-${Date.now()}`;

      // Define database configuration with autoincrement
      const dbConfig: TestDbConfig = {
        name: autoIncrementDbName,
        version: 1,
        stores: [
          {
            name: 'autoIncrementBatchEntities',
            keyPath: 'id',
            autoIncrement: true,
          },
        ],
      };

      // Open the database
      const autoIncrementDb = await openTestDb(dbConfig);

      try {
        // Create a BatchDao instance for autoincrement entities
        const autoIncrementBatchDao = new IDBBatchDao<
          number,
          AutoIncrementBatchEntity
        >(() => autoIncrementDb, {
          storeName: 'autoIncrementBatchEntities',
          keyPath: 'id',
        });

        // Create entities with id: undefined
        const entities: AutoIncrementBatchEntity[] = [
          { id: undefined, name: 'Auto Increment Batch Entity 1', value: 42 },
          { id: undefined, name: 'Auto Increment Batch Entity 2', value: 84 },
        ];

        // Act
        const savedEntities = await autoIncrementBatchDao.batchUpsert(entities);

        // Assert
        expect(savedEntities.length).toBe(2);

        // Check each entity has an auto-generated ID
        for (let i = 0; i < savedEntities.length; i++) {
          expect(savedEntities[i].id).toBeDefined();
          expect(typeof savedEntities[i].id).toBe('number');
          expect(savedEntities[i].id).toBeGreaterThan(0);
          expect(savedEntities[i].name).toBe(entities[i].name);
        }
      } finally {
        if (autoIncrementDb) {
          autoIncrementDb.close();
        }
        await new Promise<void>((resolve) => {
          const deleteRequest = indexedDB.deleteDatabase(autoIncrementDbName);
          deleteRequest.onsuccess = () => resolve();
          deleteRequest.onerror = () => resolve();
        });
      }
    });

    it('should batch create entities', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
      ];

      // Act
      await batchDao.batchCreate(testEntities);
      const allEntities = await batchDao.list();

      // Assert
      expect(allEntities.length).toBe(2);
      expect(allEntities.find((e) => e.id === 'test-1')).toBeDefined();
      expect(allEntities.find((e) => e.id === 'test-2')).toBeDefined();
    });

    it('should batch read entities', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          id: 'test-3',
          name: 'Test Entity 3',
          value: 126,
          createdAt: new Date(),
        },
      ];

      await batchDao.batchCreate(testEntities);

      // Act
      const retrievedEntities = await batchDao.batchRead([
        'test-1',
        'test-3',
        'non-existent',
      ]);

      // Assert
      expect(retrievedEntities.length).toBe(2);
      expect(retrievedEntities.find((e) => e.id === 'test-1')).toBeDefined();
      expect(retrievedEntities.find((e) => e.id === 'test-3')).toBeDefined();
      expect(retrievedEntities.find((e) => e.id === 'test-2')).toBeUndefined();
    });

    it('should batch update entities', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
      ];

      await batchDao.batchCreate(testEntities);

      // Act
      const updates = [
        {
          key: 'test-1',
          entity: { ...testEntities[0], name: 'Updated Entity 1', value: 100 },
        },
        {
          key: 'test-2',
          entity: { ...testEntities[1], name: 'Updated Entity 2', value: 200 },
        },
        {
          key: 'non-existent',
          entity: {
            id: 'non-existent',
            name: 'Non-existent Entity',
            value: 300,
            createdAt: new Date(),
          },
        },
      ];

      const updatedEntities = await batchDao.batchUpdate(updates);
      const allEntities = await batchDao.list();

      // Assert
      expect(updatedEntities.length).toBe(2);
      expect(allEntities.length).toBe(2);

      const entity1 = allEntities.find((e) => e.id === 'test-1');
      const entity2 = allEntities.find((e) => e.id === 'test-2');

      expect(entity1?.name).toBe('Updated Entity 1');
      expect(entity1?.value).toBe(100);
      expect(entity2?.name).toBe('Updated Entity 2');
      expect(entity2?.value).toBe(200);
    });

    it('should batch delete entities', async () => {
      // Arrange
      const testEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          id: 'test-3',
          name: 'Test Entity 3',
          value: 126,
          createdAt: new Date(),
        },
      ];

      await batchDao.batchCreate(testEntities);

      // Act
      const deleteCount = await batchDao.batchDelete([
        'test-1',
        'test-3',
        'non-existent',
      ]);
      const remainingEntities = await batchDao.list();

      // Assert
      expect(deleteCount).toBe(2);
      expect(remainingEntities.length).toBe(1);
      expect(remainingEntities[0].id).toBe('test-2');
    });

    it('should batch upsert entities (create new and update existing)', async () => {
      // Arrange
      const existingEntities: TestEntity[] = [
        {
          id: 'test-1',
          name: 'Test Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          id: 'test-2',
          name: 'Test Entity 2',
          value: 84,
          createdAt: new Date(),
        },
      ];

      await batchDao.batchCreate(existingEntities);

      // Act
      const entities = [
        { ...existingEntities[0], name: 'Updated Entity 1', value: 100 },
        { ...existingEntities[1], name: 'Updated Entity 2', value: 200 },
        {
          id: 'test-3',
          name: 'New Entity 3',
          value: 300,
          createdAt: new Date(),
        },
      ];

      const upsertedEntities = await batchDao.batchUpsert(entities);
      const allEntities = await batchDao.list();

      // Assert
      expect(upsertedEntities.length).toBe(3);
      expect(allEntities.length).toBe(3);

      const entity1 = allEntities.find((e) => e.id === 'test-1');
      const entity2 = allEntities.find((e) => e.id === 'test-2');
      const entity3 = allEntities.find((e) => e.id === 'test-3');

      expect(entity1?.name).toBe('Updated Entity 1');
      expect(entity1?.value).toBe(100);
      expect(entity2?.name).toBe('Updated Entity 2');
      expect(entity2?.value).toBe(200);
      expect(entity3?.name).toBe('New Entity 3');
      expect(entity3?.value).toBe(300);
    });
  });

  describe('IDBDao with Compound Keys', () => {
    let compoundKeyDao: IDBDao<CompoundKey, CompoundKeyEntity>;
    let compoundKeyDbName: string;
    let compoundKeyDb: IDBDatabase;

    beforeEach(async () => {
      // Create a unique database name for compound key tests
      compoundKeyDbName = `test-compound-key-db-${Date.now()}`;

      // Define database configuration with compound key
      const dbConfig: TestDbConfig = {
        name: compoundKeyDbName,
        version: 1,
        stores: [
          {
            name: 'compoundKeyEntities',
            keyPath: ['userId', 'categoryId'], // Compound key
            indexes: [
              { name: 'name', keyPath: 'name', options: { unique: false } },
              {
                name: 'createdAt',
                keyPath: 'createdAt',
                options: { unique: false },
              },
            ],
          },
        ],
      };

      // Open the database
      compoundKeyDb = await openTestDb(dbConfig);

      // Create a DAO instance with compound key
      compoundKeyDao = new IDBDao<CompoundKey, CompoundKeyEntity>(
        () => compoundKeyDb,
        {
          storeName: 'compoundKeyEntities',
          keyPath: ['userId', 'categoryId'],
        }
      );
    });

    afterEach(() => {
      // Close the database connection
      if (compoundKeyDb) {
        compoundKeyDb.close();
      }

      // Delete the test database
      return new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase(compoundKeyDbName);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve(); // Resolve anyway to continue tests
      });
    });

    it('should create and read an entity with compound key', async () => {
      // Arrange
      const testEntity: CompoundKeyEntity = {
        userId: 'user-1',
        categoryId: 'category-1',
        name: 'Compound Key Entity',
        value: 42,
        createdAt: new Date(),
      };

      // Act
      await compoundKeyDao.create(testEntity);
      const retrievedEntity = await compoundKeyDao.read({
        userId: 'user-1',
        categoryId: 'category-1',
      });

      // Assert
      expect(retrievedEntity).not.toBeNull();
      expect(retrievedEntity?.userId).toBe('user-1');
      expect(retrievedEntity?.categoryId).toBe('category-1');
      expect(retrievedEntity?.name).toBe('Compound Key Entity');
      expect(retrievedEntity?.value).toBe(42);
    });

    it('should update an entity with compound key', async () => {
      // Arrange
      const testEntity: CompoundKeyEntity = {
        userId: 'user-1',
        categoryId: 'category-1',
        name: 'Compound Key Entity',
        value: 42,
        createdAt: new Date(),
      };

      await compoundKeyDao.create(testEntity);

      // Act
      const updatedEntity: CompoundKeyEntity = {
        ...testEntity,
        name: 'Updated Compound Key Entity',
        value: 100,
      };

      await compoundKeyDao.update(
        { userId: 'user-1', categoryId: 'category-1' },
        updatedEntity
      );
      const retrievedEntity = await compoundKeyDao.read({
        userId: 'user-1',
        categoryId: 'category-1',
      });

      // Assert
      expect(retrievedEntity).not.toBeNull();
      expect(retrievedEntity?.name).toBe('Updated Compound Key Entity');
      expect(retrievedEntity?.value).toBe(100);
    });

    it('should delete an entity with compound key', async () => {
      // Arrange
      const testEntity: CompoundKeyEntity = {
        userId: 'user-1',
        categoryId: 'category-1',
        name: 'Compound Key Entity',
        value: 42,
        createdAt: new Date(),
      };

      await compoundKeyDao.create(testEntity);

      // Act
      const deleteResult = await compoundKeyDao.delete({
        userId: 'user-1',
        categoryId: 'category-1',
      });
      const retrievedEntity = await compoundKeyDao.read({
        userId: 'user-1',
        categoryId: 'category-1',
      });

      // Assert
      expect(deleteResult).toBe(true);
      expect(retrievedEntity).toBeNull();
    });

    it('should list all entities with compound keys', async () => {
      // Arrange
      const testEntities: CompoundKeyEntity[] = [
        {
          userId: 'user-1',
          categoryId: 'category-1',
          name: 'Compound Key Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          userId: 'user-1',
          categoryId: 'category-2',
          name: 'Compound Key Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          userId: 'user-2',
          categoryId: 'category-1',
          name: 'Compound Key Entity 3',
          value: 126,
          createdAt: new Date(),
        },
      ];

      await compoundKeyDao.create(testEntities[0]);
      await compoundKeyDao.create(testEntities[1]);
      await compoundKeyDao.create(testEntities[2]);

      // Act
      const allEntities = await compoundKeyDao.list();

      // Assert
      expect(allEntities.length).toBe(3);
      expect(
        allEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-1'
        )
      ).toBeDefined();
      expect(
        allEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-2'
        )
      ).toBeDefined();
      expect(
        allEntities.find(
          (e) => e.userId === 'user-2' && e.categoryId === 'category-1'
        )
      ).toBeDefined();
    });

    it('should find entities by criteria with compound keys', async () => {
      // Arrange
      const testEntities: CompoundKeyEntity[] = [
        {
          userId: 'user-1',
          categoryId: 'category-1',
          name: 'Compound Key Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          userId: 'user-1',
          categoryId: 'category-2',
          name: 'Compound Key Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          userId: 'user-2',
          categoryId: 'category-1',
          name: 'Different Entity',
          value: 126,
          createdAt: new Date(),
        },
      ];

      await compoundKeyDao.create(testEntities[0]);
      await compoundKeyDao.create(testEntities[1]);
      await compoundKeyDao.create(testEntities[2]);

      // Act
      const foundEntities = await compoundKeyDao.find((entity) =>
        entity.name.includes('Compound')
      );

      // Assert
      expect(foundEntities.length).toBe(2);
      expect(
        foundEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-1'
        )
      ).toBeDefined();
      expect(
        foundEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-2'
        )
      ).toBeDefined();
      expect(
        foundEntities.find(
          (e) => e.userId === 'user-2' && e.categoryId === 'category-1'
        )
      ).toBeUndefined();
    });

    it('should get all keys from the store with compound keys', async () => {
      // Arrange
      const testEntities: CompoundKeyEntity[] = [
        {
          userId: 'user-1',
          categoryId: 'category-1',
          name: 'Compound Key Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          userId: 'user-1',
          categoryId: 'category-2',
          name: 'Compound Key Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          userId: 'user-2',
          categoryId: 'category-1',
          name: 'Compound Key Entity 3',
          value: 126,
          createdAt: new Date(),
        },
      ];

      await compoundKeyDao.create(testEntities[0]);
      await compoundKeyDao.create(testEntities[1]);
      await compoundKeyDao.create(testEntities[2]);

      // Act
      const keys = await compoundKeyDao.getAllKeys();

      // Assert
      expect(keys.length).toBe(3);

      // Check that each key has the correct structure and values
      const key1 = keys.find((k) => {
        if (!isCompoundKey(k)) return false;
        return k['userId'] === 'user-1' && k['categoryId'] === 'category-1';
      });
      const key2 = keys.find((k) => {
        if (!isCompoundKey(k)) return false;
        return k['userId'] === 'user-1' && k['categoryId'] === 'category-2';
      });
      const key3 = keys.find((k) => {
        if (!isCompoundKey(k)) return false;
        return k['userId'] === 'user-2' && k['categoryId'] === 'category-1';
      });

      expect(key1).toBeDefined();
      expect(key2).toBeDefined();
      expect(key3).toBeDefined();
    });

    it('should return empty array when getting compound keys from empty store', async () => {
      // Act
      const keys = await compoundKeyDao.getAllKeys();

      // Assert
      expect(keys.length).toBe(0);
      expect(keys).toEqual([]);
    });
  });

  describe('IDBBatchDao with Compound Keys', () => {
    let batchDao: IDBBatchDao<CompoundKey, CompoundKeyEntity>;
    let compoundKeyDbName: string;
    let compoundKeyDb: IDBDatabase;

    beforeEach(async () => {
      // Create a unique database name for compound key tests
      compoundKeyDbName = `test-compound-key-batch-db-${Date.now()}`;

      // Define database configuration with compound key
      const dbConfig: TestDbConfig = {
        name: compoundKeyDbName,
        version: 1,
        stores: [
          {
            name: 'compoundKeyEntities',
            keyPath: ['userId', 'categoryId'], // Compound key
            indexes: [
              { name: 'name', keyPath: 'name', options: { unique: false } },
              {
                name: 'createdAt',
                keyPath: 'createdAt',
                options: { unique: false },
              },
            ],
          },
        ],
      };

      // Open the database
      compoundKeyDb = await openTestDb(dbConfig);

      // Create a BatchDao instance with compound key
      batchDao = new IDBBatchDao<CompoundKey, CompoundKeyEntity>(
        () => compoundKeyDb,
        {
          storeName: 'compoundKeyEntities',
          keyPath: ['userId', 'categoryId'],
        }
      );
    });

    afterEach(() => {
      // Close the database connection
      if (compoundKeyDb) {
        compoundKeyDb.close();
      }

      // Delete the test database
      return new Promise<void>((resolve) => {
        const deleteRequest = indexedDB.deleteDatabase(compoundKeyDbName);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => resolve(); // Resolve anyway to continue tests
      });
    });

    it('should batch create entities with compound keys', async () => {
      // Arrange
      const testEntities: CompoundKeyEntity[] = [
        {
          userId: 'user-1',
          categoryId: 'category-1',
          name: 'Compound Key Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          userId: 'user-1',
          categoryId: 'category-2',
          name: 'Compound Key Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          userId: 'user-2',
          categoryId: 'category-1',
          name: 'Compound Key Entity 3',
          value: 126,
          createdAt: new Date(),
        },
      ];

      // Act
      await batchDao.batchCreate(testEntities);
      const allEntities = await batchDao.list();

      // Assert
      expect(allEntities.length).toBe(3);
      expect(
        allEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-1'
        )
      ).toBeDefined();
      expect(
        allEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-2'
        )
      ).toBeDefined();
      expect(
        allEntities.find(
          (e) => e.userId === 'user-2' && e.categoryId === 'category-1'
        )
      ).toBeDefined();
    });

    it('should batch read entities with compound keys', async () => {
      // Arrange
      const testEntities: CompoundKeyEntity[] = [
        {
          userId: 'user-1',
          categoryId: 'category-1',
          name: 'Compound Key Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          userId: 'user-1',
          categoryId: 'category-2',
          name: 'Compound Key Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          userId: 'user-2',
          categoryId: 'category-1',
          name: 'Compound Key Entity 3',
          value: 126,
          createdAt: new Date(),
        },
      ];

      await batchDao.batchCreate(testEntities);

      // Act
      const keys: CompoundKey[] = [
        { userId: 'user-1', categoryId: 'category-1' },
        { userId: 'user-2', categoryId: 'category-1' },
        { userId: 'non-existent', categoryId: 'non-existent' },
      ];
      const retrievedEntities = await batchDao.batchRead(keys);

      // Assert
      expect(retrievedEntities.length).toBe(2);
      expect(
        retrievedEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-1'
        )
      ).toBeDefined();
      expect(
        retrievedEntities.find(
          (e) => e.userId === 'user-2' && e.categoryId === 'category-1'
        )
      ).toBeDefined();
      expect(
        retrievedEntities.find(
          (e) => e.userId === 'user-1' && e.categoryId === 'category-2'
        )
      ).toBeUndefined();
    });

    it('should batch update entities with compound keys', async () => {
      // Arrange
      const testEntities: CompoundKeyEntity[] = [
        {
          userId: 'user-1',
          categoryId: 'category-1',
          name: 'Compound Key Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          userId: 'user-1',
          categoryId: 'category-2',
          name: 'Compound Key Entity 2',
          value: 84,
          createdAt: new Date(),
        },
      ];

      await batchDao.batchCreate(testEntities);

      // Act
      const updates = [
        {
          key: { userId: 'user-1', categoryId: 'category-1' },
          entity: {
            ...testEntities[0],
            name: 'Updated Compound Key Entity 1',
            value: 100,
          },
        },
        {
          key: { userId: 'user-1', categoryId: 'category-2' },
          entity: {
            ...testEntities[1],
            name: 'Updated Compound Key Entity 2',
            value: 200,
          },
        },
        {
          key: { userId: 'non-existent', categoryId: 'non-existent' },
          entity: {
            userId: 'non-existent',
            categoryId: 'non-existent',
            name: 'Non-existent Entity',
            value: 300,
            createdAt: new Date(),
          },
        },
      ];

      const updatedEntities = await batchDao.batchUpdate(updates);
      const allEntities = await batchDao.list();

      // Assert
      expect(updatedEntities.length).toBe(2);
      expect(allEntities.length).toBe(2);

      const entity1 = allEntities.find(
        (e) => e.userId === 'user-1' && e.categoryId === 'category-1'
      );
      const entity2 = allEntities.find(
        (e) => e.userId === 'user-1' && e.categoryId === 'category-2'
      );

      expect(entity1?.name).toBe('Updated Compound Key Entity 1');
      expect(entity1?.value).toBe(100);
      expect(entity2?.name).toBe('Updated Compound Key Entity 2');
      expect(entity2?.value).toBe(200);
    });

    it('should batch delete entities with compound keys', async () => {
      // Arrange
      const testEntities: CompoundKeyEntity[] = [
        {
          userId: 'user-1',
          categoryId: 'category-1',
          name: 'Compound Key Entity 1',
          value: 42,
          createdAt: new Date(),
        },
        {
          userId: 'user-1',
          categoryId: 'category-2',
          name: 'Compound Key Entity 2',
          value: 84,
          createdAt: new Date(),
        },
        {
          userId: 'user-2',
          categoryId: 'category-1',
          name: 'Compound Key Entity 3',
          value: 126,
          createdAt: new Date(),
        },
      ];

      await batchDao.batchCreate(testEntities);

      // Act
      const keys: CompoundKey[] = [
        { userId: 'user-1', categoryId: 'category-1' },
        { userId: 'user-2', categoryId: 'category-1' },
        { userId: 'non-existent', categoryId: 'non-existent' },
      ];
      const deleteCount = await batchDao.batchDelete(keys);
      const remainingEntities = await batchDao.list();

      // Assert
      expect(deleteCount).toBe(2);
      expect(remainingEntities.length).toBe(1);
      expect(remainingEntities[0].userId).toBe('user-1');
      expect(remainingEntities[0].categoryId).toBe('category-2');
    });
  });
});
