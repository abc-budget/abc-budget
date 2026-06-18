/**
 * Shared amount-formatting helpers for S3c components.
 * Extracted from OpsPanel so AutoOtherModal can reuse the same formatter
 * without duplication.
 */

export const CURRENCY_SYMBOL: Record<string, string> = { UAH: '₴', USD: '$', EUR: '€', GBP: '£' };

export function fmtAmount(amount: number, currency: string): string {
  const v = Math.abs(amount)
    .toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/ /g, ' ');
  return `${amount < 0 ? '−' : ''}${v} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}
