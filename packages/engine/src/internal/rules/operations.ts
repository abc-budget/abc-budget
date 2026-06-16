/**
 * Rule operator unions (Story 4.1, EP-4 condition grammar).
 * @module internal/rules/operations
 * @internal
 *
 * PORT of the 5 operator unions + `RuleOperation` from
 * `webapp/libs/engine/src/importStatement/stage3/decision-tree/types.ts` —
 * byte-identical to the prior art / ENT-010. The per-field operator matrix
 * (which field accepts which union) is Task 2; this module is the grammar only.
 */

/**
 * Operations available for date fields
 */
export type DateOperation =
  | { type: 'firstDayOfMonth' }
  | { type: 'firstMondayOfMonth' }
  | { type: 'firstSaturdayOfMonth' }
  | { type: 'firstSundayOfMonth' }
  | { type: 'lastDayOfMonth' }
  | { type: 'lastMondayOfMonth' }
  | { type: 'lastSaturdayOfMonth' }
  | { type: 'lastSundayOfMonth' }
  | { type: 'specificDay'; value: number }
  | { type: 'dayRange'; start: number; end: number };

/**
 * Operations available for number fields (amount, mcc)
 */
export type NumberOperation =
  | { type: 'equals'; value: number }
  | { type: 'notEquals'; value: number }
  | { type: 'greaterThan'; value: number }
  | { type: 'lessThan'; value: number }
  | { type: 'greaterThanOrEqual'; value: number }
  | { type: 'lessThanOrEqual'; value: number }
  | { type: 'between'; min: number; max: number };

/**
 * Operations available for string fields (description, account, bankCategory, currency)
 */
export type StringOperation =
  | { type: 'equals'; value: string }
  | { type: 'notEquals'; value: string }
  | { type: 'contains'; value: string }
  | { type: 'notContains'; value: string }
  | { type: 'startsWith'; value: string }
  | { type: 'endsWith'; value: string }
  | { type: 'matches'; pattern: RegExp };

/**
 * Operations available for boolean fields (isBankCommission, isCashback)
 */
export type BooleanOperation = { type: 'isTrue' } | { type: 'isFalse' };

/**
 * Basic string matching operations for any field
 * Provides simple equality and list membership checks
 * All values are treated as strings, with non-string values converted to string
 */
export type StringMatchOperation =
  | { type: 'equals'; value: string }
  | { type: 'notEquals'; value: string }
  | { type: 'oneOf'; values: string[] };

/**
 * Union type for all possible rule operations
 */
export type RuleOperation =
  | DateOperation
  | NumberOperation
  | StringOperation
  | BooleanOperation
  | StringMatchOperation;
