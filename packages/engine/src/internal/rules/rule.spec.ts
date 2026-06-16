/**
 * RuleImpl spec (Story 4.1, Task 1).
 * @module internal/rules/rule.spec
 * @internal
 *
 * Pins the single-rule wrapper ported from the prior art: RuleImpl stores
 * `field`/`operation`/predicate and `.evaluate(row)` delegates to the stored
 * predicate (both true and false paths). The fixture is a minimal
 * `ImportStatementStage3Row` cast — built WITHOUT a `source` key (the field is
 * being removed from the row in a sibling task).
 */

import { describe, it, expect } from 'vitest';
import { RuleImpl } from './rule';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal ImportStatementStage3Row, overriding only what a test cares
 * about. NOTE: no `source` key — the cast lets us omit it (sibling task removes
 * it from the row shape).
 */
function makeRow(overrides: Partial<ImportStatementStage3Row> = {}): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    hash: 'h',
    date: new Date('2024-06-15T12:00:00.000Z'),
    amount: 10,
    currency: 'USD',
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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('RuleImpl — single-rule wrapper', () => {
  it('exposes the stored field and operation', () => {
    const rule = new RuleImpl('amount', { type: 'greaterThan', value: 5 }, () => true);
    expect(rule.field).toBe('amount');
    expect(rule.operation).toEqual({ type: 'greaterThan', value: 5 });
  });

  it('evaluate(row) delegates to the predicate — true path', () => {
    const rule = new RuleImpl('amount', { type: 'greaterThan', value: 5 }, (row) => row.amount > 5);
    expect(rule.evaluate(makeRow({ amount: 10 }))).toBe(true);
  });

  it('evaluate(row) delegates to the predicate — false path', () => {
    const rule = new RuleImpl('amount', { type: 'greaterThan', value: 5 }, (row) => row.amount > 5);
    expect(rule.evaluate(makeRow({ amount: 1 }))).toBe(false);
  });

  it('passes the exact row to the predicate', () => {
    const seen: ImportStatementStage3Row[] = [];
    const rule = new RuleImpl('amount', { type: 'equals', value: 0 }, (row) => {
      seen.push(row);
      return true;
    });
    const row = makeRow({ amount: 42 });
    rule.evaluate(row);
    expect(seen).toEqual([row]);
  });
});
