/**
 * S3b help-doc embedding — vendored markdown, loaded at build time via Vite ?raw.
 *
 * PROVENANCE: sources vendored from `requirements/deliverables/column-type-help/`.
 * Re-sync from that authoring origin on change.
 * NFR-005: abc-budget Core must build standalone (public OSS). Nothing in apps/ or
 * packages/ may build-depend on `requirements/`. The 30 .md files are copied here
 * as the canonical build source. The requirements/ directory is NEVER imported.
 */

// import.meta.glob is resolved at build time by Vite; each value is a raw string
// (the .md file content). The `eager: true` option avoids dynamic-import laziness —
// all 30 docs land in the main chunk (small text, ~40 KB total) which is correct for
// an inline help panel that the user opens immediately after the page loads.
const rawFiles = import.meta.glob('./help/*.md', { query: '?raw', eager: true }) as Record<
  string,
  { default: string }
>;

/**
 * The 14 column-type help stems + `info`.
 * Stems match the filename stems in ./help/*.{uk,en}.md.
 * They differ from engine ColumnDefinition strings where the engine uses underscores
 * and the files use hyphens: bank-account, merchant-category, exchange-rate,
 * bank-commission. See `DEFINITION_TO_HELP_KEY` below.
 */
export type HelpKey =
  | 'amount'
  | 'balance'
  | 'bank-account'
  | 'bank-commission'
  | 'cashback'
  | 'category'
  | 'counterparty'
  | 'currency'
  | 'date'
  | 'description'
  | 'exchange-rate'
  | 'info'
  | 'merchant-category'
  | 'status'
  | 'time';

function getText(stem: HelpKey, lang: 'uk' | 'en'): string {
  const key = `./help/${stem}.${lang}.md`;
  const mod = rawFiles[key];
  if (!mod) throw new Error(`[help-docs] missing vendored file: ${key}`);
  return mod.default;
}

/**
 * All 15 (14 types + info) help entries, each with uk + en raw markdown strings.
 * Built eagerly at module load time — no async required.
 */
export const HELP_DOCS: Record<HelpKey, { uk: string; en: string }> = {
  amount:           { uk: getText('amount', 'uk'),           en: getText('amount', 'en') },
  balance:          { uk: getText('balance', 'uk'),          en: getText('balance', 'en') },
  'bank-account':   { uk: getText('bank-account', 'uk'),     en: getText('bank-account', 'en') },
  'bank-commission':{ uk: getText('bank-commission', 'uk'),  en: getText('bank-commission', 'en') },
  cashback:         { uk: getText('cashback', 'uk'),         en: getText('cashback', 'en') },
  category:         { uk: getText('category', 'uk'),         en: getText('category', 'en') },
  counterparty:     { uk: getText('counterparty', 'uk'),     en: getText('counterparty', 'en') },
  currency:         { uk: getText('currency', 'uk'),         en: getText('currency', 'en') },
  date:             { uk: getText('date', 'uk'),             en: getText('date', 'en') },
  description:      { uk: getText('description', 'uk'),      en: getText('description', 'en') },
  'exchange-rate':  { uk: getText('exchange-rate', 'uk'),    en: getText('exchange-rate', 'en') },
  info:             { uk: getText('info', 'uk'),             en: getText('info', 'en') },
  'merchant-category': { uk: getText('merchant-category', 'uk'), en: getText('merchant-category', 'en') },
  status:           { uk: getText('status', 'uk'),           en: getText('status', 'en') },
  time:             { uk: getText('time', 'uk'),             en: getText('time', 'en') },
};

/**
 * Maps engine ColumnDefinition strings → HelpKey.
 *
 * Engine uses snake_case (bank_account, merchant_category, exchange_rate,
 * bank_commission). Help stems use kebab-case (bank-account, etc.).
 * Definitions with no help doc (ignore, unknown) map to null.
 *
 * Source of truth for definition strings:
 *   packages/engine/src/internal/importStatement/types.ts :: ColumnDefinition
 * (not imported here — NFR-003 fence).
 */
const DEFINITION_TO_HELP_KEY: Record<string, HelpKey | null> = {
  date:              'date',
  amount:            'amount',
  description:       'description',
  currency:          'currency',
  balance:           'balance',
  bank_account:      'bank-account',
  status:            'status',
  merchant_category: 'merchant-category',
  category:          'category',
  exchange_rate:     'exchange-rate',
  bank_commission:   'bank-commission',
  cashback:          'cashback',
  time:              'time',
  counterparty:      'counterparty',
  // no help doc for these:
  ignore:            null,
  unknown:           null,
};

/**
 * Returns the raw markdown help string for a given engine definition + language,
 * or `null` if the definition has no help doc (ignore, unknown) or is unrecognized.
 */
export function helpFor(definition: string, lang: 'uk' | 'en'): string | null {
  const key = DEFINITION_TO_HELP_KEY[definition];
  if (key === undefined || key === null) return null;
  return HELP_DOCS[key][lang];
}
