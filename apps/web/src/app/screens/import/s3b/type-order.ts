/**
 * TYPE_ORDER — the column-type pick list, in engine ColumnDefinition strings.
 *
 * Ported from design-reference/s3b-data.jsx :: TYPE_ORDER, with the bundle's
 * short keys mapped to the engine definitions the snapshot/applyColumn use:
 *   account → bank_account, mcc → merchant_category, rate → exchange_rate,
 *   commission → bank_commission.  'ignore' is last (the menu styles it apart).
 *
 * columnTypeLabel(definition, lang) (2.7) localizes every entry; TypeGlyph
 * renders each glyph.  'ignore' is included; 'unknown' is never an option.
 */
export const TYPE_ORDER = [
  'date',
  'amount',
  'description',
  'currency',
  'balance',
  'bank_account',
  'status',
  'merchant_category',
  'category',
  'exchange_rate',
  'bank_commission',
  'cashback',
  'counterparty',
  'time',
  'ignore',
] as const;

export type ColumnTypeKey = (typeof TYPE_ORDER)[number];
