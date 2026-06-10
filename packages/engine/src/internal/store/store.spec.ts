/**
 * Vitest tests for the Store module interfaces (ported from prior-art Jest suite).
 */
import { describe, expect, it } from 'vitest';
import type { BatchDao, Dao } from './dao';
import { isCompoundKey, isSimpleKey } from './key';
import type { CompoundKey, SimpleKey } from './key';

describe('Store Module', () => {
  describe('Key Types', () => {
    it('should correctly identify simple keys', () => {
      const stringKey: SimpleKey = 'test-key';
      const numberKey: SimpleKey = 123;
      const dateKey: SimpleKey = new Date();

      expect(isSimpleKey(stringKey)).toBe(true);
      expect(isSimpleKey(numberKey)).toBe(true);
      expect(isSimpleKey(dateKey)).toBe(true);
      expect(isCompoundKey(stringKey)).toBe(false);
      expect(isCompoundKey(numberKey)).toBe(false);
      expect(isCompoundKey(dateKey)).toBe(false);
    });

    it('should correctly identify compound keys', () => {
      const compoundKey: CompoundKey = { id: 'user-123', type: 'admin' };

      expect(isCompoundKey(compoundKey)).toBe(true);
      expect(isSimpleKey(compoundKey)).toBe(false);
    });
  });

  describe('DAO Interfaces', () => {
    it('should allow creating mock implementations of Dao interface', async () => {
      interface User {
        id: string;
        name: string;
        email: string;
      }

      class MockUserDao implements Dao<string, User> {
        private users: User[] = [];

        async create(entity: User): Promise<User> {
          this.users.push(entity);
          return entity;
        }
        async read(key: string): Promise<User | null> {
          const user = this.users.find((u) => u.id === key);
          return user || null;
        }
        async update(key: string, entity: User): Promise<User | null> {
          const index = this.users.findIndex((u) => u.id === key);
          if (index === -1) return null;
          this.users[index] = entity;
          return entity;
        }
        async delete(key: string): Promise<boolean> {
          const index = this.users.findIndex((u) => u.id === key);
          if (index === -1) return false;
          this.users.splice(index, 1);
          return true;
        }
        async list(): Promise<User[]> {
          return [...this.users];
        }
        async find(criteria: (entity: User) => boolean): Promise<User[]> {
          return this.users.filter(criteria);
        }
        async findByIndex(
          _indexName: string,
          _value: unknown,
          _criteria?: (entity: User) => boolean
        ): Promise<User[]> {
          return [];
        }
        async upsert(entity: User): Promise<User> {
          const index = this.users.findIndex((u) => u.id === entity.id);
          if (index === -1) {
            this.users.push(entity);
          } else {
            this.users[index] = entity;
          }
          return entity;
        }
        async getAllKeys(): Promise<string[]> {
          return this.users.map((user) => user.id);
        }
      }

      const userDao = new MockUserDao();
      const testUser: User = {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
      };

      await userDao.create(testUser);
      const retrievedUser = await userDao.read('user-1');
      const allUsers = await userDao.list();
      const foundUsers = await userDao.find((u) => u.name === 'Test User');

      expect(retrievedUser).toEqual(testUser);
      expect(allUsers.length).toBe(1);
      expect(foundUsers.length).toBe(1);
    });

    it('should allow creating mock implementations of BatchDao interface', async () => {
      interface Product {
        sku: string;
        name: string;
        price: number;
      }

      class MockProductDao implements BatchDao<string, Product> {
        private products: Product[] = [];

        async create(entity: Product): Promise<Product> {
          this.products.push(entity);
          return entity;
        }
        async read(key: string): Promise<Product | null> {
          const product = this.products.find((p) => p.sku === key);
          return product || null;
        }
        async update(key: string, entity: Product): Promise<Product | null> {
          const index = this.products.findIndex((p) => p.sku === key);
          if (index === -1) return null;
          this.products[index] = entity;
          return entity;
        }
        async delete(key: string): Promise<boolean> {
          const index = this.products.findIndex((p) => p.sku === key);
          if (index === -1) return false;
          this.products.splice(index, 1);
          return true;
        }
        async list(): Promise<Product[]> {
          return [...this.products];
        }
        async find(criteria: (entity: Product) => boolean): Promise<Product[]> {
          return this.products.filter(criteria);
        }
        async findByIndex(
          _indexName: string,
          _value: unknown,
          _criteria?: (entity: Product) => boolean
        ): Promise<Product[]> {
          return [];
        }
        async upsert(entity: Product): Promise<Product> {
          const index = this.products.findIndex((p) => p.sku === entity.sku);
          if (index === -1) {
            this.products.push(entity);
          } else {
            this.products[index] = entity;
          }
          return entity;
        }
        async batchCreate(entities: Product[]): Promise<Product[]> {
          this.products.push(...entities);
          return entities;
        }
        async batchRead(keys: string[]): Promise<Product[]> {
          return this.products.filter((p) => keys.includes(p.sku));
        }
        async batchUpdate(
          updates: Array<{ key: string; entity: Product }>
        ): Promise<Product[]> {
          const updatedProducts: Product[] = [];
          for (const update of updates) {
            const index = this.products.findIndex((p) => p.sku === update.key);
            if (index !== -1) {
              this.products[index] = update.entity;
              updatedProducts.push(update.entity);
            }
          }
          return updatedProducts;
        }
        async batchDelete(keys: string[]): Promise<number> {
          const initialCount = this.products.length;
          this.products = this.products.filter((p) => !keys.includes(p.sku));
          return initialCount - this.products.length;
        }
        async batchUpsert(entities: Product[]): Promise<Product[]> {
          const upsertedProducts: Product[] = [];
          for (const entity of entities) {
            const index = this.products.findIndex((p) => p.sku === entity.sku);
            if (index !== -1) {
              this.products[index] = entity;
            } else {
              this.products.push(entity);
            }
            upsertedProducts.push(entity);
          }
          return upsertedProducts;
        }
        async getAllKeys(): Promise<string[]> {
          return this.products.map((p) => p.sku);
        }
      }

      const productDao = new MockProductDao();
      const testProducts: Product[] = [
        { sku: 'prod-1', name: 'Product 1', price: 10.99 },
        { sku: 'prod-2', name: 'Product 2', price: 20.99 },
      ];

      await productDao.batchCreate(testProducts);
      const retrievedProducts = await productDao.batchRead([
        'prod-1',
        'prod-2',
      ]);
      const updated = await productDao.batchUpdate([
        {
          key: 'prod-1',
          entity: { sku: 'prod-1', name: 'Updated Product 1', price: 15.99 },
        },
      ]);
      const deletedCount = await productDao.batchDelete(['prod-2']);

      expect(retrievedProducts.length).toBe(2);
      expect(updated.length).toBe(1);
      expect(deletedCount).toBe(1);

      const remainingProducts = await productDao.list();
      expect(remainingProducts.length).toBe(1);
      expect(remainingProducts[0].name).toBe('Updated Product 1');
    });

    it('should support compound keys in DAO interfaces', async () => {
      interface OrderItem {
        orderId: string;
        productId: string;
        quantity: number;
        price: number;
      }
      type OrderItemKey = { orderId: string; productId: string };

      class MockOrderItemDao implements Dao<OrderItemKey, OrderItem> {
        private items: OrderItem[] = [];
        async create(entity: OrderItem): Promise<OrderItem> {
          this.items.push(entity);
          return entity;
        }
        async read(key: OrderItemKey): Promise<OrderItem | null> {
          const item = this.items.find(
            (i) => i.orderId === key.orderId && i.productId === key.productId
          );
          return item || null;
        }
        async update(
          key: OrderItemKey,
          entity: OrderItem
        ): Promise<OrderItem | null> {
          const index = this.items.findIndex(
            (i) => i.orderId === key.orderId && i.productId === key.productId
          );
          if (index === -1) return null;
          this.items[index] = entity;
          return entity;
        }
        async delete(key: OrderItemKey): Promise<boolean> {
          const index = this.items.findIndex(
            (i) => i.orderId === key.orderId && i.productId === key.productId
          );
          if (index === -1) return false;
          this.items.splice(index, 1);
          return true;
        }
        async list(): Promise<OrderItem[]> {
          return [...this.items];
        }
        async find(
          criteria: (entity: OrderItem) => boolean
        ): Promise<OrderItem[]> {
          return this.items.filter(criteria);
        }
        async findByIndex(
          _indexName: string,
          _value: unknown,
          _criteria?: (entity: OrderItem) => boolean
        ): Promise<OrderItem[]> {
          return [];
        }
        async upsert(entity: OrderItem): Promise<OrderItem> {
          const index = this.items.findIndex(
            (i) =>
              i.orderId === entity.orderId && i.productId === entity.productId
          );
          if (index === -1) {
            this.items.push(entity);
          } else {
            this.items[index] = entity;
          }
          return entity;
        }
        async getAllKeys(): Promise<OrderItemKey[]> {
          return this.items.map((item) => ({
            orderId: item.orderId,
            productId: item.productId,
          }));
        }
      }

      const orderItemDao = new MockOrderItemDao();
      const testItem: OrderItem = {
        orderId: 'order-1',
        productId: 'prod-1',
        quantity: 2,
        price: 10.99,
      };

      await orderItemDao.create(testItem);
      const retrievedItem = await orderItemDao.read({
        orderId: 'order-1',
        productId: 'prod-1',
      });

      expect(retrievedItem).toEqual(testItem);
    });
  });
});
