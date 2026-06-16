/**
 * DecisionTreeDebuggerImpl spec (Story 4.2, Task 3 — EP-4, FEAT-020 «Why?»).
 * @module internal/rules/debugger.spec
 * @internal
 *
 * Pins the «Why?» basis ported from the prior art:
 *   - tree.categorizeRow(row, debugger) reconstructs the path for that row's
 *     rowIndex: rule evaluation result(s), complexRule evaluation result(s),
 *     and the assigned category (or null).
 *   - RuleImpl.evaluate(row, debugger) records a trackRuleEvaluation entry;
 *     RuleImpl.evaluate(row) with no debugger does not throw and records nothing.
 *   - clear() empties tracked state.
 *   - determinism: same inputs → same tracked path.
 *
 * Row fixtures are cast `as ImportStatementStage3Row` (no `source` key). Category
 * fixtures are literals cast `as Category`.
 */

import { describe, it, expect } from 'vitest';
import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { DecisionTreeBuilder, ComplexRuleBuilder } from './decision-tree-builder';
import { RuleImpl } from './rule';
import { DecisionTreeDebuggerImpl } from './debugger';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCategory(id: number, name = `cat-${id}`): Category {
  // Story 4.3a: Category.id is a STRING; icon is required.
  return {
    id: String(id),
    name,
    icon: `glyph-${id}`,
    isArchived: false,
    currency: 'UAH',
  } as Category;
}

function makeRow(
  overrides: Partial<ImportStatementStage3Row> = {}
): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    hash: 'h',
    date: new Date('2024-06-15T12:00:00.000Z'),
    amount: 10,
    currency: 'UAH',
    description: null,
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: null,
    isBankCommission: false,
    isCashback: false,
    category: null,
    isManuallySetCategory: false,
    ...overrides,
  } as ImportStatementStage3Row;
}

/** A RuleImpl on `amount` whose stored predicate is the given constant. */
function constRule(value: boolean): RuleImpl {
  return new RuleImpl('amount', { type: 'equals', value: 0 }, () => value);
}

// ── «Why?» path reconstruction ────────────────────────────────────────────────

describe('DecisionTreeDebuggerImpl — «Why?» path reconstruction', () => {
  it('reconstructs the path for a MATCHED row (rules, complexRule, category)', () => {
    const ruleA = constRule(true);
    const ruleB = constRule(true);
    const matchCat = makeCategory(1);

    const tree = new DecisionTreeBuilder()
      .withName('tree')
      .withComplexRule(
        new ComplexRuleBuilder()
          .withRules([ruleA, ruleB])
          .withCategory(matchCat)
          .build()
      )
      .build();

    const row = makeRow({ rowIndex: 42 });
    const debug = new DecisionTreeDebuggerImpl();

    const category = tree.categorizeRow(row, debug);
    expect(category?.id).toBe('1');

    const path = debug.getDecisionTreePath(row);
    expect(path).not.toBeNull();
    expect(path?.row.rowIndex).toBe(42);

    // complexRule evaluation result(s)
    expect(path?.complexRuleResults).toHaveLength(1);
    const crResult = path!.complexRuleResults[0];
    expect(crResult.result).toBe(true);
    expect(crResult.complexRule.category.id).toBe('1');

    // rule evaluation result(s) attributed to the matched complexRule
    expect(crResult.ruleResults).toHaveLength(2);
    expect(crResult.ruleResults.every((r) => r.result === true)).toBe(true);
    expect(crResult.ruleResults.map((r) => r.rule)).toEqual([ruleA, ruleB]);

    // assigned category
    expect(path?.category?.id).toBe('1');
  });

  it('reconstructs the path for an UNMATCHED row (category null)', () => {
    const tree = new DecisionTreeBuilder()
      .withName('tree')
      .withComplexRule(
        new ComplexRuleBuilder()
          .withRules([constRule(false)])
          .withCategory(makeCategory(1))
          .build()
      )
      .build();

    const row = makeRow({ rowIndex: 7 });
    const debug = new DecisionTreeDebuggerImpl();

    const category = tree.categorizeRow(row, debug);
    expect(category).toBeNull();

    const path = debug.getDecisionTreePath(row);
    expect(path).not.toBeNull();
    expect(path?.complexRuleResults).toHaveLength(1);
    expect(path?.complexRuleResults[0].result).toBe(false);
    expect(path?.category).toBeNull();
  });

  it('getDecisionTreePath returns null for an untracked row', () => {
    const debug = new DecisionTreeDebuggerImpl();
    expect(debug.getDecisionTreePath(makeRow({ rowIndex: 99 }))).toBeNull();
  });

  it('getAllDecisionTreePaths returns one entry per evaluated rowIndex', () => {
    const tree = new DecisionTreeBuilder()
      .withName('tree')
      .withComplexRule(
        new ComplexRuleBuilder()
          .withRules([constRule(true)])
          .withCategory(makeCategory(1))
          .build()
      )
      .build();

    const debug = new DecisionTreeDebuggerImpl();
    tree.categorizeRow(makeRow({ rowIndex: 0 }), debug);
    tree.categorizeRow(makeRow({ rowIndex: 1 }), debug);

    const all = debug.getAllDecisionTreePaths();
    expect(all.size).toBe(2);
    expect(all.get(0)?.category?.id).toBe('1');
    expect(all.get(1)?.category?.id).toBe('1');
  });
});

