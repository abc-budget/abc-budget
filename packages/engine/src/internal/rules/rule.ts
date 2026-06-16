/**
 * Single-rule grammar + wrapper (Story 4.1, EP-4 condition grammar).
 * @module internal/rules/rule
 * @internal
 *
 * PORT of the `Rule` interface (from the prior-art decision-tree `types.ts`) and
 * the `RuleImpl` class (from the prior-art `implementation.ts`) — the
 * single-rule `evaluate`. `ComplexRule`/`DecisionTree` and their impls are out
 * of scope here (Story 4.2+).
 *
 * The `evaluate` param is the optional `DecisionTreeDebugger` (landed Task 3 of
 * 4.2). It is brought in via a TYPE-ONLY import from `./decision-tree` to avoid a
 * runtime cycle (decision-tree.ts already `import type`s `Rule` from here).
 * RuleImpl's stored predicate + delegation are kept exactly as the prior art.
 */

import type {
  ImportStatementStage3Row,
  ImportStatementStage3RowField,
} from '../importStatement/stage3/types';
import type { DecisionTreeDebugger } from './decision-tree';
import type { RuleOperation } from './operations';

/**
 * Represents a single rule that operates on a specific field of ImportStatementStage3Row
 */
export interface Rule {
  /**
   * Field to evaluate in the rule
   */
  readonly field: ImportStatementStage3RowField;

  /**
   * Operation to perform on the field
   */
  readonly operation: RuleOperation;

  /**
   * Evaluates the rule against a row
   * @param row Row to evaluate
   * @param debug Optional debugger to track rule evaluation
   * @returns True if rule matches, false otherwise
   */
  evaluate(row: ImportStatementStage3Row, debug?: DecisionTreeDebugger): boolean;
}

/**
 * Implementation of Rule interface
 */
export class RuleImpl implements Rule {
  constructor(
    public readonly field: ImportStatementStage3RowField,
    public readonly operation: RuleOperation,
    private readonly evaluateFn: (row: ImportStatementStage3Row) => boolean
  ) {}

  /**
   * Evaluates the rule against a row
   * @param row Row to evaluate
   * @param debug Optional debugger to track rule evaluation
   * @returns True if rule matches, false otherwise
   */
  evaluate(row: ImportStatementStage3Row, debug?: DecisionTreeDebugger): boolean {
    const result = this.evaluateFn(row);

    if (debug) {
      debug.trackRuleEvaluation(this, result, row);
    }

    return result;
  }
}
