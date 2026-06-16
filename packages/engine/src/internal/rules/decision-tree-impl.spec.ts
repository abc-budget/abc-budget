/**
 * DecisionTreeImpl + ComplexRuleImpl spec (Story 4.2, Task 2 — EP-4, FEAT-019).
 * @module internal/rules/decision-tree-impl.spec
 * @internal
 *
 * Pins the evaluator heart ported from the prior art:
 *   - ComplexRuleImpl: AND-within (every), empty → always true.
 *   - DecisionTreeImpl.categorizeRow: manual-respect → first-match-wins with
 *     SHORT-CIRCUIT → null. SYNCHRONOUS.
 *   - DecisionTreeImpl.categorize: the 3-case DELTA (only changed rows).
 *   - determinism (HC-9): identical result across two runs.
 *
 * Row fixtures are cast `as ImportStatementStage3Row` (no `source` key — removed
 * in 4.1). Category fixtures are literals cast `as Category`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Category } from '../categories/types';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { ComplexRuleImpl, DecisionTreeImpl } from './decision-tree-impl';
import type { Rule } from './rule';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCategory(id: number, name = `cat-${id}`): Category {
  return { id, name, isArchived: false, currency: 'UAH' } as Category;
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

/** A Rule whose evaluate returns a constant — usable as a probe via spy. */
function constRule(value: boolean): Rule {
  return {
    field: 'amount',
    operation: { type: 'equals', value: 0 },
    evaluate: () => value,
  };
}

// ── ComplexRuleImpl: AND-within ───────────────────────────────────────────────

describe('ComplexRuleImpl — AND-within (every)', () => {
  it('EMPTY rules → always matches', () => {
    const cr = new ComplexRuleImpl([], makeCategory(1));
    expect(cr.evaluate(makeRow())).toBe(true);
  });

  it('both rules true → matches', () => {
    const cr = new ComplexRuleImpl([constRule(true), constRule(true)], makeCategory(1));
    expect(cr.evaluate(makeRow())).toBe(true);
  });

  it('one rule false → does NOT match', () => {
    const cr = new ComplexRuleImpl([constRule(true), constRule(false)], makeCategory(1));
    expect(cr.evaluate(makeRow())).toBe(false);
  });
});

// ── DecisionTreeImpl.categorizeRow ────────────────────────────────────────────

describe('DecisionTreeImpl.categorizeRow', () => {
  it('first-match wins: earlier matching complexRule category is returned', () => {
    const first = new ComplexRuleImpl([constRule(true)], makeCategory(1));
    const second = new ComplexRuleImpl([constRule(true)], makeCategory(2));
    const tree = new DecisionTreeImpl([first, second], 'tree');

    const result = tree.categorizeRow(makeRow());

    expect(result?.id).toBe(1);
  });

  it('short-circuit: once a complexRule matches, later complexRules are NOT evaluated', () => {
    const firstRule = constRule(true);
    const laterRule = constRule(true);
    const firstSpy = vi.spyOn(firstRule, 'evaluate');
    const laterSpy = vi.spyOn(laterRule, 'evaluate');

    const first = new ComplexRuleImpl([firstRule], makeCategory(1));
    const later = new ComplexRuleImpl([laterRule], makeCategory(2));
    const tree = new DecisionTreeImpl([first, later], 'tree');

    tree.categorizeRow(makeRow());

    expect(firstSpy).toHaveBeenCalledTimes(1);
    expect(laterSpy).not.toHaveBeenCalled();
  });

  it('null on no match: no complexRule matches → returns null', () => {
    const a = new ComplexRuleImpl([constRule(false)], makeCategory(1));
    const b = new ComplexRuleImpl([constRule(false)], makeCategory(2));
    const tree = new DecisionTreeImpl([a, b], 'tree');

    expect(tree.categorizeRow(makeRow())).toBeNull();
  });

  it('manual respect: isManuallySetCategory + category → returns it WITHOUT evaluating rules', () => {
    const ruleSpy = vi.fn(() => true);
    const cr = new ComplexRuleImpl(
      [{ field: 'amount', operation: { type: 'equals', value: 0 }, evaluate: ruleSpy }],
      makeCategory(99)
    );
    const tree = new DecisionTreeImpl([cr], 'tree');

    const manual = makeCategory(7);
    const result = tree.categorizeRow(
      makeRow({ isManuallySetCategory: true, category: manual })
    );

    expect(result).toBe(manual);
    expect(ruleSpy).not.toHaveBeenCalled();
  });

  it('manual flag set but category null → falls through to rule evaluation', () => {
    const cr = new ComplexRuleImpl([constRule(true)], makeCategory(5));
    const tree = new DecisionTreeImpl([cr], 'tree');

    const result = tree.categorizeRow(
      makeRow({ isManuallySetCategory: true, category: null })
    );

    expect(result?.id).toBe(5);
  });
});

