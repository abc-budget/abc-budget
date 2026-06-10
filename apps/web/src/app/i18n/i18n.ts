import { CATALOG_UK } from './catalog-uk';
import type { ChromeKey } from './catalog-uk';
import { CATALOG_EN } from './catalog-en';

export type Lang = 'uk' | 'en';
export const LANG_STORAGE_KEY = 'abc.lang.v1';

/** Saved override > navigator.language (uk* → uk) > en. Ported from prototype detectLang. */
export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved === 'uk' || saved === 'en') return saved;
  } catch {
    // storage unavailable (private mode etc.) — fall through to locale
  }
  return (navigator.language || 'en').toLowerCase().startsWith('uk') ? 'uk' : 'en';
}

export function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // non-fatal: the override just won't survive the reload
  }
}

/**
 * Computed at MODULE LOAD — main.tsx's import graph runs this before createRoot,
 * so the first render is already in the right language (no flash; spec §2).
 */
export const INITIAL_LANG: Lang = detectLang();

const CATALOGS: Record<Lang, Record<ChromeKey, string>> = { uk: CATALOG_UK, en: CATALOG_EN };

/** Chrome-only translation: `key` is structurally a catalog key — user strings can't compile. */
export function t(lang: Lang, key: ChromeKey, params?: Record<string, string | number>): string {
  let out: string = CATALOGS[lang][key];
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

export type { ChromeKey };
