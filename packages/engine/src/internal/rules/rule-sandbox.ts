/**
 * Headless rule-tree sandbox — Story 4.5, Task 2 (FEAT-029).
 * @module internal/rules/rule-sandbox
 * @internal
 *
 * The decision engine behind «sandbox vs live» rule edits. A {@link
 * RuleSandboxSession} wraps the live decision tree plus the load-once override
 * context and routes each {@link EditAction} down one of two lanes:
 *
 *  - **live**  — an edit whose effect is LOCAL to one rule and never reorders
 *    the eval sequence (a category swap, an append, or a no-op condition
 *    re-save). While NOT engaged it is applied to the current tree and persisted
 *    IMMEDIATELY (no preview needed — the change can't move another row).
 *  - **sandbox** — an edit that CAN ripple across rows (a reorder, a delete, or
 *    a real condition change). It accumulates into a VIRTUAL tree so the caller
 *    can preview the diff and then `apply()` (persist) or `cancel()` (discard).
 *
 * Once the session is engaged (a virtual tree exists), EVERY further action —
 * even a normally-live one — accumulates into the virtual tree (you cannot
 * live-write underneath a pending preview); it persists only on `apply()`.
 *
 * SPLIT-SYNC:
 *  - `classify` + `computeDiff` are PURE-SYNCHRONOUS — O(1)/bounded, ZERO DB.
 *    `classify` NEVER reads the diff; `computeDiff` only resolves rows through
 *    the in-memory {@link resolveCategory} (no await, no DAO).
 *  - `submit` + `apply` are async (they may persist); `cancel` is sync.
 *
 * Trees are ALWAYS rebuilt through {@link DecisionTreeBuilder} /
 * {@link ComplexRuleBuilder} — never hand-mutated — preserving each
 * complexRule's id + category + rules and the tree's name + id.
 *
 * RxJS-FREE. INTERNAL — deliberately NOT wired into the public barrel; no
 * CONTRACT_VERSION change.
 */

import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { conditionsEqual } from './canonical-conditions';
import { resolveCategory } from './categorize-with-overrides';
import {
  ComplexRuleBuilder,
  DecisionTreeBuilder,
} from './decision-tree-builder';
import type { ComplexRule, DecisionTree } from './decision-tree';
import type { RulePersistenceService } from './rule-persistence-service';
import type { Rule } from './rule';

/**
 * A single rule-tree edit the user can perform.
 *
 *  - `reorder`         — the complexRule ids in their new eval order.
 *  - `delete`          — drop the complexRule with `ruleId`.
 *  - `editConditions`  — replace a rule's conditions (`before` → `after`).
 *  - `categoryOnly`    — change only a rule's target category.
 *  - `appendEnd`       — add a brand-new complexRule at the end of the sequence.
 */
export type EditAction =
  | { kind: 'reorder'; order: number[] }
  | { kind: 'delete'; ruleId: number }
  | { kind: 'editConditions'; ruleId: number; before: Rule[]; after: Rule[] }
  | { kind: 'categoryOnly'; ruleId: number; category: Category }
  | { kind: 'appendEnd'; rule: ComplexRule };

/**
 * The load-once dependencies a sandbox session reads through.
 *
 *  - `importRows`     — the stage-3 rows under preview (resolved by `rowIndex`).
 *  - `overrideMap`    — `hash → categoryId` (L2 persisted overrides).
 *  - `categoriesById` — `id → Category` (the full, «base»-resolved index).
 *  - `currentTree`    — the live decision tree at session start.
 *  - `persistence`    — the persistence seam (DI'd; never `new`'d inside).
 */
export interface RuleSandboxDeps {
  importRows: readonly ImportStatementStage3Row[];
  overrideMap: Map<string, string>;
  categoriesById: Map<string, Category>;
  currentTree: DecisionTree;
  persistence: RulePersistenceService;
}

/**
 * One changed row in the sandbox preview: its category id under the CURRENT tree
 * (`oldCategoryId`) versus the EFFECTIVE (virtual, if engaged) tree
 * (`newCategoryId`). Emitted only when the two ids differ.
 */
export interface DiffRow {
  rowIndex: number;
  oldCategoryId: string | null;
  newCategoryId: string | null;
}

/**
 * The headless rule-tree sandbox session.
 *
 * Holds the current tree and an optional virtual tree (the pending preview). The
 * caller drives it via `classify` (which lane?), `submit` (apply an action),
 * `computeDiff` (preview), and `apply`/`cancel` (commit/discard).
 */