// ── DecisionTreeImpl.categorize: the 3-case DELTA ─────────────────────────────

describe('DecisionTreeImpl.categorize — DELTA', () => {
  it('same category (matched cat === row.category id) → absent from the map', () => {
    const cat = makeCategory(1);
    const cr = new ComplexRuleImpl([constRule(true)], cat);
    const tree = new DecisionTreeImpl([cr], 'tree');

    const row = makeRow({ rowIndex: 0, category: makeCategory(1) });
    const delta = tree.categorize([row]);

    expect(delta.has(0)).toBe(false);
  });

  it('null → cat: present', () => {
    const cr = new ComplexRuleImpl([constRule(true)], makeCategory(1));
    const tree = new DecisionTreeImpl([cr], 'tree');

    const row = makeRow({ rowIndex: 0, category: null });
    const delta = tree.categorize([row]);

    expect(delta.has(0)).toBe(true);
    expect(delta.get(0)?.id).toBe(1);
  });

  it('cat → null: present', () => {
    const cr = new ComplexRuleImpl([constRule(false)], makeCategory(1));
    const tree = new DecisionTreeImpl([cr], 'tree');

    const row = makeRow({ rowIndex: 0, category: makeCategory(1) });
    const delta = tree.categorize([row]);

    expect(delta.has(0)).toBe(true);
    expect(delta.get(0)).toBeNull();
  });

  it('cat → different-id: present', () => {
    const cr = new ComplexRuleImpl([constRule(true)], makeCategory(2));
    const tree = new DecisionTreeImpl([cr], 'tree');

    const row = makeRow({ rowIndex: 0, category: makeCategory(1) });
    const delta = tree.categorize([row]);

    expect(delta.has(0)).toBe(true);
    expect(delta.get(0)?.id).toBe(2);
  });

  it('mixed batch: only changed rows in the map, keyed by rowIndex', () => {
    const cr = new ComplexRuleImpl([constRule(true)], makeCategory(1));
    const tree = new DecisionTreeImpl([cr], 'tree');

    const unchanged = makeRow({ rowIndex: 0, category: makeCategory(1) });
    const changed = makeRow({ rowIndex: 1, category: null });
    const delta = tree.categorize([unchanged, changed]);

    expect(delta.has(0)).toBe(false);
    expect(delta.has(1)).toBe(true);
    expect(delta.get(1)?.id).toBe(1);
    expect(delta.size).toBe(1);
  });
});

// ── determinism (HC-9) ────────────────────────────────────────────────────────

describe('DecisionTreeImpl — determinism (HC-9)', () => {
  it('same tree + rows → identical result across two runs', () => {
    const tree = new DecisionTreeImpl(
      [
        new ComplexRuleImpl([constRule(false)], makeCategory(1)),
        new ComplexRuleImpl([constRule(true)], makeCategory(2)),
      ],
      'tree'
    );

    const rows = [
      makeRow({ rowIndex: 0, category: null }),
      makeRow({ rowIndex: 1, category: makeCategory(2) }),
    ];

    const run1 = tree.categorize(rows);
    const run2 = tree.categorize(rows);

    expect([...run2.entries()]).toEqual([...run1.entries()]);
  });
});
