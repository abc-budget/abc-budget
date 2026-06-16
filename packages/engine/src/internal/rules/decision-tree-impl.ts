/**
 * Decision-tree evaluator implementation (Story 4.2, Task 2 — EP-4).
 * @module internal/rules/decision-tree-impl
 * @internal
 *
 * PORT of `ComplexRuleImpl` + `DecisionTreeImpl` from the prior-art
 * decision-tree `implementation.ts`. The already-ported `RuleImpl` (4.1) is NOT
 * re-ported here.
 *
 * SYNCHRONOUS + RxJS-FREE: `categorizeRow`/`categorize` are plain synchronous
 * methods — no Observable, no Promise. The heart is:
 *   - `categorizeRow`: manual-respect → first-match-wins with short-circuit → null.
 *   - `categorize`: the 3-case DELTA (only rows whose category changed).
 */

import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import type {
  ComplexRule,
  DecisionTree,
  DecisionTreeDebugger,
} from './decision-tree';
import { DecisionTreeBuilder } from './decision-tree-builder';
import type { Rule } from './rule';

/**
 * Implementation of ComplexRule interface
 */
export class ComplexRuleImpl implements ComplexRule {
  /**
   * Creates a new complex rule
   * @param rules Array of rules that are combined with AND logic
   * @param category Category to assign if this complex rule matches
   * @param id Unique identifier for the complex rule (optional)
   */
  constructor(
    public readonly rules: Rule[],
    public readonly category: Category,
    public readonly id?: number
  ) {}

  /**
   * Evaluates all rules against a row with AND logic
   * @param row Row to evaluate
   * @param debug Optional debugger to track rule evaluation
   * @returns True if all rules match, false otherwise
   */
  evaluate(
    row: ImportStatementStage3Row,
    debug?: DecisionTreeDebugger
  ): boolean {
    // If there are no rules, the complex rule always matches
    if (this.rules.length === 0) {
      const result = true;

      // Track complex rule evaluation if debugger is provided
      if (debug) {
        debug.trackComplexRuleEvaluation(this, result, row);
      }

      return result;
    }

    // All rules must match (AND logic)
    const result = this.rules.every((rule) => rule.evaluate(row, debug));

    // Track complex rule evaluation if debugger is provided
    if (debug) {
      debug.trackComplexRuleEvaluation(this, result, row);
    }

    return result;
  }
}

/**
 * Implementation of DecisionTree interface
 */
export class DecisionTreeImpl implements DecisionTree {
  /**
   * Creates a new decision tree
   * @param complexRules Array of complex rules combined with OR logic
   * @param name Name of the decision tree
   * @param description Description of the decision tree
   * @param id Unique identifier for the decision tree
   */
  constructor(
    public readonly complexRules: ComplexRule[],
    public readonly name: string,
    public readonly description = '',
    public readonly id?: number
  ) {}

  /**
   * Creates a new builder for this decision tree
   * @returns A new DecisionTreeBuilder instance initialized with this tree's properties
   */
  builder(): DecisionTreeBuilder {
    const builder = new DecisionTreeBuilder()
      .withName(this.name)
      .withDescription(this.description)
      .withComplexRules([...this.complexRules]);

    if (this.id !== undefined) {
      builder.withId(this.id);
    }

    return builder;
  }

  /**
   * Categorizes an array of ImportStatementStage3Row objects
   * @param rows Array of rows to categorize
   * @param debug Optional debugger to track rule evaluation
   * @returns Map of row index to assigned Category or null
   */
  categorize(
    rows: ImportStatementStage3Row[],
    debug?: DecisionTreeDebugger
  ): Map<number, Category | null> {
    const result = new Map<number, Category | null>();

    for (const row of rows) {
      const evaluatedCategory = this.categorizeRow(row, debug);

      // Add to result if:
      // 1. Evaluated category is null and row.category is not null
      // 2. Evaluated category is not null and row.category is null
      // 3. Both are not null but have different ids
      if (
        (evaluatedCategory === null && row.category !== null) ||
        (evaluatedCategory !== null && row.category === null) ||
        (evaluatedCategory !== null &&
          row.category !== null &&
          evaluatedCategory.id !== row.category.id)
      ) {
        result.set(row.rowIndex, evaluatedCategory);
      }
    }

    return result;
  }

  /**
   * Categorizes a single ImportStatementStage3Row
   * @param row Row to categorize
   * @param debug Optional debugger to track rule evaluation
   * @returns Assigned Category or null if no matching rule
   */
  categorizeRow(
    row: ImportStatementStage3Row,
    debug?: DecisionTreeDebugger
  ): Category | null {
    // If the row already has a manually set category, respect that
    if (row.isManuallySetCategory && row.category) {
      return row.category;
    }

    // Try each complex rule in order (OR logic)
    for (const complexRule of this.complexRules) {
      if (complexRule.evaluate(row, debug)) {
        const category = complexRule.category;

        // Track category assignment if debugger is provided
        if (debug) {
          debug.trackCategoryAssignment(category, row);
        }

        return category;
      }
    }

    // No matching rule found
    // Track null category assignment if debugger is provided
    if (debug) {
      debug.trackCategoryAssignment(null, row);
    }

    return null;
  }
}