export class RuleSandboxSession {
  private readonly importRows: readonly ImportStatementStage3Row[];
  private readonly overrideMap: Map<string, string>;
  private readonly categoriesById: Map<string, Category>;
  private readonly persistence: RulePersistenceService;

  private currentTree: DecisionTree;
  private virtualTree: DecisionTree | null = null;

  constructor(deps: RuleSandboxDeps) {
    this.importRows = deps.importRows;
    this.overrideMap = deps.overrideMap;
    this.categoriesById = deps.categoriesById;
    this.persistence = deps.persistence;
    this.currentTree = deps.currentTree;
  }

  /** True once a virtual (preview) tree exists. */
  get engaged(): boolean {
    return this.virtualTree !== null;
  }

  /**
   * Routes an action to its lane — PURE-SYNCHRONOUS, O(1)/bounded, ZERO DB.
   *
   * NEVER reads the diff: the lane is a property of the ACTION SHAPE, not of how
   * many rows it happens to move. So a `delete` of a rule that matches no row is
   * still 'sandbox' (it could ripple in general). The only diff-shaped subtlety
   * is `editConditions`, whose lane is decided by an ORDER-INDEPENDENT condition
   * compare ({@link conditionsEqual}) — a pure structural check on the action's
   * own `before`/`after`, not a row diff.
   *
   * @param action The edit to classify
   * @returns `'sandbox'` (preview-first) or `'live'` (immediate write)
   */
  classify(action: EditAction): 'sandbox' | 'live' {
    switch (action.kind) {
      case 'reorder':
        return 'sandbox';
      case 'delete':
        return 'sandbox';
      case 'categoryOnly':
        return 'live';
      case 'appendEnd':
        return 'live';
      case 'editConditions':
        // A pure reorder / re-save of the same condition SET is a no-op → live.
        return conditionsEqual(action.before, action.after) ? 'live' : 'sandbox';
    }
  }

  /**
   * Computes the row-level preview diff — PURE-SYNCHRONOUS, ZERO DB.
   *
   * For each import row, resolves its category under the CURRENT tree and under
   * the EFFECTIVE tree (the virtual tree if engaged, else the current tree), and
   * emits a {@link DiffRow} only when the two category ids DIFFER. Resolution
   * goes through {@link resolveCategory}, so an L1/L2-overridden row short-
   * circuits BEFORE the tree under BOTH resolutions and therefore can never
   * appear in the diff. When not engaged the effective tree IS the current tree,
   * so the diff is empty.
   *
   * @returns The changed rows; empty when not engaged.
   */
  computeDiff(): DiffRow[] {
    const effective = this.virtualTree ?? this.currentTree;
    const diff: DiffRow[] = [];

    for (const row of this.importRows) {
      const oldC = resolveCategory(row, {
        overrideMap: this.overrideMap,
        categoriesById: this.categoriesById,
        tree: this.currentTree,
      });
      const newC = resolveCategory(row, {
        overrideMap: this.overrideMap,
        categoriesById: this.categoriesById,
        tree: effective,
      });

      const oldId = oldC?.id ?? null;
      const newId = newC?.id ?? null;
      if (oldId !== newId) {
        diff.push({
          rowIndex: row.rowIndex,
          oldCategoryId: oldId,
          newCategoryId: newId,
        });
      }
    }

    return diff;
  }

  /**
   * Applies an action, routing it through the lane decision.
   *
   * LIVE while NOT engaged: apply to the current tree AND persist NOW
   * (`categoryOnly` → `persistence.update`, `appendEnd` → `persistence.create`).
   * SANDBOX, or ANY action once engaged: accumulate into the virtual tree (no
   * persist) — you cannot live-write underneath a pending preview.
   *
   * @param action The edit to apply
   * @returns The lane the action was classified into
   */
  async submit(action: EditAction): Promise<'sandbox' | 'live'> {
    const decision = this.classify(action);

    if (decision === 'live' && !this.engaged) {
      this.currentTree = this.applyActionToTree(this.currentTree, action);
      if (action.kind === 'categoryOnly') {
        await this.persistence.update(
          this.findComplexRule(this.currentTree, action.ruleId)
        );
      } else if (action.kind === 'appendEnd') {
        await this.persistence.create(action.rule);
      }
    } else {
      // sandbox OR already engaged → accumulate into the virtual tree.
      this.virtualTree = this.applyActionToTree(
        this.virtualTree ?? this.currentTree,
        action
      );
    }

    return decision;
  }

