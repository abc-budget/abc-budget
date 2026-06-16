/**
 * Rule operator-union spec (Story 4.1, Task 1).
 * @module internal/rules/operations.spec
 * @internal
 *
 * Light structural pins for the 5 operator unions ported byte-identical from the
 * prior art / ENT-010. The full field×operator matrix is Task 2 — this only
 * proves a couple of representative literals type-check and carry the exact
 * shape ENT-010 expects (a `DateOperation` dayRange, a `StringOperation` matches).
 */

import { describe, it, expect } from 'vitest';
import type {
  DateOperation,
  NumberOperation,
  StringOperation,
  StringMatchOperation,
  BooleanOperation,
  RuleOperation,
} from './operations';

describe('rule operations — representative ENT-010 literals', () => {
  it('a DateOperation dayRange carries { type, start, end }', () => {
    const op: DateOperation = { type: 'dayRange', start: 1, end: 7 };
    expect(op).toEqual({ type: 'dayRange', start: 1, end: 7 });
  });

  it('a DateOperation specificDay carries { type, value }', () => {
    const op: DateOperation = { type: 'specificDay', value: 15 };
    expect(op.value).toBe(15);
  });

  it('a NumberOperation greaterThan carries { type, value }', () => {
    const op: NumberOperation = { type: 'greaterThan', value: 5 };
    expect(op.value).toBe(5);
  });

  it('a NumberOperation between carries { type, min, max }', () => {
    const op: NumberOperation = { type: 'between', min: 1, max: 10 };
    expect(op).toEqual({ type: 'between', min: 1, max: 10 });
  });

  it('a StringOperation matches carries { type, pattern: RegExp }', () => {
    const op: StringOperation = { type: 'matches', pattern: /x/ };
    expect(op.pattern.test('x')).toBe(true);
  });

  it('a StringMatchOperation oneOf carries { type, values: string[] }', () => {
    const op: StringMatchOperation = { type: 'oneOf', values: ['a', 'b'] };
    expect(op.values).toEqual(['a', 'b']);
  });

  it('a BooleanOperation is { type: isTrue } | { type: isFalse }', () => {
    const t: BooleanOperation = { type: 'isTrue' };
    const f: BooleanOperation = { type: 'isFalse' };
    expect([t.type, f.type]).toEqual(['isTrue', 'isFalse']);
  });

  it('RuleOperation accepts any of the member-union literals', () => {
    const ops: RuleOperation[] = [
      { type: 'dayRange', start: 1, end: 7 },
      { type: 'greaterThan', value: 5 },
      { type: 'matches', pattern: /x/ },
      { type: 'isTrue' },
      { type: 'oneOf', values: ['a'] },
    ];
    expect(ops).toHaveLength(5);
  });
});
