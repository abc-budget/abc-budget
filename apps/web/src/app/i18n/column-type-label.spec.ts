import { describe, expect, it } from 'vitest';
import { COLUMN_TYPE_LABEL, columnTypeLabel } from './column-type-label';

/**
 * Hardcoded copy of the engine's ColumnDefinition enum VALUES
 * (packages/engine/src/internal/importStatement/types.ts — the 16-entry
 * ENT-009 canon), minus 'unknown': unknown columns render the s3aUnkType
 * catalog copy, never a type label.  The NFR-003 fence forbids importing the
 * enum here — if the engine adds a definition, extend THIS list and
 * COLUMN_TYPE_LABEL together.
 */
const ENGINE_COLUMN_DEFINITIONS = [
  'date',
  'amount',
  'description',
  'currency',
  'balance',
  'bank_account',
  'category',
  'status',
  'merchant_category',
  'exchange_rate',
  'bank_commission',
  'cashback',
  'time',
  'counterparty',
  'ignore',
] as const;

describe('columnTypeLabel — full ColumnDefinition coverage (2.7)', () => {
  it('covers EXACTLY the engine definition set, uk and en (no gaps, no strays)', () => {
    const expected = [...ENGINE_COLUMN_DEFINITIONS].sort();
    expect(Object.keys(COLUMN_TYPE_LABEL.uk).sort()).toEqual(expected);
    expect(Object.keys(COLUMN_TYPE_LABEL.en).sort()).toEqual(expected);
  });

  it('no empty labels in either language', () => {
    for (const lang of ['uk', 'en'] as const) {
      for (const def of ENGINE_COLUMN_DEFINITIONS) {
        expect(columnTypeLabel(def, lang).length, `${lang}:${def}`).toBeGreaterThan(0);
      }
    }
  });

  it('prototype TYPE_LABEL entries are verbatim (s3a-i18n.jsx)', () => {
    expect(columnTypeLabel('date', 'uk')).toBe('Дата');
    expect(columnTypeLabel('amount', 'uk')).toBe('Сума');
    expect(columnTypeLabel('description', 'uk')).toBe('Опис');
    expect(columnTypeLabel('currency', 'uk')).toBe('Валюта');
    expect(columnTypeLabel('balance', 'uk')).toBe('Баланс');
    expect(columnTypeLabel('date', 'en')).toBe('Date');
    expect(columnTypeLabel('balance', 'en')).toBe('Balance');
  });

  it('extended entries use the S3b bundle TYPES names (s3b-data.jsx)', () => {
    expect(columnTypeLabel('merchant_category', 'uk')).toBe('MCC (код продавця)');
    expect(columnTypeLabel('merchant_category', 'en')).toBe('MCC (merchant code)');
    expect(columnTypeLabel('counterparty', 'uk')).toBe('Контрагент');
    expect(columnTypeLabel('bank_commission', 'en')).toBe('Bank commission');
    expect(columnTypeLabel('exchange_rate', 'uk')).toBe('Курс обміну');
  });

  it('unmapped strings fall back to the raw value (prototype TL[type] || type)', () => {
    expect(columnTypeLabel('something_new', 'uk')).toBe('something_new');
    expect(columnTypeLabel('something_new', 'en')).toBe('something_new');
  });
});
