/**
 * Typed rule factories (Story 4.1 Task 2, EP-4 condition grammar).
 * @module internal/rules/rule-factories
 * @internal
 *
 * PORT of `webapp/libs/engine/src/importStatement/stage3/decision-tree/rule-factories.ts`.
 * The evaluate closures are byte-faithful to the prior art EXCEPT the ENT-010
 * adapts called out below:
 *
 *  - +counterparty: `createCounterpartyRule` added, and the shared
 *    `createStringOperationRule` field param widened to
 *    `'description' | 'account' | 'counterparty'` (ENT-006 distinct field).
 *  - −source: `createSourceRule` is NOT ported — the row field was removed.
 *  - amount↔currency (Fork B): the bare amount factory is MODULE-PRIVATE; the
 *    only export is `createAmountCondition(op, currency)`, which AND-pairs the
 *    amount rule with a `currency=equals` rule. An amount condition is
 *    unconstructable without a currency.
 *  - ReDoS (Fork C): in `createStringOperationRule`, `matches` calls
 *    `assertSafeRegex` at CONSTRUCTION and the evaluate closure caps the matched
 *    string at `MAX_MATCH_INPUT` chars (the primary mitigation).
 *  - mcc stays CATEGORICAL: `createMccRule` takes `StringMatchOperation` over
 *    `String(row.mcc)` (as in the prior art), NOT a NumberOperation range.
 */

import type {
  ImportStatementStage3Row,
  ImportStatementStage3RowField,
} from '../importStatement/stage3/types';
import type { Rule } from './rule';
import { RuleImpl } from './rule';
import { assertSafeRegex, MAX_MATCH_INPUT } from './safe-regex';
import type {
  BooleanOperation,
  DateOperation,
  NumberOperation,
  StringMatchOperation,
  StringOperation,
} from './operations';

/**
 * Creates a rule for the date field
 * @param operation Operation to perform on the date field
 * @returns Rule for the date field
 */
export function createDateRule(operation: DateOperation): Rule {
  return new RuleImpl(
    'date',
    operation,
    (row: ImportStatementStage3Row): boolean => {
      const date = row.date;
      if (!date) return false;

      // Story 4.2 Task 5 — UTC basis (PM ruling, ADAPT vs the LOCAL-time prior
      // art): EVERY date operator reads the UTC calendar day
      // (getUTCDate/getUTCMonth/getUTCDay/getUTCFullYear). This is consistent
      // with `deriveFootprint`, which splits year/month via `getUTCFullYear`/
      // `getUTCMonth` and keys the rate lookup on the UTC date. Local accessors
      // would let a date-rule and the footprint month DISAGREE at a day/month
      // boundary under a non-UTC host TZ (e.g. a 02:00Z operation reads as the
      // previous day locally in the Americas) — they must NEVER disagree.
      switch (operation.type) {
        case 'firstDayOfMonth':
          return date.getUTCDate() === 1;

        case 'firstMondayOfMonth': {
          const day = date.getUTCDay();
          const dateOfMonth = date.getUTCDate();
          // If it's Monday (1) and it's in the first 7 days of the month
          return day === 1 && dateOfMonth <= 7;
        }

        case 'firstSaturdayOfMonth': {
          const day = date.getUTCDay();
          const dateOfMonth = date.getUTCDate();
          // If it's Saturday (6) and it's in the first 7 days of the month
          return day === 6 && dateOfMonth <= 7;
        }

        case 'firstSundayOfMonth': {
          const day = date.getUTCDay();
          const dateOfMonth = date.getUTCDate();
          // If it's Sunday (0) and it's in the first 7 days of the month
          return day === 0 && dateOfMonth <= 7;
        }

        case 'lastDayOfMonth': {
          // Day 0 of the NEXT month (in UTC) is the last day of THIS month.
          const lastDay = new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
          ).getUTCDate();
          return date.getUTCDate() === lastDay;
        }

        case 'lastMondayOfMonth': {
          const day = date.getUTCDay();
          const dateOfMonth = date.getUTCDate();
          const lastDay = new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
          ).getUTCDate();
          // If it's Monday (1) and it's in the last 7 days of the month
          return day === 1 && dateOfMonth > lastDay - 7;
        }

        case 'lastSaturdayOfMonth': {
          const day = date.getUTCDay();
          const dateOfMonth = date.getUTCDate();
          const lastDay = new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
          ).getUTCDate();
          // If it's Saturday (6) and it's in the last 7 days of the month
          return day === 6 && dateOfMonth > lastDay - 7;
        }

        case 'lastSundayOfMonth': {
          const day = date.getUTCDay();
          const dateOfMonth = date.getUTCDate();
          const lastDay = new Date(
            Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
          ).getUTCDate();
          // If it's Sunday (0) and it's in the last 7 days of the month
          return day === 0 && dateOfMonth > lastDay - 7;
        }

        case 'specificDay':
          // Check if the day of the month matches the specified day (1-31)
          return date.getUTCDate() === operation.value;

        case 'dayRange': {
          // Check if the day of the month is within the specified range (1-31)
          const dayOfMonth = date.getUTCDate();
          return dayOfMonth >= operation.start && dayOfMonth <= operation.end;
        }

        default:
          return false;
      }
    }
  );
}

