/** Shared DTO fixtures for the S3c component specs. */
import type {
  CategorizedRowDTO,
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  RuleSummaryDTO,
  WhyTreeDTO,
} from '@abc-budget/engine';

export function cat(over: Partial<CategoryDTO> = {}): CategoryDTO {
  return { id: 'groceries', name: 'Продукти', icon: 'groceries', currency: 'UAH', ...over };
}

export function categoryMap(...cats: CategoryDTO[]): Map<string, CategoryDTO> {
  return new Map(cats.map((c) => [c.id, c]));
}

export function row(over: Partial<CategorizedRowDTO> = {}): CategorizedRowDTO {
  return {
    rowIndex: 0,
    date: '2023-09-30T00:00:00.000Z',
    amount: -249.5,
    currency: 'UAH',
    description: 'АТБ МАРКЕТ',
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: 5812,
    categoryId: 'groceries',
    isManual: 0,
    ruleId: 1,
    ...over,
  };
}

export function field(over: Partial<ConditionFieldDTO> = {}): ConditionFieldDTO {
  return { field: 'description', valueKind: 'text', operators: ['contains', 'equals'], ...over };
}

/**
 * A realistic MAPPED field set — the engine emits OUR field ids (description, not
 * the prototype `desc`), and only the structural + import-mapped fields (no
 * currency / isBankCommission / isCashback), mirroring the corrected engine
 * output.  `bankCategory` is the UI "category" name-trap (the BANK category).
 */
export const FIELDS: ConditionFieldDTO[] = [
  field({ field: 'date', valueKind: 'day', operators: ['specificDay', 'dayRange'] }),
  field({ field: 'description', valueKind: 'text', operators: ['contains', 'equals'] }),
  field({ field: 'amount', valueKind: 'num', operators: ['greaterThan', 'lessThan', 'between'] }),
  field({ field: 'mcc', valueKind: 'code', operators: ['equals'], options: [{ value: '5411', label: '5411' }] }),
  field({ field: 'account', valueKind: 'text', operators: ['contains', 'equals'] }),
  field({ field: 'counterparty', valueKind: 'text', operators: ['contains', 'equals'] }),
  field({ field: 'bankCategory', valueKind: 'optset', operators: ['equals', 'oneOf'] }),
];

/**
 * A MULTI-CURRENCY field set — when the import has >1 distinct currency, the
 * engine surfaces the `currency` field (valueKind `'optone'` per the grammar).
 * Used to assert the currency column renders its localized header + the verbatim
 * code (UAH/USD), NOT `—`.
 */
export const FIELDS_MULTI_CURRENCY: ConditionFieldDTO[] = [
  field({ field: 'date', valueKind: 'day', operators: ['specificDay', 'dayRange'] }),
  field({ field: 'description', valueKind: 'text', operators: ['contains', 'equals'] }),
  field({
    field: 'currency',
    valueKind: 'optone',
    operators: ['equals', 'notEquals', 'oneOf'],
    options: [
      { value: 'UAH', label: 'UAH' },
      { value: 'USD', label: 'USD' },
    ],
  }),
  field({ field: 'amount', valueKind: 'num', operators: ['greaterThan', 'lessThan', 'between'] }),
];

export function cond(over: Partial<ConditionDTO> = {}): ConditionDTO {
  return { field: 'description', operator: 'contains', value: 'МАРКЕТ', ...over };
}

export function rule(over: Partial<RuleSummaryDTO> = {}): RuleSummaryDTO {
  return {
    ruleId: 1,
    conditions: [cond()],
    categoryId: 'groceries',
    appliedCount: 7,
    ...over,
  };
}

// ── 4.9b sandbox / rule-editing fixtures ──

/** A changed row in the sandbox diff: previousCategoryId set + differs from categoryId. */
export function diffRow(over: Partial<CategorizedRowDTO> = {}): CategorizedRowDTO {
  return row({ categoryId: 'transport', previousCategoryId: 'groceries', ruleId: 2, ...over });
}

export const CAT_GROCERIES = cat({ id: 'groceries', name: 'Продукти', icon: 'groceries', currency: 'UAH' });
export const CAT_TRANSPORT = cat({ id: 'transport', name: 'Транспорт', icon: 'transport', currency: 'UAH' });
export const CAT_TRAVEL = cat({ id: 'travel', name: 'Подорожі', icon: 'travel', currency: 'USD' });

export const RULES_MULTI: RuleSummaryDTO[] = [
  rule({ ruleId: 1, conditions: [cond({ field: 'description', operator: 'contains', value: 'АТБ' })], categoryId: 'groceries', appliedCount: 7 }),
  rule({ ruleId: 2, conditions: [cond({ field: 'amount', operator: 'lessThan', value: -1000, currency: 'UAH' })], categoryId: 'transport', appliedCount: 3 }),
  rule({ ruleId: 3, conditions: [cond({ field: 'currency', operator: 'equals', value: 'USD' })], categoryId: 'travel', appliedCount: 2 }),
];

export const ROWS_MULTI_CURRENCY: CategorizedRowDTO[] = [
  row({ rowIndex: 0, currency: 'UAH', amount: -249.5, description: 'АТБ МАРКЕТ', categoryId: 'groceries', ruleId: 1 }),
  row({ rowIndex: 1, currency: 'USD', amount: -42, description: 'BOOKING.COM', categoryId: 'travel', ruleId: 3 }),
  row({ rowIndex: 2, currency: 'UAH', amount: -1500, description: 'УКЛОН', categoryId: 'transport', ruleId: 2 }),
];

export function sandboxState(over: Partial<{ engaged: boolean; count: number }> = {}) {
  return { engaged: true, count: 2, ...over };
}

export function whyTree(over: Partial<WhyTreeDTO> = {}): WhyTreeDTO {
  return {
    manual: null,
    winnerRuleId: 1,
    rules: [
      {
        ruleId: 1,
        status: 'win',
        categoryId: 'groceries',
        conditions: [{ field: 'description', operator: 'contains', value: 'МАРКЕТ', met: true }],
      },
      {
        ruleId: 2,
        status: 'miss',
        categoryId: 'dining',
        conditions: [{ field: 'description', operator: 'contains', value: 'КАВА', met: false }],
      },
      {
        ruleId: 3,
        status: 'neutral',
        categoryId: 'other',
        conditions: [{ field: 'amount', operator: 'greaterThan', value: 100, met: null }],
      },
    ],
    ...over,
  };
}
