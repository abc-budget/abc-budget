/**
 * Category TYPE for the EP-4 rule evaluator (Story 4.2).
 *
 * PORT of `webapp/libs/engine/src/categories/types.ts` — the `Category`
 * interface only. The rule evaluator reads `Category.id`; the rest of the
 * shape is carried verbatim for fidelity with the prior art.
 *
 * SCOPE: this file is the Category TYPE only. Persistence (DAO / store /
 * service) is Story 4.3 — do NOT add it here.
 *
 * @module categories/types
 */

/**
 * Category entity
 */
export interface Category {
  /**
   * Unique identifier for the category.
   *
   * Service-generated `crypto.randomUUID()` string (Story 4.3a ruling) —
   * aligns with `footprint.categoryId: string`. Optional because an
   * unpersisted Category has no id until the service mints one.
   *
   * NOTE (EP-6, flag only — do NOT build here): the TOTAL sentinel
   * `categoryId = -1` becomes a reserved STRING (e.g. `'-1'`) in the
   * string-id space.
   */
  id?: string;

  /**
   * User-defined name for the category
   * Required
   */
  name: string;

  /**
   * Optional description for the category
   */
  description?: string;

  /**
   * Glyph identifier for the category — an ALTUS glyph-id (FEAT-026).
   *
   * This is a glyph identifier, NEVER an image URL. (Unsplash imagery was
   * dropped — RISK-008.)
   */
  icon: string;

  /**
   * Whether the category is archived
   * Instead of deletion, we use the archive concept
   * @default false
   */
  isArchived: boolean;

  /**
   * Currency ISO code for the category.
   *
   * Living «base» alias: may hold the literal sentinel `'base'`, which the
   * categories SERVICE resolves to the base currency AT READ (Story 4.3a
   * ruling 3). Stays typed `string` for that reason.
   */
  currency: string;
}
