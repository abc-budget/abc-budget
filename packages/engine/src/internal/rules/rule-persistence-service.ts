/**
 * Rule persistence service — Story 4.3b Task 4 (FEAT-019).
 * @module internal/rules/rule-persistence-service
 * @internal
 *
 * The CRUD + reorder + reload + saveDecisionTree-delta surface over the
 * {@link ComplexRuleDAO}. It turns the persisted {@link ComplexRuleDTO} rows
 * into a live {@link DecisionTree} (and back), resolving each rule's category
 * through the {@link CategoriesService} so the living «base» alias resolves AT
 * RELOAD.
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/decision-tree/service.ts`
 * (`saveDecisionTree` content-match delta + `_loadDecisionTree` join) with these
 * ADAPTs:
 *
 *  - **Reactive-stream-FREE**: no emitting subject / stream type. `reload()` is
 *    a plain `async` that RETURNS the rebuilt tree directly.
 *  - **Direct DI**: the constructor takes the `ComplexRuleDAO` and the
 *    `CategoriesService` directly (no IoC `Container`). It takes the SERVICE
 *    (not the raw categories DAO) so the «base» alias resolves at reload.
 *  - **Dangling-categoryId is RETAINED (RULING 1)**: a DTO whose `categoryId`
 *    resolves to no category is SKIPPED from the rebuilt tree and LOUDLY
 *    logged, but the row is NEVER deleted — retain is the recovery path.
 *  - **Policy-free**: NO live-vs-sandbox gating (that is Story 4.5). Raw
 *    primitives only.
 *
 * This module is INTERNAL — deliberately NOT wired into the public barrel.
 */

import type { CategoriesService } from '../categories/categories-service';
import { getLogger } from '../logging';
import {
  ComplexRuleDAO,
  type ComplexRuleDTO,
  deserializeRule,
  serializeComplexRule,
} from './complex-rules-dao';
import { ComplexRuleImpl, DecisionTreeImpl } from './decision-tree-impl';
import type { ComplexRule, DecisionTree } from './decision-tree';
import { reorderRuleOrders } from './order-utils';
import type { Rule } from './rule';

/** Default name for the in-memory working tree (it is an unnamed working tree). */
const WORKING_TREE_NAME = 'Decision Tree';

/** Default description for the in-memory working tree. */
const WORKING_TREE_DESCRIPTION = 'Automatically categorizes transactions';

const logger = getLogger('rule-persistence');

/**
 * Persists {@link ComplexRule}s and rebuilds the {@link DecisionTree}.
 *
 * Deps are injected DIRECTLY (no IoC Container): the complex-rule DAO and the
 * categories SERVICE (so «base» resolves at reload).
 */
export class RulePersistenceService {
  private readonly dao: ComplexRuleDAO;
  private readonly categoriesService: CategoriesService;

  /**
   * @param complexRuleDao - The complex-rule DAO (persistence)
   * @param categoriesService - The categories service (FK resolution + «base»)
   */
  constructor(
    complexRuleDao: ComplexRuleDAO,
    categoriesService: CategoriesService
  ) {
    this.dao = complexRuleDao;
    this.categoriesService = categoriesService;
  }

  /**
   * Creates a complex rule, appending it to the end of the eval sequence.
   *
   * The new `order` is `(max existing order) + 1`, or `0` when the store is
   * empty.
   *
   * @param complexRule The complex rule to persist (its category must have an id)
   * @returns The persisted DTO (with its store-minted number id)
   */
  async create(complexRule: ComplexRule): Promise<ComplexRuleDTO> {
    const existing = await this.dao.list();
    const order =
      existing.length === 0
        ? 0
        : Math.max(...existing.map((dto) => dto.order)) + 1;

    return this.dao.create(serializeComplexRule(complexRule, order));
  }

  /**
   * Updates a complex rule in place, PRESERVING its existing `order`.
   *
   * @param complexRule The complex rule to update (its `id` must already exist)
   * @throws {Error} if no persisted DTO matches `complexRule.id`
   */
  async update(complexRule: ComplexRule): Promise<void> {
    const existing = await this.dao.list();
    const current = existing.find((dto) => dto.id === complexRule.id);
    if (!current) {
      throw new Error(`Complex rule with id ${complexRule.id} not found`);
    }

    await this.dao.update(
      current.id as number,
      serializeComplexRule(complexRule, current.order)
    );
  }

  /**
   * Reorders the eval sequence of the given rule ids.
   *
   * Reads the current `id → order` map, computes the new orders via
   * {@link reorderRuleOrders} (the shared pure helper — NOT reimplemented), then
   * persists ONLY the rules whose order changed. Every id is preserved; only
   * the `order` field is touched.
   *
   * @param ruleIds Rule ids in their desired new eval order
   * @throws {LocalizableException} when a `ruleIds` id is not a known rule
   */
  async reorder(ruleIds: number[]): Promise<void> {
    const dtos = await this.dao.getAllOrdered();

    const currentOrders: Record<number, number> = {};
    for (const dto of dtos) {
      currentOrders[dto.id as number] = dto.order;
    }

    const newOrders = reorderRuleOrders(currentOrders, ruleIds);

    for (const dto of dtos) {
      const id = dto.id as number;
      const newOrder = newOrders[id];
      if (newOrder !== dto.order) {
        // Preserve every field + the id; only `order` changes.
        await this.dao.update(id, { ...dto, order: newOrder });
      }
    }
  }

