/**
 * classifyEditAction spec — Story 4.9b, Task 2 (EP-4).
 * @module internal/rules/classify-edit-action.spec
 * @internal
 *
 * The pure lane-routing function extracted from {@link RuleSandboxSession.classify}
 * (the «dynamic button» lane the wire's rulesClassify previews). reorder/delete →
 * sandbox; categoryOnly/appendEnd → live; editConditions → live when canonically
 * equal (order-independent), sandbox when the condition SET changed.
 */
import { describe, expect, it } from 'vitest';
import { classifyEditAction } from './rule-sandbox';
import { createDescriptionRule } from './rule-factories';

describe('classifyEditAction (pure — the dynamic-button lane)', () => {
  it('reorder + delete → sandbox', () => {
    expect(classifyEditAction({ kind: 'reorder', order: [2, 1] })).toBe('sandbox');
    expect(classifyEditAction({ kind: 'delete', ruleId: 1 })).toBe('sandbox');
  });
  it('categoryOnly + appendEnd → live', () => {
    const category = { name: 'X', icon: 'x', isArchived: false, currency: 'UAH' };
    expect(classifyEditAction({ kind: 'categoryOnly', ruleId: 1, category })).toBe('live');
  });
  it('editConditions → live when canonically equal (any order), sandbox when changed', () => {
    const a = createDescriptionRule({ type: 'contains', value: 'АТБ' });
    const b = createDescriptionRule({ type: 'contains', value: 'СІЛЬПО' });
    expect(classifyEditAction({ kind: 'editConditions', ruleId: 1, before: [a, b], after: [b, a] })).toBe('live');
    expect(classifyEditAction({ kind: 'editConditions', ruleId: 1, before: [a], after: [a, b] })).toBe('sandbox');
  });
});
