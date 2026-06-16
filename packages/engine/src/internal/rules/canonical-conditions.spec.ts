/**
 * Canonical-condition equality spec (Story 4.5, Task 1 — FEAT-029).
 * @module internal/rules/canonical-conditions.spec
 * @internal
 *
 * Pins the order-INDEPENDENT sandbox no-op detector: the same set of
 * conditions in a DIFFERENT order must compare EQUAL (conditions are
 * AND-combined → order is not semantic), while any real change (value,
 * operator, field, count) compares NOT equal. RegExp `matches` patterns
 * compare by source AND flags. This is DISTINCT from 4.3b's positional
 * `rulesContentMatch` — see canonical-conditions.ts for the rationale.
 */

import { describe, it, expect } from 'vitest';
import {
  canonicalConditionSignature,
  conditionsEqual,
} from './canonical-conditions';
import {
  createAmountCondition,
  createDateRule,
  createDescriptionRule,
  createIsCashbackRule,
  createMccRule,
} from './rule-factories';
import type { Rule } from './rule';

const desc = (): Rule =>
  createDescriptionRule({ type: 'equals', value: 'coffee' });
const amount = (): Rule =>
  createAmountCondition({ type: 'greaterThan', value: 10 }, 'EUR')[0];
const mcc = (): Rule => createMccRule({ type: 'equals', value: '5814' });
const date = (): Rule => createDateRule({ type: 'specificDay', value: 15 });
const matches = (re: RegExp): Rule =>
  createDescriptionRule({ type: 'matches', pattern: re });
const cashback = (): Rule => createIsCashbackRule({ type: 'isTrue' });

describe('conditionsEqual — order independence (the no-op)', () => {
  it('treats the same conditions in a DIFFERENT order as equal', () => {
    const a = [desc(), amount()];
    const b = [amount(), desc()];
    expect(conditionsEqual(a, b)).toBe(true);
  });

  it('is order-independent across many conditions', () => {
    const a = [desc(), amount(), mcc(), date(), cashback()];
    const b = [cashback(), date(), mcc(), amount(), desc()];
    expect(conditionsEqual(a, b)).toBe(true);
  });
});

describe('conditionsEqual — real changes are NOT equal', () => {
  it('flags a changed VALUE as not equal', () => {
    const a = [createDescriptionRule({ type: 'equals', value: 'coffee' })];
    const b = [createDescriptionRule({ type: 'equals', value: 'tea' })];
    expect(conditionsEqual(a, b)).toBe(false);
  });

  it('flags a changed OPERATOR (equals → contains) as not equal', () => {
    const a = [createDescriptionRule({ type: 'equals', value: 'coffee' })];
    const b = [createDescriptionRule({ type: 'contains', value: 'coffee' })];
    expect(conditionsEqual(a, b)).toBe(false);
  });

  it('flags a changed FIELD as not equal', () => {
    const a = [createDescriptionRule({ type: 'equals', value: '5814' })];
    const b = [createMccRule({ type: 'equals', value: '5814' })];
    expect(conditionsEqual(a, b)).toBe(false);
  });

  it('flags a different condition COUNT as not equal', () => {
    const a = [desc(), amount()];
    const b = [desc()];
    expect(conditionsEqual(a, b)).toBe(false);
  });
});

describe('canonicalConditionSignature — determinism', () => {
  it('yields a byte-identical signature across two calls', () => {
    const rules = [desc(), amount(), mcc()];
    expect(canonicalConditionSignature(rules)).toBe(
      canonicalConditionSignature(rules)
    );
  });

  it('is key-order-stable regardless of operation property order', () => {
    // Same logical operation, different literal key order in the object.
    const a = [createDescriptionRule({ type: 'equals', value: 'coffee' })];
    const b = [createDescriptionRule({ value: 'coffee', type: 'equals' })];
    expect(conditionsEqual(a, b)).toBe(true);
  });
});

describe('canonicalConditionSignature — RegExp matches', () => {
  it('treats /x/i vs /x/i as equal', () => {
    expect(conditionsEqual([matches(/x/i)], [matches(/x/i)])).toBe(true);
  });

  it('treats /x/i vs /x/g (different flags) as NOT equal', () => {
    expect(conditionsEqual([matches(/x/i)], [matches(/x/g)])).toBe(false);
  });

  it('treats /x/ vs /y/ (different source) as NOT equal', () => {
    expect(conditionsEqual([matches(/x/)], [matches(/y/)])).toBe(false);
  });
});

describe('conditionsEqual — empty lists', () => {
  it('treats [] vs [] as equal', () => {
    expect(conditionsEqual([], [])).toBe(true);
  });

  it('treats [] vs [oneRule] as not equal', () => {
    expect(conditionsEqual([], [desc()])).toBe(false);
  });
});
