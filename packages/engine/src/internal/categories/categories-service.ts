/**
 * Categories service — the CRUD surface EP-4 needs (Story 4.3a Task 4, ENT-018).
 * @module internal/categories/categories-service
 * @internal
 *
 * PORT of `webapp/libs/engine/src/categories/service.ts`
 * (`CategoriesServiceImpl`, `InvalidCategoryError`). Adaptations (diff-audit
 * tracked here):
 *
 * 1. **IoC → direct DI**: the constructor takes its deps DIRECTLY — a
 *    `CategoriesDAO` and the `UserSettingsDAO` that base-currency.ts reads
 *    through — instead of resolving them from an IoC `Container`. No
 *    `Container` / `IoCKeys` / `CurrencyCache` / `UserSettingsService` imports.
 *
 * 2. **Service-minted STRING id**: `create` mints `crypto.randomUUID()` (the
 *    store uses string ids, NO autoIncrement). Prior-art numeric ids are gone.
 *
 * 3. **Living «base» alias (Story 4.3a ruling 3)**: `currency` may hold the
 *    literal sentinel `'base'`. It is STORED as given (never baked) and
 *    resolved to the base currency AT READ ONLY (get/list/pick). Resolution is
 *    fail-soft: with no base set the alias stays (base-not-set is an EP-1 setup
 *    concern — never throw on read). The prior-art save-time "bake the base"
 *    branch is dropped.
 *
 * 4. **Currency validation via the 1.6 reference**: ISO codes are validated
 *    with `getCurrency(code) !== undefined` (the prior-art CurrencyCache is
 *    gone); the literal `'base'` is also accepted.
 *
 * NO archive-management UI — archive/unarchive are methods only (management UI
 * is EP-7). NOT on the public barrel.
 */

import { getCurrency } from '../currency/reference';
import { getBaseCurrencyOrNull } from '../settings/base-currency';
import type { UserSettingsDAO } from '../settings/user-settings';
import type { CategoriesDAO } from './categories-dao';
import type { Category } from './types';

/**
 * The living «base» currency sentinel. A category whose `currency` holds this
 * literal is resolved to the configured base currency AT READ (Story 4.3a
 * ruling 3); the stored row keeps the literal.
 */
export const BASE_CURRENCY_ALIAS = 'base';

/**
 * Default glyph for a category created without an explicit icon (inline
 * create-from-search). An ALTUS glyph-id, never an image URL (RISK-008).
 */
const DEFAULT_CATEGORY_ICON = 'glyph-tag';

/**
 * The fields a caller supplies to create a category. The service mints `id`
 * and defaults `isArchived`, so both are optional here.
 */
export type CreateCategoryInput = Omit<Category, 'id' | 'isArchived'> & {
  isArchived?: boolean;
};

/**
 * Error thrown when a category fails validation.
 *
 * PORT of the prior-art `InvalidCategoryError` — same `Invalid category: …`
 * message prefix and `name`.
 */
export class InvalidCategoryError extends Error {
  constructor(message: string) {
    super(`Invalid category: ${message}`);
    this.name = 'InvalidCategoryError';
    Object.setPrototypeOf(this, InvalidCategoryError.prototype);
  }
}

/**
 * The categories CRUD service.
 *
 * Deps are injected DIRECTLY (no IoC Container): the categories DAO and the
 * user-settings DAO that base-currency resolution reads through.
 */
export class CategoriesService {
  private readonly dao: CategoriesDAO;
  private readonly userSettingsDao: UserSettingsDAO;

  /**
   * @param categoriesDao - The categories DAO (persistence)
   * @param userSettingsDao - The user-settings DAO (read-through for «base»)
   */
  constructor(categoriesDao: CategoriesDAO, userSettingsDao: UserSettingsDAO) {
    this.dao = categoriesDao;
    this.userSettingsDao = userSettingsDao;
  }

