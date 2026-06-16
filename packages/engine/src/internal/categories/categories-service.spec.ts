/**
 * Tests for CategoriesService — Story 4.3a Task 4.
 *
 * The service is the CRUD surface EP-4 needs: it mints the entity's STRING id
 * (crypto.randomUUID), validates name/currency, and resolves the living «base»
 * alias AT READ ONLY (the stored row keeps the literal `'base'`).
 *
 * Harness mirrors internal/categories/categories-dao.spec.ts: a REAL
 * CategoriesDAO and a REAL UserSettingsIDBDAO are constructed directly over a
 * single fake-indexeddb database opened through the REAL `ENGINE_MIGRATIONS`
 * lineage (so the v6 `categories` store and the v3 `userSettings` store both
 * exist). The settings DAO is the one base-currency.ts reads through.
 */
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CategoriesService,
  InvalidCategoryError,
  BASE_CURRENCY_ALIAS,
} from './categories-service';
import { CategoriesDAO } from './categories-dao';
import type { Category } from './types';
import { UserSettingsIDBDAO } from '../settings/user-settings-idb';
import { setBaseCurrency } from '../settings/base-currency';
import { ENGINE_MIGRATIONS } from '../persistence/engine-db';
import { openDatabase } from '../store/migrations/open-with-migrations';

/**
 * Opens a test DB through the REAL engine migration lineage, so both the v6
 * `categories` store and the v3 `userSettings` store are present.
 */
function openTestDb(name: string): Promise<IDBDatabase> {
  return openDatabase(name, ENGINE_MIGRATIONS);
}

