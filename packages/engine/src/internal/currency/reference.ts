/**
 * Currency reference module.
 *
 * Dataset: currencies.json (233 entries), locale2currency.json (764 entries).
 * Both sourced from @abc-budget/currencies@1.0.50 — see data/PROVENANCE.md.
 *
 * Symbol-lookup rules (symbolToIso):
 *   1. Code passthrough: if the input equals an ISO code exactly, return it.
 *   2. Exact en/uk symbol match (first entry in dataset order wins on ambiguity).
 *   3. specialSymbols match (first entry in dataset order wins on ambiguity).
 *   4. No match → undefined.
 *
 * '$' → USD: USD.en.symbol === '$' and no other entry uses '$' — unambiguous.
 * 'kr' → undefined: 'kr' does not appear in any symbol or specialSymbols field
 *   in the 233-entry dataset.
 *
 * getAmbiguousSymbols: deduplicates symbols WITHIN each entry (per-entry Set) before
 *   counting distinct ISO codes.  '₴' appears in UAH uk.symbol AND UAH specialSymbols —
 *   same currency → not ambiguous.  Dataset reality: only 'C$' (CAD+NIO) and
 *   'K' (MMK+PGK) are genuinely shared by 2+ distinct ISO codes.
 *
 * formatAmount: uses Intl.NumberFormat with digits from the dataset (ENT-019).
 *   Never uses Intl currency style — digits are explicit (minimumFractionDigits /
 *   maximumFractionDigits set to entry.defaultFractionDigits).
 */
import type { CurrencyEntry, LocaleEntry } from './reference.types';
import currenciesRaw from './data/currencies.json';
import locale2currencyRaw from './data/locale2currency.json';

const currencies = currenciesRaw as CurrencyEntry[];
const locale2currency = locale2currencyRaw as LocaleEntry[];

// ── Lookup maps (built once at module load) ──────────────────────────────────

/** ISO code → CurrencyEntry */
const byCode = new Map<string, CurrencyEntry>(
  currencies.map((entry) => [entry.code, entry]),
);

/**
 * Symbol → ISO code.
 * Built in two passes:
 *   Pass 1 — exact en/uk symbol matches (earlier dataset index wins).
 *   Pass 2 — specialSymbols (only if not already claimed by an exact match).
 * This ensures '$' → USD even if a specialSymbols entry for another currency
 * happened to list '$' (it doesn't in the current dataset, but the rule is
 * explicit for correctness).
 */
const symbolMap = new Map<string, string>();

// Pass 1: exact symbols
for (const entry of currencies) {
  const enSym = entry.localizedData.en.symbol;
  const ukSym = entry.localizedData.uk.symbol;
  if (!symbolMap.has(enSym)) symbolMap.set(enSym, entry.code);
  if (!symbolMap.has(ukSym)) symbolMap.set(ukSym, entry.code);
}

// Pass 2: specialSymbols (don't overwrite exact matches)
for (const entry of currencies) {
  if (entry.specialSymbols) {
    for (const sym of entry.specialSymbols) {
      if (!symbolMap.has(sym)) symbolMap.set(sym, entry.code);
    }
  }
}

/** Normalized locale (underscores) → ISO currency code */
const localeMap = new Map<string, string>(
  locale2currency.map((entry) => [entry.locale, entry.currency]),
);

// ── Language → BCP-47 locale tag (for Intl.NumberFormat) ────────────────────

function langToLocale(lang: 'en' | 'uk'): string {
  return lang === 'uk' ? 'uk-UA' : 'en-US';
}

// ── Public API ───────────────────────────────────────────────────────────────

/** Returns the CurrencyEntry for the given ISO code, or undefined if unknown. */
export function getCurrency(code: string): CurrencyEntry | undefined {
  return byCode.get(code);
}

/**
 * Returns the localized display name for the given ISO code and language.
 * Returns undefined if the code is unknown.
 */
export function displayName(code: string, lang: 'en' | 'uk'): string | undefined {
  return byCode.get(code)?.localizedData[lang].name;
}

/**
 * Returns the localized symbol for the given ISO code and language.
 * Returns undefined if the code is unknown.
 */
export function symbol(code: string, lang: 'en' | 'uk'): string | undefined {
  return byCode.get(code)?.localizedData[lang].symbol;
}

/**
 * Formats an amount with the correct number of fraction digits (from the dataset)
 * and the localized symbol.
 *
 * Uses Intl.NumberFormat(locale, { minimumFractionDigits: d, maximumFractionDigits: d })
 * — never Intl's currency style (ENT-019: digits come from the dataset).
 *
 * Returns undefined if the ISO code is unknown.
 */