  /**
   * Creates a category: validates, mints a STRING id, and persists.
   *
   * The `currency` is stored AS GIVEN — the «base» alias stays living and is
   * resolved only at read (get/list/pick), never baked here.
   *
   * @throws {InvalidCategoryError} on a blank name or an unknown currency
   */
  async create(input: CreateCategoryInput): Promise<Category> {
    this.validate(input);

    // determinism: classified user-action site — fresh PK, not data-derived
    // (Story 4.3a ruling 2). A category create is a user action, so a random
    // UUID is correct here and exempt from the HC-9 determinism rule.
    const id = crypto.randomUUID();

    const category: Category = {
      ...input,
      id,
      isArchived: input.isArchived ?? false,
    };
    return this.dao.create(category);
  }

  /**
   * Inline create-from-search (ENT-018): if a category already matches `name`
   * (case-insensitive, trimmed), return it (no dupe — auto-select); otherwise
   * create a new «base»-currency category with the default glyph and return it.
   */
  async createFromSearch(name: string): Promise<Category> {
    const needle = name.trim().toLowerCase();
    const existing = await this.dao.list();
    const match = existing.find((c) => c.name.trim().toLowerCase() === needle);
    if (match) {
      return this.resolveBase(match);
    }
    return this.create({
      name: name.trim(),
      currency: BASE_CURRENCY_ALIAS,
      icon: DEFAULT_CATEGORY_ICON,
    });
  }

  /**
   * Lists categories, dropping archived rows unless `includeArchived` is set.
   * Each returned row has its «base» alias resolved.
   */
  async list(opts?: { includeArchived?: boolean }): Promise<Category[]> {
    const all = await this.dao.list();
    const visible = opts?.includeArchived
      ? all
      : all.filter((c) => c.isArchived === false);
    return Promise.all(visible.map((c) => this.resolveBase(c)));
  }

  /**
   * Reads a category by id (or null), with its «base» alias resolved.
   */
  async get(id: string): Promise<Category | null> {
    const category = await this.dao.read(id);
    return category ? this.resolveBase(category) : null;
  }

  /**
   * Selection accessor — same as {@link get} (resolves «base»). The distinct
   * name keeps the call-site intent (picking the selected category) explicit
   * for EP-4.
   */
  async pick(id: string): Promise<Category | null> {
    return this.get(id);
  }

  /**
   * Archives a category (soft-delete: archive != delete).
   * @throws {Error} if the category is not found
   */
  async archive(id: string): Promise<Category> {
    return this.setArchived(id, true);
  }

  /**
   * Unarchives a category.
   * @throws {Error} if the category is not found
   */
  async unarchive(id: string): Promise<Category> {
    return this.setArchived(id, false);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Validates the create input: a non-blank name and a currency that is either
   * a valid ISO code or the living «base» alias.
   */
  private validate(input: CreateCategoryInput): void {
    if (!input.name || input.name.trim() === '') {
      throw new InvalidCategoryError('Name is required');
    }
    if (!input.icon || input.icon.trim() === '') {
      throw new InvalidCategoryError('Icon is required');
    }
    const currency = input.currency;
    const isBaseAlias = currency === BASE_CURRENCY_ALIAS;
    const isKnownIso = getCurrency(currency) !== undefined;
    if (!isBaseAlias && !isKnownIso) {
      throw new InvalidCategoryError(`Invalid currency: ${currency}`);
    }
  }

  /**
   * Reads, flips `isArchived`, persists, and returns the updated row.
   */
  private async setArchived(id: string, isArchived: boolean): Promise<Category> {
    const category = await this.dao.read(id);
    if (!category) {
      throw new Error(`Category with ID ${id} not found`);
    }
    const updated: Category = { ...category, isArchived };
    await this.dao.update(id, updated);
    return updated;
  }

  /**
   * Resolves the living «base» alias on a RETURNED object only — never the
   * stored row. Returns a shallow copy so the caller can't mutate persistence.
   *
   * Fail-soft: with no base currency set, the alias is LEFT as `'base'`
   * (base-not-set is an EP-1 setup concern — do NOT throw on read).
   */
  private async resolveBase(category: Category): Promise<Category> {
    if (category.currency !== BASE_CURRENCY_ALIAS) {
      return { ...category };
    }
    const base = await getBaseCurrencyOrNull(this.userSettingsDao);
    return { ...category, currency: base ?? BASE_CURRENCY_ALIAS };
  }
}
