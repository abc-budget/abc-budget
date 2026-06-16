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
 * The prior-art `evaluate` took an optional `DecisionTreeDebugger`; that lives
 * in 4.2, so the param is typed `unknown` (and not imported) for now. RuleImpl's
 * stored predicate + delegation are kept exactly as the prior art.
 */

import type {
  ImportStatementStage3Row,
  ImportStatementStage3RowField,
} from '../importStatement/stage3/types';
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
  evaluate(row: ImportStatementStage3Row, debug?: unknown): boolean;
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
  evaluate(row: ImportStatementStage3Row, debug?: unknown): boolean {
    const result = this.evaluateFn(row);

    // Debugger wiring (DecisionTreeDebugger) lands in 4.2 — the param is kept on
    // the signature but unused here; do not import the 4.2 debugger.
    void debug;

    return result;
  }
}
