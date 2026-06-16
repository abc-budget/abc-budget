/**
 * Decision-tree debugger implementation (Story 4.2, Task 3 — EP-4, FEAT-020).
 * @module internal/rules/debugger
 * @internal
 *
 * PORT of `DecisionTreeDebuggerImpl` from the prior-art decision-tree
 * `debugger.ts`. The debugger contract interfaces (`DecisionTreeDebugger`,
 * `RuleEvaluationResult`, `ComplexRuleEvaluationResult`, `DecisionTreePath`)
 * were ported into `decision-tree.ts` (Task 2) and are IMPORTED here — NOT
 * re-declared.
 *
 * The «Why?» basis: track*-methods record per-rowIndex maps (rule evaluations,
 * complexRule evaluations, category assignments); the path accessors reconstruct
 * the decision path for a given row. track/clear/path-accessor behavior is
 * identical to the prior art.
 */

import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import type {
  ComplexRule,
  ComplexRuleEvaluationResult,
  DecisionTreeDebugger,
  DecisionTreePath,
  RuleEvaluationResult,
} from './decision-tree';
import type { Rule } from './rule';

/**
 * Implementation of DecisionTreeDebugger interface
 */
export class DecisionTreeDebuggerImpl implements DecisionTreeDebugger {
  private ruleEvaluations: Map<number, RuleEvaluationResult[]> = new Map();
  private complexRuleEvaluations: Map<number, ComplexRuleEvaluationResult[]> =
    new Map();
  private categoryAssignments: Map<number, Category | null> = new Map();

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
  ): void {
    const rowIndex = row.rowIndex;
    const evaluation: RuleEvaluationResult = { rule, result, row };

    if (!this.ruleEvaluations.has(rowIndex)) {
      this.ruleEvaluations.set(rowIndex, []);
    }

    const ruleEvaluations = this.ruleEvaluations.get(rowIndex);
    if (!ruleEvaluations) {
      throw new Error(
        `Rule evaluations for row ${rowIndex} were expected but not found`
      );
    }
    ruleEvaluations.push(evaluation);
  }

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
  ): void {
    const rowIndex = row.rowIndex;

    // Get the rule evaluations for this row that happened since the last complex rule evaluation
    const ruleResults = this.getLatestRuleEvaluations(rowIndex, complexRule);

    const evaluation: ComplexRuleEvaluationResult = {
      complexRule,
      result,
      ruleResults,
      row,
    };

    if (!this.complexRuleEvaluations.has(rowIndex)) {
      this.complexRuleEvaluations.set(rowIndex, []);
    }

    const complexRuleEvaluations = this.complexRuleEvaluations.get(rowIndex);
    if (!complexRuleEvaluations) {
      throw new Error(
        `Complex rule evaluations for row ${rowIndex} were expected but not found`
      );
    }
    complexRuleEvaluations.push(evaluation);
  }

  /**
   * Tracks a category assignment
   * @param category The category being assigned
   * @param row The row being evaluated
   */
  trackCategoryAssignment(
    category: Category | null,
    row: ImportStatementStage3Row
  ): void {
    this.categoryAssignments.set(row.rowIndex, category);
  }

  /**
   * Gets the decision tree path for a specific row
   * @param row The row to get the path for
   * @returns The decision tree path for the row
   */
  getDecisionTreePath(row: ImportStatementStage3Row): DecisionTreePath | null {
    const rowIndex = row.rowIndex;

    if (!this.complexRuleEvaluations.has(rowIndex)) {
      return null;
    }

    const complexRuleResults = this.complexRuleEvaluations.get(rowIndex);
    if (!complexRuleResults) {
      throw new Error(
        `Complex rule evaluations for row ${rowIndex} were expected but not found`
      );
    }

    return {
      row,
      complexRuleResults,
      category: this.categoryAssignments.get(rowIndex) ?? null,
    };
  }

  /**
   * Gets all decision tree paths
   * @returns A map of row index to decision tree path
   */
  getAllDecisionTreePaths(): Map<number, DecisionTreePath> {
    const result = new Map<number, DecisionTreePath>();

    for (const [
      rowIndex,
      complexRuleResults,
    ] of this.complexRuleEvaluations.entries()) {
      if (complexRuleResults.length === 0) {
        continue;
      }

      const row = complexRuleResults[0].row;

      result.set(rowIndex, {
        row,
        complexRuleResults,
        category: this.categoryAssignments.get(rowIndex) ?? null,
      });
    }

    return result;
  }

  /**
   * Clears all tracked evaluations
   */
  clear(): void {
    this.ruleEvaluations.clear();
    this.complexRuleEvaluations.clear();
    this.categoryAssignments.clear();
  }

  /**
   * Gets the rule evaluations for a row that are associated with a complex rule
   * @param rowIndex The index of the row
   * @param complexRule The complex rule
   * @returns The rule evaluations for the row that are associated with the complex rule
   */
  private getLatestRuleEvaluations(
    rowIndex: number,
    complexRule: ComplexRule
  ): RuleEvaluationResult[] {
    if (!this.ruleEvaluations.has(rowIndex)) {
      return [];
    }

    const allRuleEvaluations = this.ruleEvaluations.get(rowIndex);
    if (!allRuleEvaluations) {
      throw new Error(
        `Rule evaluations for row ${rowIndex} were expected but not found`
      );
    }
    const complexRuleRules = new Set(complexRule.rules);

    // Get the rule evaluations that are associated with the complex rule
    return allRuleEvaluations.filter((evaluation) =>
      complexRuleRules.has(evaluation.rule)
    );
  }
}
