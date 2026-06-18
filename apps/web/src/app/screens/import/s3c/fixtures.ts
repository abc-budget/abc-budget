/** Shared DTO fixtures for the S3c component specs. */
import type {
  CategorizedRowDTO,
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  RemainderMagnitudeDTO,
  RuleSummaryDTO,
  TypicalityFlagDTO,
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

// ── 4.9c magnitude + typicality fixtures ──

export function magnitude(over: Partial<RemainderMagnitudeDTO> = {}): RemainderMagnitudeDTO {
  return { opCount: 3, totalOpCount: 12, baseCurrency: 'UAH', baseTotal: -1245.5,
    pending: [{ currency: 'USD', amount: -42 }], approx: true, lastRemainderCategoryId: 'other', ...over };
}

export function typFlag(over: Partial<TypicalityFlagDTO> = {}): TypicalityFlagDTO {
  return { rowIndex: 0, atypicality: 0.82, reasons: [{ field: 'mcc', kind: 'categorical-minority', value: 6051 }], ...over };
}

// A multi-reason, multi-field set — the teeth: mcc(categorical)+amount(outlier ×N)+rare-tokens, across rows.
export const TYPICALITY_MULTI: TypicalityFlagDTO[] = [
  typFlag({ rowIndex: 1, atypicality: 0.91, reasons: [{ field: 'mcc', kind: 'categorical-minority', value: 6051 }] }),
  typFlag({ rowIndex: 2, atypicality: 0.77, reasons: [{ field: 'amount', kind: 'amount-outlier', magnitude: 4 }] }),
  typFlag({ rowIndex: 5, atypicality: 0.68, reasons: [{ field: 'description', kind: 'rare-tokens', tokens: ['КАЗИНО'] }] }),
  typFlag({ rowIndex: 7, atypicality: 0.64, reasons: [{ field: 'counterparty', kind: 'categorical-minority', value: 'ALIEXPRESS' }] }),
];

export const MAGNITUDE_MULTI = magnitude({ opCount: 2, baseTotal: -890, pending: [{ currency: 'USD', amount: -42 }, { currency: 'EUR', amount: -15 }], approx: true });

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
