/** Shape of a single entry in currencies.json (dataset inspection 2026-06-10). */
export interface LocalizedCurrencyData {
  symbol: string;
  name: string;
}

export interface CurrencyEntry {
  code: string;
  defaultFractionDigits: number;
  numericCode: number;
  localizedData: {
    en: LocalizedCurrencyData;
    uk: LocalizedCurrencyData;
  };
  specialSymbols?: string[];
}

/** Shape of a single entry in locale2currency.json (764 entries, '_'-separated locales). */
export interface LocaleEntry {
  locale: string;
  currency: string;
}
