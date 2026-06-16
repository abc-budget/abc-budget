/**
 * Rule reorder spec (Story 4.2, Task 4).
 * @module internal/rules/order-utils.spec
 * @internal
 *
 * Pins the ported `identifyNewOrder` (its 3 documented worked examples +
 * id-preservation) and the pure `reorderRuleOrders` validation helper
 * (empty-subset passthrough, missing-id throw, all-present reorder).
 * No DAO / persistence here — that wiring is Story 4.3.
 */

import { describe, it, expect } from 'vitest';
import { identifyNewOrder, reorderRuleOrders } from './order-utils';
import { LocalizableException } from '../utils/messages/index';

describe('identifyNewOrder — documented worked examples', () => {
  it('Case 1: reorder [1, 3, 2] → {1:1, 2:3, 3:2, 4:4, 5:5}', () => {
    expect(identifyNewOrder({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, [1, 3, 2])).toEqual({
      1: 1,
      2: 3,
      3: 2,
      4: 4,
      5: 5,
    });
  });

  it('Case 2: reorder [5, 4, 3] → {1:1, 2:2, 3:5, 4:4, 5:3}', () => {
    expect(identifyNewOrder({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, [5, 4, 3])).toEqual({
      1: 1,
      2: 2,
      3: 5,
      4: 4,
      5: 3,
    });
  });

  it('Case 3: reorder [2, 1, 5] → {1:2, 2:1, 3:3, 4:4, 5:5}', () => {
    expect(identifyNewOrder({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, [2, 1, 5])).toEqual({
      1: 2,
      2: 1,
      3: 3,
      4: 4,
      5: 5,
    });
  });
});

describe('identifyNewOrder — id preservation', () => {
  it('non-subset ids keep their original orders', () => {
    const result = identifyNewOrder({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, [1, 3, 2]);
    // 4 and 5 are not in the subset → untouched
    expect(result[4]).toBe(4);
    expect(result[5]).toBe(5);
  });

  it('the result keys are exactly the input keys — no id invented or dropped', () => {
    const input = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 };
    const result = identifyNewOrder(input, [2, 1, 5]);
    expect(Object.keys(result).sort()).toEqual(Object.keys(input).sort());
  });

  it('empty subset returns the input unchanged', () => {
    const input = { 1: 1, 2: 2, 3: 3 };
    expect(identifyNewOrder(input, [])).toEqual(input);
  });
});

describe('reorderRuleOrders — pure validation + reorder (persistence is Story 4.3)', () => {
  it('empty subset returns currentOrders unchanged', () => {
    const current = { 1: 1, 2: 2, 3: 3 };
    expect(reorderRuleOrders(current, [])).toEqual(current);
  });

  it('throws LocalizableException when a subset id is absent from currentOrders', () => {
    expect(() => reorderRuleOrders({ 1: 1, 2: 2, 3: 3 }, [1, 99])).toThrow(
      LocalizableException
    );
  });

  it('returns the reordered orders when all subset ids are present', () => {
    expect(reorderRuleOrders({ 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }, [1, 3, 2])).toEqual({
      1: 1,
      2: 3,
      3: 2,
      4: 4,
      5: 5,
    });
  });
});
