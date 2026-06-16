/**
 * ComplexRuleBuilder + DecisionTreeBuilder spec (Story 4.2, Task 2 — EP-4).
 * @module internal/rules/decision-tree-builder.spec
 * @internal
 *
 * Pins the builders ported from the prior art:
 *   - ComplexRuleBuilder.build() throws LocalizableException with no category.
 *   - DecisionTreeBuilder.build() throws LocalizableException with no name.
 *   - happy-path builds the expected structure; `withId` preserved.
 */

import { describe, it, expect } from 'vitest';
import type { Category } from '../categories/types';
import { LocalizableException } from '../utils/messages';
import {
  ComplexRuleBuilder,
  DecisionTreeBuilder,
} from './decision-tree-builder';
import type { Rule } from './rule';

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

function makeRule(): Rule {
  return {
    field: 'amount',
    operation: { type: 'equals', value: 0 },
    evaluate: () => true,
  };
}

// ── ComplexRuleBuilder ────────────────────────────────────────────────────────

describe('ComplexRuleBuilder', () => {
  it('build() throws LocalizableException when no category is set', () => {
    const builder = new ComplexRuleBuilder().withRule(makeRule());
    expect(() => builder.build()).toThrow(LocalizableException);
  });

  it('happy-path builds the expected structure with category + rules', () => {
    const cat = makeCategory(1);
    const rule = makeRule();
    const cr = new ComplexRuleBuilder().withRule(rule).withCategory(cat).build();

    expect(cr.category).toBe(cat);
    expect(cr.rules).toEqual([rule]);
    expect(cr.id).toBeUndefined();
  });

  it('withId is preserved on the built complex rule', () => {
    const cr = new ComplexRuleBuilder()
      .withCategory(makeCategory(1))
      .withId(42)
      .build();

    expect(cr.id).toBe(42);
  });

  it('withRules adds multiple rules', () => {
    const r1 = makeRule();
    const r2 = makeRule();
    const cr = new ComplexRuleBuilder()
      .withRules([r1, r2])
      .withCategory(makeCategory(1))
      .build();

    expect(cr.rules).toEqual([r1, r2]);
  });
});

// ── DecisionTreeBuilder ───────────────────────────────────────────────────────

describe('DecisionTreeBuilder', () => {
  it('build() throws LocalizableException when no name is set', () => {
    const builder = new DecisionTreeBuilder();
    expect(() => builder.build()).toThrow(LocalizableException);
  });

  it('happy-path builds the expected structure with name + complexRules', () => {
    const cr = new ComplexRuleBuilder().withCategory(makeCategory(1)).build();
    const tree = new DecisionTreeBuilder()
      .withName('my-tree')
      .withDescription('desc')
      .withComplexRule(cr)
      .build();

    expect(tree.name).toBe('my-tree');
    expect(tree.description).toBe('desc');
    expect(tree.complexRules).toEqual([cr]);
    expect(tree.id).toBeUndefined();
  });

  it('withId is preserved on the built tree', () => {
    const tree = new DecisionTreeBuilder().withName('t').withId(7).build();
    expect(tree.id).toBe(7);
  });

  it('tree.builder() round-trips name, description, complexRules and id', () => {
    const cr = new ComplexRuleBuilder().withCategory(makeCategory(1)).build();
    const original = new DecisionTreeBuilder()
      .withName('round')
      .withDescription('rt')
      .withComplexRule(cr)
      .withId(9)
      .build();

    const rebuilt = original.builder().build();

    expect(rebuilt.name).toBe('round');
    expect(rebuilt.description).toBe('rt');
    expect(rebuilt.complexRules).toEqual([cr]);
    expect(rebuilt.id).toBe(9);
  });
});