export function formatAmount(
  amount: number,
  code: string,
  lang: 'en' | 'uk',
): string | undefined {
  const entry = byCode.get(code);
  if (!entry) return undefined;

  const d = entry.defaultFractionDigits;
  const locale = langToLocale(lang);
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(amount);

  const sym = entry.localizedData[lang].symbol;
  // Symbol placement: put symbol after a space for clarity.
  // For Ukrainian locale (uk-UA) Intl places thousands separators per locale norms.
  return `${formatted} ${sym}`;
}

/**
 * Resolves an arbitrary symbol/code string to an ISO currency code.
 *
 * Rules (in order):
 *   1. If the input is an exact ISO code (e.g. 'UAH') → return it unchanged.
 *   2. Exact en/uk symbol match → first dataset entry wins.
 *   3. specialSymbols match → first dataset entry wins.
 *   4. Unknown → undefined.
 *
 * Examples:
 *   '₴'   → 'UAH'  (UAH uk.symbol)
 *   'грн' → 'UAH'  (UAH specialSymbols)
 *   '$'   → 'USD'  (USD en.symbol — only entry with '$')
 *   'UAH' → 'UAH'  (code passthrough)
 *   'kr'  → undefined  ('kr' not in the 233-entry dataset)
 */
export function symbolToIso(input: string): string | undefined {
  // Rule 1: code passthrough
  if (byCode.has(input)) return input;
  // Rules 2 & 3: symbol/specialSymbols map
  return symbolMap.get(input);
}

/**
 * Returns the ISO currency code for a numeric (ISO 4217) code.
 *
 * Added for the 2.2 column-transform port: `parseAsCurrency` needs to match
 * numeric cell values (e.g. 840 → 'USD') against the static dataset.
 *
 * @param numericCode - ISO 4217 numeric code (integer).
 * @returns ISO alpha code, or `undefined` if not found.
 */
export function numericCodeToIso(numericCode: number): string | undefined {
  for (const entry of currencies) {
    if (entry.numericCode === numericCode) {
      return entry.code;
    }
  }
  return undefined;
}

/**
 * Returns all symbol strings that map to more than one DISTINCT ISO code (ambiguous symbols).
 *
 * Used by `parseAsCurrency` to detect ambiguous symbol inputs and emit an error
 * instead of silently choosing one currency.
 *
 * Note: The symbolMap used by `symbolToIso` always picks the FIRST dataset match.
 * This function identifies which inputs would have been ambiguous so callers can
 * surface that information rather than silently accepting the first match.
 *
 * Deduplication rule: symbols are deduplicated WITHIN each entry before counting.
 * For example, UAH has uk.symbol === '₴' and specialSymbols includes '₴' — both
 * refer to the same ISO code (UAH), so '₴' counts as 1, not 2.  Only symbols that
 * appear under 2+ DISTINCT ISO codes are truly ambiguous.
 *
 * Dataset reality (233 entries, verified): exactly 2 ambiguous symbols —
 *   'C$' (CAD + NIO) and 'K' (MMK + PGK).
 *
 * @returns A Set of symbol strings that appear under more than one distinct currency entry.
 */
export function getAmbiguousSymbols(): Set<string> {
  // Map each symbol → Set of distinct ISO codes that use it.
  // Symbols are deduplicated per entry so that a symbol appearing in both
  // en.symbol/uk.symbol AND specialSymbols of the SAME entry is counted once.
  const symbolToCodes = new Map<string, Set<string>>();

  for (const entry of currencies) {
    // Build the de-duplicated set of symbols for this single entry.
    const entrySymbols = new Set<string>([
      entry.localizedData.en.symbol,
      entry.localizedData.uk.symbol,
      ...(entry.specialSymbols ?? []),
    ]);

    for (const sym of entrySymbols) {
      let codes = symbolToCodes.get(sym);
      if (!codes) {
        codes = new Set<string>();
        symbolToCodes.set(sym, codes);
      }
      codes.add(entry.code);
    }
  }

  const ambiguous = new Set<string>();
  for (const [sym, codes] of symbolToCodes) {
    if (codes.size > 1) ambiguous.add(sym);
  }
  return ambiguous;
}

/**
 * Returns the default ISO currency code for the given locale string.
 * Normalises BCP-47 dashes to underscores before lookup (e.g. 'uk-UA' → 'uk_UA').
 * Returns undefined for unknown locales.
 */
export function localeToCurrency(locale: string): string | undefined {
  const normalised = locale.replace(/-/g, '_');
  return localeMap.get(normalised);
}
