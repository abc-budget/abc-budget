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
   * Unique identifier for the category
   * Auto-incremented by the database
   */
  id?: number;

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
   * Optional image URL for the category
   */
  image?: string;

  /**
   * Optional metadata for the image
   */
  imageMetadata?: Record<string, unknown>;

  /**
   * Whether the category is archived
   * Instead of deletion, we use the archive concept
   * @default false
   */
  isArchived: boolean;

  /**
   * Currency ISO code for the category
   * If not provided, the base currency will be used
   */
  // TODO(4.3): tighten to CurrencyCode
  currency: string;
}
