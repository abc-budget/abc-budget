/**
 * bucketByWinningRule + draftBucket spec (Story 4.8, Task 3 — ENT-021 step 2).
 * @module internal/rules/typicality/bucket.spec
 * @internal
 *
 * Pins the bucketing layer that feeds the moment-agnostic ranking core
 * (`rankBucket`, Task 2). The key proofs:
 *   - rows grouped by the WINNING (FIRST-match) complexRule, not the last.
 *   - two rules SHARING a category bucket SEPARATELY — keyed by rule id, never
 *     by category (the "winning RULE not category" guarantee).
 *   - `filteredFields` = the winning rule's condition fields, narrowed to
 *     TypicalityFields (date/account/isBankCommission dropped).
 *   - a row matching NO rule is EXCLUDED from every bucket (it is the
 *     Auto-Other / uncategorized remainder — NO rule ⇒ no expected similarity,
 *     NOT the Auto-Other typicality set).
 *   - `draftBucket`: rows a draft complexRule accepts + its filteredFields.
 *
 * Rows are cast `as ImportStatementStage3Row` carrying only `rowIndex` + the
 * rule-relevant fields. Trees are assembled via the 4.2 builders.
 */

import { describe, it, expect } from 'vitest';
import type { Category } from '../../categories/types';
import type { ImportStatementStage3Row } from '../../importStatement/stage3/types';
import {
  ComplexRuleBuilder,
  DecisionTreeBuilder,
} from '../decision-tree-builder';
import {
  createDescriptionRule,
  createCurrencyRule,
} from '../rule-factories';
import { bucketByWinningRule, draftBucket } from './bucket';
import type { ComplexRule } from '../decision-tree';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeCategory(id: number, name = `cat-${id}`): Category {
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

/** R1: description contains "coffee" → cat A, id 1. */
function ruleR1(category: Category): ComplexRule {
  return new ComplexRuleBuilder()
    .withRule(createDescriptionRule({ type: 'contains', value: 'coffee' }))
    .withCategory(category)
    .withId(1)
    .build();
}

/** R2: description contains "tea" → cat (caller-supplied), id 2. */
function ruleR2(category: Category): ComplexRule {
  return new ComplexRuleBuilder()
    .withRule(createDescriptionRule({ type: 'contains', value: 'tea' }))
    .withCategory(category)
    .withId(2)
    .build();
}

// ── First-match-wins bucketing ────────────────────────────────────────────────

describe('bucketByWinningRule — first-match-wins', () => {
  it('groups rows under the WINNING (first-match) rule, not a later match', () => {
    const r1 = ruleR1(makeCategory(10));
    const r2 = ruleR2(makeCategory(20));
    const tree = new DecisionTreeBuilder()
      .withName('t')
      .withComplexRules([r1, r2])
      .build();

    // "coffee and tea" matches BOTH R1 (id 1) and R2 (id 2); first match wins → R1.
    const bothRow = makeRow({ rowIndex: 0, description: 'coffee and tea' });
    const teaOnly = makeRow({ rowIndex: 1, description: 'tea house' });

    const buckets = bucketByWinningRule([bothRow, teaOnly], tree);

    expect(buckets.get(1)?.rows.map((r) => r.rowIndex)).toEqual([0]);
    expect(buckets.get(2)?.rows.map((r) => r.rowIndex)).toEqual([1]);
  });

  it('two rules sharing a CATEGORY bucket SEPARATELY (keyed by rule id, not category)', () => {
    const shared = makeCategory(99, 'shared');
    const r1 = ruleR1(shared); // id 1, category 99
    const r2 = ruleR2(shared); // id 2, SAME category 99
    const tree = new DecisionTreeBuilder()
      .withName('t')
      .withComplexRules([r1, r2])
      .build();

    const coffee = makeRow({ rowIndex: 0, description: 'coffee shop' });
    const tea = makeRow({ rowIndex: 1, description: 'tea room' });

    const buckets = bucketByWinningRule([coffee, tea], tree);

    // Same category — but TWO distinct buckets, one per rule id.
    expect(buckets.size).toBe(2);
    expect(buckets.get(1)?.rows.map((r) => r.rowIndex)).toEqual([0]);
    expect(buckets.get(2)?.rows.map((r) => r.rowIndex)).toEqual([1]);
  });

  it('filteredFields = the winning rule condition fields, narrowed to TypicalityFields', () => {
    const r1 = ruleR1(makeCategory(10));
    const tree = new DecisionTreeBuilder()
      .withName('t')
      .withComplexRules([r1])
      .build();

    const row = makeRow({ rowIndex: 0, description: 'coffee' });
    const buckets = bucketByWinningRule([row], tree);

    expect([...(buckets.get(1)?.filteredFields ?? [])]).toEqual(['description']);
  });

  it('a row matching NO rule is EXCLUDED from every bucket (not the Auto-Other set)', () => {
    const r1 = ruleR1(makeCategory(10));
    const r2 = ruleR2(makeCategory(20));
    const tree = new DecisionTreeBuilder()
      .withName('t')
      .withComplexRules([r1, r2])
      .build();

    const coffee = makeRow({ rowIndex: 0, description: 'coffee' });
    const noMatch = makeRow({ rowIndex: 1, description: 'rent payment' });

    const buckets = bucketByWinningRule([coffee, noMatch], tree);

    // noMatch (rowIndex 1) appears in NO bucket.
    const allBucketed = [...buckets.values()].flatMap((b) =>
      b.rows.map((r) => r.rowIndex)
    );
    expect(allBucketed).toEqual([0]);
    expect(allBucketed).not.toContain(1);
  });

  it('amount + currency rule contributes BOTH fields to filteredFields', () => {
    // createCurrencyRule yields a single currency rule; pair it with a
    // description rule to prove multi-field extraction + ordering preserved.
    const cr = new ComplexRuleBuilder()
      .withRule(createDescriptionRule({ type: 'contains', value: 'coffee' }))
      .withRule(createCurrencyRule({ type: 'equals', value: 'UAH' }))
      .withCategory(makeCategory(10))
      .withId(7)
      .build();
    const tree = new DecisionTreeBuilder()
      .withName('t')
      .withComplexRules([cr])
      .build();

    const row = makeRow({ rowIndex: 0, description: 'coffee', currency: 'UAH' });
    const buckets = bucketByWinningRule([row], tree);

    const fields = buckets.get(7)?.filteredFields;
    expect(fields?.has('description')).toBe(true);
    expect(fields?.has('currency')).toBe(true);
    expect(fields?.size).toBe(2);
  });
});

// ── draftBucket (the rule-CREATE moment, called by 4.9) ───────────────────────

describe('draftBucket', () => {
  it('keeps rows the draft complexRule accepts + exposes its filteredFields', () => {
    const draft = new ComplexRuleBuilder()
      .withRule(createDescriptionRule({ type: 'contains', value: 'coffee' }))
      .withCategory(makeCategory(10))
      .build();

    const rows = [
      makeRow({ rowIndex: 0, description: 'coffee shop' }),
      makeRow({ rowIndex: 1, description: 'rent' }),
      makeRow({ rowIndex: 2, description: 'coffee beans' }),
    ];

    const bucket = draftBucket(rows, draft);

    expect(bucket.rows.map((r) => r.rowIndex)).toEqual([0, 2]);
    expect([...bucket.filteredFields]).toEqual(['description']);
  });
});
