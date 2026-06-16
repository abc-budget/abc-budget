/**
 * Decision-tree grammar: ComplexRule + DecisionTree + the debugger contract
 * (Story 4.2, Task 2 — EP-4 rule evaluator).
 * @module internal/rules/decision-tree
 * @internal
 *
 * PORT of the `ComplexRule`/`DecisionTree` interfaces and the debugger contract
 * interfaces (`DecisionTreeDebugger`, `RuleEvaluationResult`,
 * `ComplexRuleEvaluationResult`, `DecisionTreePath`) from the prior-art
 * decision-tree `types.ts` + `debugger.ts`. The already-ported `Rule` (4.1) and
 * the operator unions are re-used, NOT re-declared here.
 *
 * The debugger IMPLEMENTATION is Task 3 — only its interface contract is ported
 * here so the impls can reference it.
 */

import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import type { Rule } from './rule';
// Avoid an import cycle with the builder module: reference the builder type via
// a forward `import type` (erased at compile time).
import type { DecisionTreeBuilder } from './decision-tree-builder';

/**
 * Represents a complex rule that combines multiple rules with AND logic
 */
export interface ComplexRule {
  /**
   * Unique identifier for the complex rule
   * Auto-incremented by the database
   */
  readonly id?: number;

  /**
   * Array of rules that are combined with AND logic
   */
  readonly rules: Rule[];

  /**
   * Category to assign if this complex rule matches
   */
  readonly category: Category;

  /**
   * Evaluates all rules against a row with AND logic
   * @param row Row to evaluate
   * @param debug Optional debugger to track rule evaluation
   * @returns True if all rules match, false otherwise
   */
  evaluate(row: ImportStatementStage3Row, debug?: DecisionTreeDebugger): boolean;
}

/**
 * Represents a decision tree as an array of complex rules combined with OR logic
 */
export interface DecisionTree {
  /**
   * Array of complex rules combined with OR logic
   */
  readonly complexRules: ComplexRule[];

  /**
   * Unique identifier for the decision tree
   */
  readonly id?: number;

  /**
   * Name of the decision tree
   */
  readonly name: string;

  /**
   * Description of the decision tree
   */
  readonly description?: string;

  /**
   * Creates a new builder for this decision tree
   * @returns A new DecisionTreeBuilder instance initialized with this tree's properties
   */
  builder(): DecisionTreeBuilder;

  /**
   * Categorizes an array of ImportStatementStage3Row objects
   * @param rows Array of rows to categorize
   * @param debug Optional debugger to track rule evaluation
   * @returns Map of row index to assigned Category or null
   */
  categorize(
    rows: ImportStatementStage3Row[],
    debug?: DecisionTreeDebugger
  ): Map<number, Category | null>;

  /**
   * Categorizes a single ImportStatementStage3Row
   * @param row Row to categorize
   * @param debug Optional debugger to track rule evaluation
   * @returns Assigned Category or null if no matching rule
   */
  categorizeRow(
    row: ImportStatementStage3Row,
    debug?: DecisionTreeDebugger
  ): Category | null;
}

// ---------------------------------------------------------------------------
// Debugger contract (interfaces only — implementation is Task 3)
// ---------------------------------------------------------------------------

/**
 * Represents the result of a rule evaluation
 */
export interface RuleEvaluationResult {
  /**
   * The rule that was evaluated
   */
  rule: Rule;

  /**
   * The result of the evaluation (true or false)
   */
  result: boolean;

  /**
   * The row that was evaluated
   */
  row: ImportStatementStage3Row;
}

/**
 * Represents the result of a complex rule evaluation
 */
export interface ComplexRuleEvaluationResult {
  /**
   * The complex rule that was evaluated
   */
  complexRule: ComplexRule;

  /**
   * The result of the evaluation (true or false)
   */
  result: boolean;

  /**
   * The individual rule evaluation results
   */
  ruleResults: RuleEvaluationResult[];

  /**
   * The row that was evaluated
   */
  row: ImportStatementStage3Row;
}

/**
 * Represents the path followed in the decision tree for a specific row
 */
export interface DecisionTreePath {
  /**
   * The row that was evaluated
   */
  row: ImportStatementStage3Row;

  /**
   * The complex rule evaluation results
   */
  complexRuleResults: ComplexRuleEvaluationResult[];

  /**
   * The final category assigned (if any)
   */
  category: Category | null;
}

/**
 * Interface for debugging decision tree evaluations
 */
export interface DecisionTreeDebugger {
  /**
   * Tracks a rule evaluation
   * @param rule The rule being evaluated
   * @param result The result of the evaluation
   * @param row The row being evaluated
   */
  trackRuleEvaluation(
    rule: Rule,
    result: boolean,
    row: ImportStatementStage3Row
  ): void;

  /**
   * Tracks a complex rule evaluation
   * @param complexRule The complex rule being evaluated
   * @param result The result of the evaluation
   * @param row The row being evaluated
   */
  trackComplexRuleEvaluation(
    complexRule: ComplexRule,
    result: boolean,
    row: ImportStatementStage3Row
  ): void;

  /**
   * Tracks a category assignment
   * @param category The category being assigned
   * @param row The row being evaluated
   */
  trackCategoryAssignment(
    category: Category | null,
    row: ImportStatementStage3Row
  ): void;

  /**
   * Gets the decision tree path for a specific row
   * @param row The row to get the path for
   * @returns The decision tree path for the row
   */
  getDecisionTreePath(row: ImportStatementStage3Row): DecisionTreePath | null;

  /**
   * Gets all decision tree paths
   * @returns A map of row index to decision tree path
   */
  getAllDecisionTreePaths(): Map<number, DecisionTreePath>;

  /**
   * Clears all tracked evaluations
   */
  clear(): void;
}
