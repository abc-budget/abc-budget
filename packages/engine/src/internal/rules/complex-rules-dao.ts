/**
 * ComplexRule DAO + (de)serialize — Story 4.3b Task 3 (FEAT-019).
 * @module internal/rules/complex-rules-dao
 * @internal
 *
 * SCOPE: the persistence boundary for {@link ComplexRule} — the wire DTOs, the
 * (de)serialize functions, and an `IDBBatchDao<number, ComplexRuleDTO>` over the
 * `complexRules` store (created by migration v7, a sibling 4.3b task). DAO +
 * (de)serialize ONLY — NO service logic (no reorder / reload / saveDecisionTree;
 * that is Task 4).
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/decision-tree/dao.ts`
 * (`RuleDTO`, `ComplexRuleDTO`, `serializeRule`, `serializeComplexRule`, the
 * `ComplexRuleDAO`) with these ADAPTs:
 *
 *  - categoryId is a STRING (the prior art was a number) — aligns with the
 *    string-id Category (Story 4.3a) and `footprint.categoryId: string`.
 *  - Direct DI: the DAO takes a `DbProvider` (no IoC `Container`), mirroring the
 *    footprint/categories/recall-pool DAOs.
 *  - deserializeRule delegates to {@link rehydrateRule} (Task 2) rather than
 *    re-declaring the field→factory switch — the rehydrate path reaches the
 *    module-private bare-amount builder.
 *  - The store config lives in migration v7 (engine-db), so no store-config
 *    constant is re-declared here.
 *
 * This module is INTERNAL — deliberately NOT wired into the public barrel: no
 * rule types may leak across the wire / into the public DTO surface.
 */

import type { Category } from '../categories/types';
import type { DbProvider } from '../store/idb/dao-impl';
import { IDBBatchDao } from '../store/idb/dao-impl';
import {
  createLocalizableMessage,
  LocalizableException,
} from '../utils/messages';
import type { ComplexRule } from './decision-tree';
import type { RuleOperation } from './operations';
import type { Rule } from './rule';
import { rehydrateRule } from './rule-factories';

/**
 * Name of the complex rules store in IndexedDB (created by migration v7).
 */
export const COMPLEX_RULES_STORE = 'complexRules';

/**
 * Data Transfer Object for a single rule.
 * The persisted shape of a {@link Rule} — its field name + raw operation.
 */
export interface RuleDTO {
  /** Persisted field name (the wire is a plain string). */
  field: string;
  /** Persisted operation (the raw discriminated-union object). */
  operation: RuleOperation;
}

/**
 * Data Transfer Object for a complex rule.
 * The persisted shape of a {@link ComplexRule}.
 */
export interface ComplexRuleDTO {
  /**
   * Unique identifier — a NUMBER assigned by the store (autoIncrement).
   * Optional: an unpersisted DTO has no id until `create` mints one.
   */
  id?: number;

  /** The AND-combined rules, each as a {@link RuleDTO}. */
  rules: RuleDTO[];

  /**
   * STRING id of the category to assign if this complex rule matches.
   *
   * ADAPT vs prior art (which used a number): aligns with the string-id
   * Category (Story 4.3a) and `footprint.categoryId: string`.
   */
  categoryId: string;

  /**
   * Eval-sequence order of this rule in the decision tree. Used to restore the
   * rule order when the tree is reconstructed.
   */
  order: number;
}

/**
 * Converts a rule to its DTO for storage.
 * @param rule The rule to serialize
 * @returns The rule DTO
 */
export function serializeRule(rule: Rule): RuleDTO {
  return {
    field: rule.field,
    operation: rule.operation,
  };
}

/**
 * Rebuilds a domain rule from its DTO, delegating to {@link rehydrateRule}
 * (Story 4.3b Task 2 — the rehydrate-only field→factory dispatch).
 * @param dto The rule DTO
 * @returns The reconstructed rule, or `null` for an unsupported field
 */
export function deserializeRule(dto: RuleDTO): Rule | null {
  return rehydrateRule(dto.field, dto.operation);
}

/**
 * Converts a complex rule to its DTO for storage.
 *
 * @param complexRule The complex rule to serialize
 * @param order The eval-sequence order to persist
 * @returns The complex rule DTO
 * @throws {LocalizableException} If the rule's category has no id — a complex
 *   rule cannot be persisted without a resolvable category FK.
 */
export function serializeComplexRule(
  complexRule: ComplexRule,
  order: number
): ComplexRuleDTO {
  const category: Category = complexRule.category;
  if (!category.id) {
    throw new LocalizableException(
      createLocalizableMessage('engine.rules.complex-rule.category-id-required')
    );
  }

  return {
    id: complexRule.id,
    rules: complexRule.rules.map(serializeRule),
    categoryId: category.id,
    order,
  };
}

/**
 * IndexedDB DAO for complex rules.
 *
 * Key is a NUMBER assigned by the store (keyPath:'id', autoIncrement TRUE) —
 * CONTRAST the string-id, non-autoInc categories store. Inherits the full
 * CRUD + batch surface from {@link IDBBatchDao}; adds the two ordered/indexed
 * lookups below.
 */
export class ComplexRuleDAO extends IDBBatchDao<number, ComplexRuleDTO> {
  /**
   * Creates a new ComplexRuleDAO.
   * @param dbProvider - Provides the open database instance
   */
  constructor(dbProvider: DbProvider) {
    super(dbProvider, {
      storeName: COMPLEX_RULES_STORE,
      keyPath: 'id',
    });
  }

  /**
   * Returns all complex rules sorted by `order` ascending.
   */
  async getAllOrdered(): Promise<ComplexRuleDTO[]> {
    const rules = await this.list();
    return rules.sort((a, b) => a.order - b.order);
  }

  /**
   * Returns all complex rules for the given category, via the `categoryId`
   * non-unique index (created in migration v7).
   * @param categoryId - The STRING category id to filter by
   */
  async getByCategoryId(categoryId: string): Promise<ComplexRuleDTO[]> {
    return this.findByIndex('categoryId', categoryId);
  }
}
