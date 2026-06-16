/**
 * Tests for ComplexRuleDAO + (de)serialize — Story 4.3b Task 3 (FEAT-019).
 *
 * The `complexRules` store (keyPath:'id', NUMBER ids, autoIncrement TRUE;
 * indexes `order` + `categoryId`, both NON-unique) is created by migration v7
 * (a sibling 4.3b task). The harness therefore opens the engine DB through the
 * REAL `ENGINE_MIGRATIONS` lineage (not a hand-rolled store), so the v7 store +
 * indexes exist.
 *
 * Harness mirrors internal/categories/categories-dao.spec.ts and
 * internal/footprint/footprint-dao.spec.ts (direct construction via an
 * openTestDb opened through the migration framework).
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ComplexRuleDAO,
  deserializeRule,
  serializeComplexRule,
  type ComplexRuleDTO,
} from './complex-rules-dao';
import type { ComplexRule } from './decision-tree';
import { createDescriptionRule } from './rule-factories';
import type { Category } from '../categories/types';
import { LocalizableException } from '../utils/messages';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/**
 * Opens a test DB with the complexRules store via the REAL engine migration
 * lineage, so the v7 store + `order`/`categoryId` indexes are present.
 */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

/** A Category with a service-minted string id. */
function category(id?: string): Category {
  return {
    id,
    name: 'Groceries',
    icon: 'glyph-cart',
    isArchived: false,
    currency: 'UAH',
  };
}

/** A ComplexRule carrying one description rule + the given category. */
function complexRule(cat: Category, id?: number): ComplexRule {
  return {
    id,
    rules: [createDescriptionRule({ type: 'equals', value: 'COFFEE' })],
    category: cat,
    evaluate: () => false,
  };
}

describe('serializeComplexRule', () => {
  it('maps category.id → categoryId (string) and rules → RuleDTO[]', () => {
    const dto = serializeComplexRule(complexRule(category('cat-x')), 3);

    expect(dto.categoryId).toBe('cat-x');
    expect(typeof dto.categoryId).toBe('string');
    expect(dto.order).toBe(3);
    expect(dto.rules).toEqual([
      { field: 'description', operation: { type: 'equals', value: 'COFFEE' } },
    ]);
  });

  it('throws LocalizableException when category.id is missing', () => {
    expect(() => serializeComplexRule(complexRule(category(undefined)), 0)).toThrow(
      LocalizableException
    );
  });
});

describe('deserializeRule', () => {
  it('rebuilds a Rule that evaluates (delegates to the rehydrate path)', () => {
    const rule = deserializeRule({
      field: 'description',
      operation: { type: 'equals', value: 'COFFEE' },
    });

    expect(rule).not.toBeNull();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(rule!.evaluate({ description: 'COFFEE' } as any)).toBe(true);
  });
});

describe('ComplexRuleDAO', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: ComplexRuleDAO;

  beforeEach(async () => {
    dbName = `test-complex-rules-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    dao = new ComplexRuleDAO(() => db);
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

  it('create assigns an autoIncrement NUMBER id when none is supplied', async () => {
    const dto: ComplexRuleDTO = {
      rules: [{ field: 'description', operation: { type: 'equals', value: 'A' } }],
      categoryId: 'cat-a',
      order: 0,
    };

    const created = await dao.create(dto);

    expect(typeof created.id).toBe('number');
  });

  it('read round-trips a created DTO', async () => {
    const created = await dao.create({
      rules: [{ field: 'description', operation: { type: 'equals', value: 'A' } }],
      categoryId: 'cat-a',
      order: 0,
    });

    const found = await dao.read(created.id as number);

    expect(found).toEqual(created);
  });

  it('getAllOrdered() returns DTOs sorted by order ascending', async () => {
    await dao.create({ rules: [], categoryId: 'cat-a', order: 2 });
    await dao.create({ rules: [], categoryId: 'cat-b', order: 0 });
    await dao.create({ rules: [], categoryId: 'cat-c', order: 1 });

    const ordered = await dao.getAllOrdered();

    expect(ordered.map((r) => r.order)).toEqual([0, 1, 2]);
    expect(ordered.map((r) => r.categoryId)).toEqual(['cat-b', 'cat-c', 'cat-a']);
  });

  it('getByCategoryId() filters by the categoryId index', async () => {
    await dao.create({ rules: [], categoryId: 'cat-x', order: 0 });
    await dao.create({ rules: [], categoryId: 'cat-x', order: 1 });
    await dao.create({ rules: [], categoryId: 'cat-y', order: 2 });

    const matched = await dao.getByCategoryId('cat-x');

    expect(matched).toHaveLength(2);
    expect(matched.every((r) => r.categoryId === 'cat-x')).toBe(true);
  });

  it('update() mutates an existing DTO and read reflects it', async () => {
    const created = await dao.create({
      rules: [],
      categoryId: 'cat-a',
      order: 0,
    });

    await dao.update(created.id as number, { ...created, order: 5 });

    const found = await dao.read(created.id as number);
    expect(found?.order).toBe(5);
  });

  it('delete() removes a DTO', async () => {
    const created = await dao.create({ rules: [], categoryId: 'cat-a', order: 0 });

    const deleted = await dao.delete(created.id as number);

    expect(deleted).toBe(true);
    expect(await dao.read(created.id as number)).toBeNull();
  });
});