/**
 * MODULE-PRIVATE bare amount factory (Fork B). Not exported: an amount condition
 * is meaningless without a currency, so callers MUST go through
 * {@link createAmountCondition}, which AND-pairs this rule with a currency rule.
 *
 * @param operation Operation to perform on the amount field
 * @returns Rule for the amount field
 */
function createAmountRule(operation: NumberOperation): Rule {
  return new RuleImpl(
    'amount',
    operation,
    (row: ImportStatementStage3Row): boolean => {
      const amount = row.amount;

      switch (operation.type) {
        case 'equals':
          return amount === operation.value;

        case 'notEquals':
          return amount !== operation.value;

        case 'greaterThan':
          return amount > operation.value;

        case 'lessThan':
          return amount < operation.value;

        case 'greaterThanOrEqual':
          return amount >= operation.value;

        case 'lessThanOrEqual':
          return amount <= operation.value;

        case 'between':
          return amount >= operation.min && amount <= operation.max;

        default:
          return false;
      }
    }
  );
}

/**
 * Fork B (PM-ruled): build an amount condition as an AND-pair of an amount rule
 * and a `currency=equals` rule. The amount semantics are currency-relative — an
 * amount of "100" is only meaningful once pinned to a currency — so this factory
 * is the ONLY way to construct an amount rule; the bare amount factory above is
 * module-private.
 *
 * The returned pair AND-combines in the (Story 4.2) ComplexRule: a row matches
 * only when BOTH its amount satisfies `operation` AND its currency equals
 * `currency`. An amount condition is unconstructable without a currency.
 *
 * @param operation Number operation over the amount field.
 * @param currency Non-blank currency code the amount is pinned to.
 * @returns `[amountRule, currencyEqualsRule]` — a 2-rule AND-pair.
 * @throws {TypeError} If `currency` is empty or blank.
 */
export function createAmountCondition(
  operation: NumberOperation,
  currency: string
): Rule[] {
  if (currency.trim().length === 0) {
    throw new TypeError(
      'createAmountCondition requires a non-blank currency: an amount condition is unconstructable without a currency.'
    );
  }
  return [
    createAmountRule(operation),
    createCurrencyRule({ type: 'equals', value: currency }),
  ];
}

/**
 * Creates a rule for the mcc field using string matching operations.
 * mcc is CATEGORICAL (equals/notEquals/oneOf over `String(row.mcc)`), NOT a
 * numeric range.
 * @param operation String matching operation to perform on the mcc field
 * @returns Rule for the mcc field
 */
export function createMccRule(operation: StringMatchOperation): Rule {
  return createStringMatchRule('mcc', operation);
}

/**
 * Creates a rule for a string field using string operations.
 *
 * Fork C (PM-ruled) — for `matches`: {@link assertSafeRegex} runs at
 * CONSTRUCTION (a catastrophic pattern throws `UnsafeRegexError` when the rule
 * is BUILT, not at eval), and the evaluate closure runs the regex against the
 * input CAPPED to {@link MAX_MATCH_INPUT} chars (the primary mitigation). All
 * other string ops are ported verbatim.
 *
 * @param field Field to evaluate in the rule
 * @param operation String operation to perform on the field
 * @returns Rule for the specified field
 */
