/**
 * Persistent UK/EN toggle (FEAT-028) — markup verbatim from the prototype LangToggle.
 * Presentational: props only (the app layer owns persistence/context and passes the
 * localized screen-reader `label` — chrome strings never live inside altus).
 */
export function LangToggle({
  lang,
  onChange,
  label = 'UI language',
}: {
  lang: 'uk' | 'en';
  onChange: (lang: 'uk' | 'en') => void;
  label?: string;
}) {
  return (
    <div className="langtog" role="group" aria-label={label}>
      <svg className="globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12 H21 M12 3 C15 6 15 18 12 21 C9 18 9 6 12 3" />
      </svg>
      <button type="button" className={lang === 'uk' ? 'langbtn on' : 'langbtn'} onClick={() => onChange('uk')} aria-pressed={lang === 'uk'}>UK</button>
      <button type="button" className={lang === 'en' ? 'langbtn on' : 'langbtn'} onClick={() => onChange('en')} aria-pressed={lang === 'en'}>EN</button>
    </div>
  );
}
