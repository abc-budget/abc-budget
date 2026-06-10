import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import { INITIAL_LANG, persistLang, t } from './i18n';
import type { ChromeKey, Lang } from './i18n';

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue | null>(null);

/** Sets <html lang> — a11y; also done at module init for the first paint. */
function applyHtmlLang(lang: Lang): void {
  document.documentElement.lang = lang;
}
applyHtmlLang(INITIAL_LANG);

export function LangProvider({ initialLang = INITIAL_LANG, children }: { initialLang?: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (next: Lang) => {
    setLangState(next);
    persistLang(next);
    applyHtmlLang(next);
  };
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang requires <LangProvider>');
  return ctx;
}

/** Chrome translation bound to the active language. */
export function useT(): (key: ChromeKey, params?: Record<string, string | number>) => string {
  const { lang } = useLang();
  return (key, params) => t(lang, key, params);
}
