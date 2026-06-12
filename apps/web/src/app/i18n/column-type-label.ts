import type { Lang } from './i18n';

/**
 * Localized labels for the engine's column-definition strings.
 *
 * The Stage2 snapshot DTO carries `definition` as a plain string (the engine's
 * internal ColumnDefinition enum is NOT on the public surface — the NFR-003
 * fence forbids importing it here).  This table maps every definition string
 * the engine emits, i.e. every value of
 * `packages/engine/src/internal/importStatement/types.ts` ColumnDefinition,
 * EXCEPT 'unknown': an unknown/unmapped column renders the `s3aUnkType`
 * catalog copy («без типу» / "untyped"), never a type label.
 *
 * Label provenance (visual truth, verbatim):
 * - the prototype's TYPE_LABEL (design-reference/s3a-i18n.jsx) — date, amount,
 *   description, currency, balance;
 * - the S3b bundle's TYPES table (design-reference/s3b-data.jsx) for the rest —
 *   the canonical bilingual names for the full ENT-009 set.
 *
 * Coverage is pinned by column-type-label.spec.ts against a hardcoded copy of
 * the enum's values (the fence forbids importing the enum into the test too).
 */
export const COLUMN_TYPE_LABEL: Record<Lang, Record<string, string>> = {
  uk: {
    date: 'Дата',
    amount: 'Сума',
    description: 'Опис',
    currency: 'Валюта',
    balance: 'Баланс',
    bank_account: 'Рахунок',
    category: 'Категорія банку',
    status: 'Статус',
    merchant_category: 'MCC (код продавця)',
    exchange_rate: 'Курс обміну',
    bank_commission: 'Комісія банку',
    cashback: 'Кешбек',
    time: 'Час',
    counterparty: 'Контрагент',
    ignore: 'Ігнорувати',
  },
  en: {
    date: 'Date',
    amount: 'Amount',
    description: 'Description',
    currency: 'Currency',
    balance: 'Balance',
    bank_account: 'Account',
    category: 'Bank category',
    status: 'Status',
    merchant_category: 'MCC (merchant code)',
    exchange_rate: 'Exchange rate',
    bank_commission: 'Bank commission',
    cashback: 'Cashback',
    time: 'Time',
    counterparty: 'Counterparty',
    ignore: 'Ignore',
  },
};

/**
 * Localized label for a column-definition string.
 * Unmapped values fall back to the raw string (prototype behavior:
 * `TL[c.type] || c.type` in s3a-app.jsx) — loud in the UI, never blank.
 */
export function columnTypeLabel(definition: string, lang: Lang): string {
  return COLUMN_TYPE_LABEL[lang][definition] ?? definition;
}