export function createStringOperationRule(
  field: 'description' | 'account' | 'counterparty',
  operation: StringOperation
): Rule {
  // Fork C: reject obvious bombs at CONSTRUCTION, before the rule is ever run.
  if (operation.type === 'matches') {
    assertSafeRegex(operation.pattern);
  }

  // `counterparty` is a real row key but is excluded from the column-header
  // `ImportStatementStage3RowField` union (ENT-006: it's a distinct output
  // field, not a stage-column field). The Rule.field surface uses that union, so
  // narrow the constructor arg here — the row indexing below is still type-safe.
  return new RuleImpl(
    field as ImportStatementStage3RowField,
    operation,
    (row: ImportStatementStage3Row): boolean => {
      const value = (row[field] as string) || '';

      switch (operation.type) {
        case 'equals':
          return value === operation.value;

        case 'notEquals':
          return value !== operation.value;

        case 'contains':
          return value.includes(operation.value);

        case 'notContains':
          return !value.includes(operation.value);

        case 'startsWith':
          return value.startsWith(operation.value);

        case 'endsWith':
          return value.endsWith(operation.value);

        case 'matches':
          // Fork C primary mitigation: cap the matched string length so even a
          // bomb the construction screen missed cannot blow up backtracking.
          return operation.pattern.test(value.slice(0, MAX_MATCH_INPUT));

        default:
          return false;
      }
    }
  );
}

/**
 * Creates a rule for the description field
 * @param operation Operation to perform on the description field
 * @returns Rule for the description field
 */
export function createDescriptionRule(operation: StringOperation): Rule {
  return createStringOperationRule('description', operation);
}

/**
 * Creates a rule for the account field
 * @param operation Operation to perform on the account field
 * @returns Rule for the account field
 */
export function createAccountRule(operation: StringOperation): Rule {
  return createStringOperationRule('account', operation);
}

/**
 * Creates a rule for the counterparty field (ENT-006: distinct from description)
 * @param operation Operation to perform on the counterparty field
 * @returns Rule for the counterparty field
 */
export function createCounterpartyRule(operation: StringOperation): Rule {
  return createStringOperationRule('counterparty', operation);
}

/**
 * Creates a rule for the bankCategory field using string matching operations
 * @param operation String matching operation to perform on the bankCategory field
 * @returns Rule for the bankCategory field
 */
export function createBankCategoryRule(operation: StringMatchOperation): Rule {
  return createStringMatchRule('bankCategory', operation);
}

/**
 * Creates a rule for the currency field using string matching operations
 * @param operation String matching operation to perform on the currency field
 * @returns Rule for the currency field
 */
export function createCurrencyRule(operation: StringMatchOperation): Rule {
  return createStringMatchRule('currency', operation);
}

/**
 * Creates a rule for a boolean field
 * @param field Field to evaluate in the rule
 * @param operation Operation to perform on the field
 * @returns Rule for the specified field
 */
export function createBooleanOperationRule(
  field: 'isBankCommission' | 'isCashback',
  operation: BooleanOperation
): Rule {
  return new RuleImpl(
    field,
    operation,
    (row: ImportStatementStage3Row): boolean => {
      const value = row[field] as boolean;

      switch (operation.type) {
        case 'isTrue':
          return value === true;

        case 'isFalse':
          return value === false;

        default:
          return false;
      }
    }
  );
}

/**
 * Creates a rule for the isBankCommission field
 * @param operation Operation to perform on the isBankCommission field
 * @returns Rule for the isBankCommission field
 */
export function createIsBankCommissionRule(operation: BooleanOperation): Rule {
  return createBooleanOperationRule('isBankCommission', operation);
}

/**
 * Creates a rule for the isCashback field
 * @param operation Operation to perform on the isCashback field
 * @returns Rule for the isCashback field
 */
export function createIsCashbackRule(operation: BooleanOperation): Rule {
  return createBooleanOperationRule('isCashback', operation);
}

/**
 * Creates a rule for any field using string matching operations
 * @param field Field to evaluate in the rule
 * @param operation String matching operation to perform on the field
 * @returns Rule for the specified field
 */
export function createStringMatchRule(
  field: ImportStatementStage3RowField,
  operation: StringMatchOperation
): Rule {
  return new RuleImpl(
    field,
    operation,
    (row: ImportStatementStage3Row): boolean => {
      const value = String(row[field] || '');

      switch (operation.type) {
        case 'equals':
          return value === operation.value;

        case 'notEquals':
          return value !== operation.value;

        case 'oneOf':
          return operation.values.includes(value);

        default:
          return false;
      }
    }
  );
}
