/**
 * `rehydrateRule` round-trip spec (Story 4.3b Task 2) — PM RULING 2 teeth.
 * @module internal/rules/rehydrate.spec
 * @internal
 *
 * Proves the deserialize path is REAL: for a representative rule per field
 * family, do serialize → rehydrate → EVALUATE and assert the rehydrated rule
 * behaves IDENTICALLY to the original on BOTH a matching and a non-matching row.
 * Identical behavior is the proof the field→factory dispatch reconstructs the
 * same predicate — not merely the same `{field, operation}` shape.
 *
 *  - description (StringOperation), date (DateOperation), mcc (StringMatchOperation),
 *    isCashback (BooleanOperation), AND a standalone `amount` rule (the key adapt:
 *    the amount Rule is pulled out of `createAmountCondition(...)[0]`).
 *  - serialize is `{ field: rule.field, operation: rule.operation }` (the DTO shape).
 *  - unknown field → `null`, no throw.
 *
 * The fixture mirrors rule-factories.spec.ts: a minimal row cast built WITHOUT a
 * `source` key (the field was removed from the row in 4.1).
 */

import { describe, it, expect } from 'vitest';
import {
  createAmountCondition,
  createDateRule,
  createDescriptionRule,
  createIsCashbackRule,
  createMccRule,
  rehydrateRule,
} from './rule-factories';
import type { Rule } from './rule';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal ImportStatementStage3Row, overriding only what a test cares
 * about. NOTE: no `source` key — the cast lets us omit it (4.1 removed it from
 * the row shape).
 */
function makeRow(
  overrides: Partial<ImportStatementStage3Row> = {}
): ImportStatementStage3Row {
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

/** The DTO serialize shape: exactly `{ field, operation }`. */
function serialize(rule: Rule): { field: string; operation: Rule['operation'] } {
  return { field: rule.field, operation: rule.operation };
}

/**
 * The teeth: rehydrate `original`, then assert the rehydrated rule evaluates to
 * the SAME boolean as `original` on a matching row and a non-matching row.
 */
function assertRoundTripIdentical(
  original: Rule,
  matchingRow: ImportStatementStage3Row,
  nonMatchingRow: ImportStatementStage3Row
): void {
  const dto = serialize(original);
  const rehydrated = rehydrateRule(dto.field, dto.operation);

  expect(rehydrated).not.toBeNull();
  // narrow for the eval calls below
  const rule = rehydrated as Rule;

  expect(rule.field).toBe(original.field);

  // matching row: original true → rehydrated true
  expect(original.evaluate(matchingRow)).toBe(true);
  expect(rule.evaluate(matchingRow)).toBe(original.evaluate(matchingRow));

  // non-matching row: original false → rehydrated false
  expect(original.evaluate(nonMatchingRow)).toBe(false);
  expect(rule.evaluate(nonMatchingRow)).toBe(original.evaluate(nonMatchingRow));
}

// ── serialize → rehydrate → evaluate identically, per field family ───────────

describe('rehydrateRule — serialize→deserialize→evaluate round-trip (PM RULING 2)', () => {
  it('description (StringOperation) rehydrates and evaluates identically', () => {
    const original = createDescriptionRule({ type: 'contains', value: 'coffee' });
    assertRoundTripIdentical(
      original,
      makeRow({ description: 'morning coffee shop' }),
      makeRow({ description: 'tea house' })
    );
  });

  it('date (DateOperation) rehydrates and evaluates identically', () => {
    // 2024-06-15 is the 15th of the month.
    const original = createDateRule({ type: 'specificDay', value: 15 });
    assertRoundTripIdentical(
      original,
      makeRow({ date: new Date('2024-06-15T12:00:00.000Z') }),
      makeRow({ date: new Date('2024-06-16T12:00:00.000Z') })
    );
  });

  it('mcc (StringMatchOperation) rehydrates and evaluates identically', () => {
    const original = createMccRule({ type: 'oneOf', values: ['5411', '5812'] });
    assertRoundTripIdentical(
      original,
      makeRow({ mcc: 5411 }),
      makeRow({ mcc: 5999 })
    );
  });

  it('isCashback (BooleanOperation) rehydrates and evaluates identically', () => {
    const original = createIsCashbackRule({ type: 'isTrue' });
    assertRoundTripIdentical(
      original,
      makeRow({ isCashback: true }),
      makeRow({ isCashback: false })
    );
  });

  it('amount (standalone, the key adapt) rehydrates and evaluates identically', () => {
    // Pull the bare amount Rule out of the Fork-B pair — persisted amount
    // conditions are already two DTOs, so the amount rule rehydrates ALONE.
    const original = createAmountCondition({ type: 'greaterThan', value: 100 }, 'UAH')[0];
    expect(original.field).toBe('amount');
    assertRoundTripIdentical(
      original,
      makeRow({ amount: 150 }),
      makeRow({ amount: 50 })
    );
  });
});

// ── unknown field → null (no throw) ──────────────────────────────────────────

describe('rehydrateRule — unknown field', () => {
  it('returns null for an unsupported field and does not throw', () => {
    let result: Rule | null = ({} as Rule);
    expect(() => {
      result = rehydrateRule('bogusField', { type: 'equals', value: 'x' });
    }).not.toThrow();
    expect(result).toBeNull();
  });
});
