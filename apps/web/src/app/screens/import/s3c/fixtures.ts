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
    date: '2026-03-14',
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
  return { field: 'desc', valueKind: 'text', operators: ['contains', 'eq'], ...over };
}

export const FIELDS: ConditionFieldDTO[] = [
  field({ field: 'date', valueKind: 'day', operators: ['eq', 'between'] }),
  field({ field: 'desc', valueKind: 'text', operators: ['contains', 'eq'] }),
  field({ field: 'amount', valueKind: 'num', operators: ['gt', 'lt', 'between'] }),
  field({ field: 'mcc', valueKind: 'code', operators: ['eq'], options: [{ value: '5411', label: '5411' }] }),
];

export function cond(over: Partial<ConditionDTO> = {}): ConditionDTO {
  return { field: 'desc', operator: 'contains', value: 'МАРКЕТ', ...over };
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

export function whyTree(over: Partial<WhyTreeDTO> = {}): WhyTreeDTO {
  return {
    manual: null,
    winnerRuleId: 1,
    rules: [
      {
        ruleId: 1,
        status: 'win',
        categoryId: 'groceries',
        conditions: [{ field: 'desc', operator: 'contains', value: 'МАРКЕТ', met: true }],
      },
      {
        ruleId: 2,
        status: 'miss',
        categoryId: 'dining',
        conditions: [{ field: 'desc', operator: 'contains', value: 'КАВА', met: false }],
      },
      {
        ruleId: 3,
        status: 'neutral',
        categoryId: 'other',
        conditions: [{ field: 'amount', operator: 'gt', value: 100, met: null }],
      },
    ],
    ...over,
  };
}
