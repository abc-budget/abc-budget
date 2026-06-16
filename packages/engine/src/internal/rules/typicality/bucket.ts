/**
 * Bucket import rows by their WINNING complexRule (Story 4.8, Task 3 — ENT-021
 * step 2, EP-4).
 * @module internal/rules/typicality/bucket
 * @internal
 *
 * ENT-021 typicality is computed PER bucket, where a bucket is the set of rows
 * the SAME rule won. The winning RULE — not the category: two rules may share a
 * category yet form two distinct buckets (rows that won under rule A have a
 * different "typical shape" than rows that won under rule B).
 *
 * The moment-agnostic scoring core is `rankBucket` (Task 2); the helpers HERE
 * only ASSEMBLE buckets:
 *   - `bucketByWinningRule` — the auto-categorize moment: group already-built
 *     rules' winners. First-match-wins, mirroring the 4.2 evaluator exactly (we
 *     reuse the evaluator + debugger; we do NOT reimplement first-match).
 *   - `draftBucket` — the rule-CREATE moment (4.9 calls it): the rows a single
 *     draft rule would accept.
 *
 * IMPORTANT — rows matching NO rule are NOT bucketed. A row with no winning rule
 * has no expected similarity to measure against, so it is dropped here. This is
 * the uncategorized remainder; it is NOT the Auto-Other typicality set.
 */

import type { ImportStatementStage3Row } from '../../importStatement/stage3/types';
import type { ComplexRule, DecisionTree } from '../decision-tree';
import { DecisionTreeDebuggerImpl } from '../debugger';
import type { Rule } from '../rule';
import type { TypicalityField } from './profile';

/**
 * The TypicalityFields, as a runtime set — used to narrow a rule's condition
 * fields (which are `ImportStatementStage3RowField` strings) down to the fields
 * that actually carry typicality signal. Fields like `date`, `account`, and
 * `isBankCommission` overlap the rule grammar but are NOT typicality dimensions.
 */
const TYPICALITY_FIELDS: ReadonlySet<string> = new Set<TypicalityField>([
  'mcc',
  'counterparty',
  'currency',
  'bankCategory',
  'amount',
  'description',
]);

/**
 * A set of rows that share a winning rule, plus the fields that rule constrains.
 *
 * `filteredFields` is the rule's condition fields narrowed to TypicalityFields —
 * the dimensions on which the bucket's rows are expected to look alike, and thus
 * the dimensions `rankBucket` scores.
 */
export interface TypicalityBucket {
  readonly rows: ImportStatementStage3Row[];
  readonly filteredFields: Set<TypicalityField>;
}

/**
 * Narrows a rule's `field` strings down to the TypicalityField subset, in the
 * order the rules appear (de-duplicated via the Set).
 */
function typicalityFieldsOf(rules: readonly Rule[]): Set<TypicalityField> {
  const fields = new Set<TypicalityField>();
  for (const rule of rules) {
    if (TYPICALITY_FIELDS.has(rule.field)) {
      fields.add(rule.field as TypicalityField);
    }
  }
  return fields;
}

/**
 * Groups rows by the FIRST-matching complexRule of `tree` (first-match-wins,
 * exactly as the 4.2 evaluator categorizes), keyed by the winning rule's `id`.
 *
 * Reuses the 4.2 evaluator + debugger: we run `tree.categorize` with a debugger
 * and read each row's path; the winning rule is the first `complexRuleResults`
 * entry whose `result` is `true`. Rows with no matching rule are EXCLUDED.
 *
 * ASSUMPTION: persisted complexRules carry a numeric `id`. A rule with no `id`
 * cannot be keyed and its rows are skipped (it is never a persisted winner in
 * the auto-categorize moment this helper serves).
 *
 * @param rows The rows to bucket (read-only; a defensive copy is categorized).
 * @param tree The decision tree whose rules define the buckets.
 * @returns Map of winning complexRule id → bucket.
 */
export function bucketByWinningRule(
  rows: readonly ImportStatementStage3Row[],
  tree: DecisionTree
): Map<number, TypicalityBucket> {
  const debug = new DecisionTreeDebuggerImpl();
  tree.categorize([...rows], debug);

  const paths = debug.getAllDecisionTreePaths();
  const buckets = new Map<number, TypicalityBucket>();

  for (const row of rows) {
    const path = paths.get(row.rowIndex);
    if (!path) {
      continue;
    }

    // First-match-wins — mirror the evaluator: the winning rule is the first
    // complexRule whose evaluation result was true.
    const winning = path.complexRuleResults.find((r) => r.result === true);
    if (!winning) {
      // No rule matched → not bucketed (the uncategorized remainder).
      continue;
    }

    const { complexRule } = winning;
    if (complexRule.id === undefined) {
      // Unpersisted rule with no stable key — cannot bucket.
      continue;
    }

    let bucket = buckets.get(complexRule.id);
    if (!bucket) {
      bucket = {
        rows: [],
        filteredFields: typicalityFieldsOf(complexRule.rules),
      };
      buckets.set(complexRule.id, bucket);
    }
    bucket.rows.push(row);
  }

  return buckets;
}

/**
 * Builds the bucket for a single DRAFT complexRule (the rule-CREATE moment;
 * called by 4.9). The bucket is the rows the draft `evaluate` accepts; its
 * `filteredFields` come from the draft's own rules.
 *
 * Unlike `bucketByWinningRule` there is no first-match contest here — a draft is
 * evaluated in isolation, so every row it accepts belongs to its bucket.
 *
 * @param rows The candidate rows.
 * @param complexRule The draft rule being created.
 * @returns The draft's bucket.
 */
export function draftBucket(
  rows: readonly ImportStatementStage3Row[],
  complexRule: ComplexRule
): TypicalityBucket {
  const accepted = rows.filter((row) => complexRule.evaluate(row));
  return {
    rows: accepted,
    filteredFields: typicalityFieldsOf(complexRule.rules),
  };
}