// ── RuleImpl.evaluate × debugger wiring ───────────────────────────────────────

describe('RuleImpl.evaluate — debugger wiring', () => {
  it('records a trackRuleEvaluation entry when a debugger is passed', () => {
    const rule = constRule(true);
    const debug = new DecisionTreeDebuggerImpl();
    const row = makeRow({ rowIndex: 3 });

    expect(rule.evaluate(row, debug)).toBe(true);

    const all = debug.getAllDecisionTreePaths();
    // No complexRule/category tracked → no reconstructable path, but a rule
    // evaluation WAS recorded. Surface it via a complexRule that owns this rule.
    expect(all.size).toBe(0);

    // Wire the rule into a complexRule so the recorded rule evaluation surfaces.
    const debug2 = new DecisionTreeDebuggerImpl();
    rule.evaluate(row, debug2);
    debug2.trackComplexRuleEvaluation(
      { rules: [rule], category: makeCategory(1), evaluate: () => true },
      true,
      row
    );
    const path = debug2.getDecisionTreePath(row);
    expect(path?.complexRuleResults[0].ruleResults).toHaveLength(1);
    expect(path?.complexRuleResults[0].ruleResults[0].result).toBe(true);
    expect(path?.complexRuleResults[0].ruleResults[0].rule).toBe(rule);
  });

  it('records nothing and does not throw when no debugger is passed', () => {
    const rule = constRule(false);
    expect(() => rule.evaluate(makeRow())).not.toThrow();
    expect(rule.evaluate(makeRow())).toBe(false);
  });
});

// ── clear() ──────────────────────────────────────────────────────────────────

describe('DecisionTreeDebuggerImpl — clear()', () => {
  it('empties all tracked state', () => {
    const tree = new DecisionTreeBuilder()
      .withName('tree')
      .withComplexRule(
        new ComplexRuleBuilder()
          .withRules([constRule(true)])
          .withCategory(makeCategory(1))
          .build()
      )
      .build();

    const debug = new DecisionTreeDebuggerImpl();
    const row = makeRow({ rowIndex: 5 });
    tree.categorizeRow(row, debug);

    expect(debug.getDecisionTreePath(row)).not.toBeNull();

    debug.clear();

    expect(debug.getDecisionTreePath(row)).toBeNull();
    expect(debug.getAllDecisionTreePaths().size).toBe(0);
  });
});

// ── determinism ───────────────────────────────────────────────────────────────

describe('DecisionTreeDebuggerImpl — determinism', () => {
  it('same inputs → same tracked path across two runs', () => {
    const buildTree = () =>
      new DecisionTreeBuilder()
        .withName('tree')
        .withComplexRule(
          new ComplexRuleBuilder()
            .withRules([constRule(false)])
            .withCategory(makeCategory(1))
            .build()
        )
        .withComplexRule(
          new ComplexRuleBuilder()
            .withRules([constRule(true)])
            .withCategory(makeCategory(2))
            .build()
        )
        .build();

    const row = makeRow({ rowIndex: 11 });

    const d1 = new DecisionTreeDebuggerImpl();
    buildTree().categorizeRow(row, d1);
    const p1 = d1.getDecisionTreePath(row);

    const d2 = new DecisionTreeDebuggerImpl();
    buildTree().categorizeRow(row, d2);
    const p2 = d2.getDecisionTreePath(row);

    expect(p1?.category?.id).toBe(p2?.category?.id);
    expect(p1?.complexRuleResults.map((r) => r.result)).toEqual(
      p2?.complexRuleResults.map((r) => r.result)
    );
    expect(p1?.complexRuleResults.map((r) => r.complexRule.category.id)).toEqual(
      p2?.complexRuleResults.map((r) => r.complexRule.category.id)
    );
  });
});