  /**
   * SYNCHRONOUSLY re-reads the store and rebuilds the decision tree.
   *
   * Plain `async` — RxJS-FREE, returns the rebuilt tree (no emitting subject).
   * DTOs are read IN ORDER; each rule's category is resolved through the
   * categories service so the living «base» alias resolves here. A DTO whose
   * `categoryId` resolves to no category (dangling) is SKIPPED from the tree and
   * LOUDLY logged — but the row is RETAINED (RULING 1: retain is the recovery
   * path, never auto-delete).
   *
   * @returns The rebuilt decision tree over the SURVIVING complex rules
   */
  async reload(): Promise<DecisionTree> {
    const dtos = await this.dao.getAllOrdered();
    const complexRules: ComplexRule[] = [];

    for (const dto of dtos) {
      const category = await this.categoriesService.get(dto.categoryId);
      if (!category) {
        logger.error(
          `[rule-persistence] complexRule ${dto.id} → missing category ${dto.categoryId}; skipping (retained in store)`
        );
        continue;
      }

      const rules: Rule[] = dto.rules
        .map(deserializeRule)
        .filter((rule): rule is Rule => rule !== null);

      complexRules.push(new ComplexRuleImpl(rules, category, dto.id));
    }

    return new DecisionTreeImpl(
      complexRules,
      WORKING_TREE_NAME,
      WORKING_TREE_DESCRIPTION
    );
  }

  /**
   * Persists a decision tree using a content-match DELTA — minimal writes.
   *
   * PORT of the prior-art `saveDecisionTree`, RxJS-free:
   *  1. mint an id (via the categories service) for any rule whose category has
   *     none, writing the minted id back onto the in-memory category;
   *  2. for each tree rule (index = order), reuse an UNUSED existing DTO that
   *     content-matches (same `categoryId` AND same serialized `rules`) by
   *     keeping its id; otherwise create a fresh (autoInc id) row;
   *  3. delete every existing DTO that was not matched.
   *
   * Policy-free — NO live-vs-sandbox logic.
   *
   * @param tree The decision tree to persist
   */
  async saveDecisionTree(tree: DecisionTree): Promise<void> {
    // 1. Ensure every rule's category has an id (mint via the categories service).
    for (const complexRule of tree.complexRules) {
      if (!complexRule.category.id) {
        const saved = await this.categoriesService.create(complexRule.category);
        // The in-memory category is mutated so serializeComplexRule can read the id.
        (complexRule.category as { id?: string }).id = saved.id;
      }
    }

    // 2. Map existing DTOs by id; content-match each tree rule (index = order).
    const existing = await this.dao.list();
    const existingById = new Map<number, ComplexRuleDTO>();
    for (const dto of existing) {
      if (dto.id !== undefined) {
        existingById.set(dto.id, dto);
      }
    }

    const usedExistingIds = new Set<number>();

    for (let i = 0; i < tree.complexRules.length; i++) {
      const serialized = serializeComplexRule(tree.complexRules[i], i);

      let matchedId: number | null = null;
      for (const [existingId, existingDto] of existingById) {
        if (usedExistingIds.has(existingId)) {
          continue;
        }
        if (rulesContentMatch(serialized, existingDto)) {
          matchedId = existingId;
          break;
        }
      }

      if (matchedId !== null) {
        usedExistingIds.add(matchedId);
        // Reuse the id — update the matched row with the new order.
        await this.dao.update(matchedId, { ...serialized, id: matchedId });
      } else {
        // Fresh row — drop any incoming id so the store autoIncrements.
        const { id: _id, ...withoutId } = serialized;
        void _id;
        await this.dao.create(withoutId);
      }
    }

    // 3. Delete existing DTOs that were not matched.
    for (const [existingId] of existingById) {
      if (!usedExistingIds.has(existingId)) {
        await this.dao.delete(existingId);
      }
    }
  }
}

/**
 * Content-match two DTOs: same `categoryId` AND the same serialized `rules`
 * (field + operation, positionally). Used by the saveDecisionTree delta to
 * reuse an existing row's id.
 */
function rulesContentMatch(a: ComplexRuleDTO, b: ComplexRuleDTO): boolean {
  if (a.categoryId !== b.categoryId) {
    return false;
  }
  if (a.rules.length !== b.rules.length) {
    return false;
  }
  for (let i = 0; i < a.rules.length; i++) {
    if (a.rules[i].field !== b.rules[i].field) {
      return false;
    }
    if (
      JSON.stringify(a.rules[i].operation) !==
      JSON.stringify(b.rules[i].operation)
    ) {
      return false;
    }
  }
  return true;
}