  /**
   * Commits the pending preview: persists the virtual tree, then promotes it to
   * current and clears the preview.
   *
   * @throws {Error} when nothing is engaged (no preview to apply)
   */
  async apply(): Promise<void> {
    if (!this.engaged) {
      throw new Error('No sandbox edits to apply');
    }
    const virtual = this.virtualTree as DecisionTree;
    await this.persistence.saveDecisionTree(virtual);
    this.currentTree = virtual;
    this.virtualTree = null;
  }

  /** Discards the pending preview — SYNCHRONOUS; the current tree is unchanged. */
  cancel(): void {
    this.virtualTree = null;
  }

  /** The live tree (accessor for tests / downstream wiring). */
  getCurrentTree(): DecisionTree {
    return this.currentTree;
  }

  /** The pending preview tree, or null when not engaged (accessor for tests). */
  getVirtualTree(): DecisionTree | null {
    return this.virtualTree;
  }

  // ── pure tree rebuilders (via the builders — never hand-mutate) ─────────────

  /**
   * Rebuilds a tree with `action` applied — PURE; always via the builders.
   *
   * Every complexRule is reconstructed through {@link ComplexRuleBuilder}
   * (preserving its id + category + rules), and the tree through
   * {@link DecisionTreeBuilder} (preserving name + id). The five actions:
   *  - `reorder`        — complexRules sorted to match `action.order` (ids not
   *    listed keep their relative trailing order).
   *  - `delete`         — drop the complexRule with `ruleId`.
   *  - `editConditions` — the matching rule rebuilt with `after` (id + category
   *    kept).
   *  - `categoryOnly`   — the matching rule rebuilt with the new category (id +
   *    rules kept).
   *  - `appendEnd`      — push `action.rule` after the existing rules.
   */
  private applyActionToTree(
    tree: DecisionTree,
    action: EditAction
  ): DecisionTree {
    let complexRules: ComplexRule[];

    switch (action.kind) {
      case 'reorder': {
        const rank = new Map<number, number>();
        action.order.forEach((id, index) => rank.set(id, index));
        // Stable sort: listed ids by their position; unlisted ids stay after,
        // in their original relative order.
        complexRules = tree.complexRules
          .map((rule, index) => ({ rule, index }))
          .sort((a, b) => {
            const ra = a.rule.id !== undefined ? rank.get(a.rule.id) : undefined;
            const rb = b.rule.id !== undefined ? rank.get(b.rule.id) : undefined;
            if (ra !== undefined && rb !== undefined) return ra - rb;
            if (ra !== undefined) return -1;
            if (rb !== undefined) return 1;
            return a.index - b.index;
          })
          .map((entry) => entry.rule);
        break;
      }
      case 'delete': {
        complexRules = tree.complexRules.filter(
          (rule) => rule.id !== action.ruleId
        );
        break;
      }
      case 'editConditions': {
        complexRules = tree.complexRules.map((rule) =>
          rule.id === action.ruleId
            ? this.rebuildRule(rule, { rules: action.after })
            : rule
        );
        break;
      }
      case 'categoryOnly': {
        complexRules = tree.complexRules.map((rule) =>
          rule.id === action.ruleId
            ? this.rebuildRule(rule, { category: action.category })
            : rule
        );
        break;
      }
      case 'appendEnd': {
        complexRules = [...tree.complexRules, action.rule];
        break;
      }
    }

    return this.rebuildTree(tree, complexRules);
  }

  /** Rebuilds one complexRule via the builder, overriding only the given parts. */
  private rebuildRule(
    rule: ComplexRule,
    over: { rules?: Rule[]; category?: Category }
  ): ComplexRule {
    const builder = new ComplexRuleBuilder()
      .withRules(over.rules ?? rule.rules)
      .withCategory(over.category ?? rule.category);
    if (rule.id !== undefined) {
      builder.withId(rule.id);
    }
    return builder.build();
  }

  /** Rebuilds the tree via the builder, preserving name + description + id. */
  private rebuildTree(
    tree: DecisionTree,
    complexRules: ComplexRule[]
  ): DecisionTree {
    const builder = new DecisionTreeBuilder()
      .withName(tree.name)
      .withComplexRules(complexRules);
    if (tree.description !== undefined) {
      builder.withDescription(tree.description);
    }
    if (tree.id !== undefined) {
      builder.withId(tree.id);
    }
    return builder.build();
  }

  /** Finds the complexRule with `ruleId` in `tree` (for the live update write). */
  private findComplexRule(tree: DecisionTree, ruleId: number): ComplexRule {
    const found = tree.complexRules.find((rule) => rule.id === ruleId);
    if (!found) {
      throw new Error(`Complex rule with id ${ruleId} not found`);
    }
    return found;
  }
}