describe('CategoriesService', () => {
  let dbName: string;
  let db: IDBDatabase;
  let dao: CategoriesDAO;
  let settingsDao: UserSettingsIDBDAO;
  let service: CategoriesService;

  beforeEach(async () => {
    dbName = `test-categories-service-db-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    db = await openTestDb(dbName);
    dao = new CategoriesDAO(() => db);
    settingsDao = new UserSettingsIDBDAO(() => db);
    service = new CategoriesService(dao, settingsDao);
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

  // ── create + validation ──────────────────────────────────────────────────

  describe('create', () => {
    it('mints a crypto.randomUUID() STRING id; icon present; no image fields', async () => {
      const created = await service.create({
        name: 'Groceries',
        icon: 'glyph-cart',
        currency: 'UAH',
      });

      expect(typeof created.id).toBe('string');
      expect(created.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(created.icon).toBe('glyph-cart');
      expect(created.isArchived).toBe(false);
      // No image fields leaked in (Unsplash dropped — RISK-008).
      expect(created).not.toHaveProperty('image');
      expect(created).not.toHaveProperty('imageUrl');
    });

    it('defaults isArchived to false when omitted', async () => {
      const created = await service.create({
        name: 'Rent',
        icon: 'glyph-home',
        currency: 'USD',
      });
      expect(created.isArchived).toBe(false);
    });

    it('persists the created row (round-trips through the DAO by minted id)', async () => {
      const created = await service.create({
        name: 'Transport',
        icon: 'glyph-bus',
        currency: 'EUR',
      });
      const raw = await dao.read(created.id as string);
      expect(raw).not.toBeNull();
      expect(raw?.name).toBe('Transport');
      expect(raw?.currency).toBe('EUR');
    });

    it('throws InvalidCategoryError when name is blank', async () => {
      await expect(
        service.create({ name: '   ', icon: 'glyph-cart', currency: 'UAH' }),
      ).rejects.toBeInstanceOf(InvalidCategoryError);
      await expect(
        service.create({ name: '', icon: 'glyph-cart', currency: 'UAH' }),
      ).rejects.toBeInstanceOf(InvalidCategoryError);
    });

    it('throws InvalidCategoryError for an invalid currency', async () => {
      await expect(
        service.create({ name: 'Bad', icon: 'glyph-x', currency: 'NOTACODE' }),
      ).rejects.toBeInstanceOf(InvalidCategoryError);
    });

    it("accepts the literal 'base' currency and STORES it as 'base'", async () => {
      const created = await service.create({
        name: 'Misc',
        icon: 'glyph-dots',
        currency: BASE_CURRENCY_ALIAS,
      });
      // The raw stored row keeps the literal sentinel (no base set yet → fail-soft).
      const raw = await dao.read(created.id as string);
      expect(raw?.currency).toBe(BASE_CURRENCY_ALIAS);
    });
  });

  // ── «base» follows the base (resolution at read ONLY) ──────────────────────

  describe('«base» resolution is living and read-only', () => {
    it('get/list/pick resolve «base» to the current base currency, while the stored row keeps «base»', async () => {
      const created = await service.create({
        name: 'Misc',
        icon: 'glyph-dots',
        currency: BASE_CURRENCY_ALIAS,
      });
      const id = created.id as string;

      await setBaseCurrency(settingsDao, 'UAH');

      expect((await service.get(id))?.currency).toBe('UAH');
      expect((await service.pick(id))?.currency).toBe('UAH');
      const listed = await service.list();
      expect(listed.find((c) => c.id === id)?.currency).toBe('UAH');

      // The alias is LIVING — change base, re-read, resolution follows.
      await setBaseCurrency(settingsDao, 'USD');
      expect((await service.get(id))?.currency).toBe('USD');
      const listed2 = await service.list();
      expect(listed2.find((c) => c.id === id)?.currency).toBe('USD');

      // PROOF: resolution is read-only — the stored row still holds 'base'.
      const raw = await dao.read(id);
      expect(raw?.currency).toBe(BASE_CURRENCY_ALIAS);
    });

    it('leaves «base» as-is (fail-soft) when no base currency is set', async () => {
      const created = await service.create({
        name: 'Misc',
        icon: 'glyph-dots',
        currency: BASE_CURRENCY_ALIAS,
      });
      const id = created.id as string;

      // No base set → reading must NOT throw; the alias stays.
      const got = await service.get(id);
      expect(got?.currency).toBe(BASE_CURRENCY_ALIAS);
    });

    it('does not touch a non-base currency on read', async () => {
      const created = await service.create({
        name: 'Salary',
        icon: 'glyph-coin',
        currency: 'USD',
      });
      await setBaseCurrency(settingsDao, 'UAH');
      const got = await service.get(created.id as string);
      expect(got?.currency).toBe('USD');
    });
  });

  // ── inline create-from-search (ENT-018) ────────────────────────────────────

  describe('createFromSearch (inline create-from-search, ENT-018)', () => {
    it('creates and returns a new category when none matches (auto-select)', async () => {
      const created = await service.createFromSearch('Coffee');
      expect(created.name).toBe('Coffee');
      expect(typeof created.id).toBe('string');
      expect(created.currency).toBe(BASE_CURRENCY_ALIAS);
      expect(created.icon).toBeTruthy();
    });

    it('returns the SAME category on a case-insensitive repeat (no dupe)', async () => {
      const first = await service.createFromSearch('Coffee');
      const second = await service.createFromSearch('coffee');

      expect(second.id).toBe(first.id);
      // Exactly one row persisted.
      const all = await dao.list();
      expect(all.filter((c) => c.name.toLowerCase() === 'coffee')).toHaveLength(1);
    });

    it('trims surrounding whitespace when matching', async () => {
      const first = await service.createFromSearch('Coffee');
      const second = await service.createFromSearch('  COFFEE  ');
      expect(second.id).toBe(first.id);
    });
  });

  // ── list / archive / unarchive ─────────────────────────────────────────────

  describe('list / archive / unarchive', () => {
    it('list() drops archived by default and includes them when asked', async () => {
      const active = await service.create({
        name: 'Active',
        icon: 'g',
        currency: 'UAH',
      });
      const toArchive = await service.create({
        name: 'Gone',
        icon: 'g',
        currency: 'UAH',
      });
      await service.archive(toArchive.id as string);

      const defaultList = await service.list();
      expect(defaultList.map((c) => c.id)).toEqual([active.id]);

      const withArchived = await service.list({ includeArchived: true });
      expect(withArchived.map((c) => c.id).sort()).toEqual(
        [active.id, toArchive.id].sort(),
      );
    });

    it('archive() / unarchive() flip isArchived and move the row between active/archived', async () => {
      const created = await service.create({
        name: 'Flip',
        icon: 'g',
        currency: 'UAH',
      });
      const id = created.id as string;

      const archived = await service.archive(id);
      expect(archived.isArchived).toBe(true);
      expect((await dao.getActive()).map((c: Category) => c.id)).toEqual([]);
      expect((await dao.getArchived()).map((c: Category) => c.id)).toEqual([id]);

      const unarchived = await service.unarchive(id);
      expect(unarchived.isArchived).toBe(false);
      expect((await dao.getActive()).map((c: Category) => c.id)).toEqual([id]);
      expect((await dao.getArchived()).map((c: Category) => c.id)).toEqual([]);
    });
  });

  // ── get / pick on a missing row ────────────────────────────────────────────

  describe('get / pick — missing row', () => {
    it('get() returns null for an unknown id', async () => {
      expect(await service.get('nope')).toBeNull();
    });

    it('pick() returns null for an unknown id', async () => {
      expect(await service.pick('nope')).toBeNull();
    });
  });
});
