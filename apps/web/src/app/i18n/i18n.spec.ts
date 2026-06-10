import { afterEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_UK } from './catalog-uk';
import { CATALOG_EN } from './catalog-en';
import { detectLang, persistLang, t, LANG_STORAGE_KEY } from './i18n';

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

const stubLocale = (language: string) =>
  vi.stubGlobal('navigator', { ...navigator, language });

describe('detectLang — saved > locale > en fallback (FEAT-028)', () => {
  it('uk-UA locale → uk', () => {
    stubLocale('uk-UA');
    expect(detectLang()).toBe('uk');
  });
  it('en-GB locale → en', () => {
    stubLocale('en-GB');
    expect(detectLang()).toBe('en');
  });
  it('unsupported locale (de-DE) → en fallback', () => {
    stubLocale('de-DE');
    expect(detectLang()).toBe('en');
  });
  it('saved override beats the locale', () => {
    stubLocale('uk-UA');
    persistLang('en');
    expect(detectLang()).toBe('en');
  });
  it('invalid saved value is ignored (falls back to locale)', () => {
    stubLocale('uk-UA');
    localStorage.setItem(LANG_STORAGE_KEY, 'xx');
    expect(detectLang()).toBe('uk');
  });
  it('persistLang round-trips through storage', () => {
    persistLang('uk');
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe('uk');
  });
});

describe('catalog parity', () => {
  it('uk and en have identical key sets (runtime belt to the compile-time braces)', () => {
    expect(Object.keys(CATALOG_EN).sort()).toEqual(Object.keys(CATALOG_UK).sort());
  });
  it('no empty strings in either catalog', () => {
    for (const cat of [CATALOG_UK, CATALOG_EN]) {
      for (const [k, v] of Object.entries(cat)) expect(v.length, k).toBeGreaterThan(0);
    }
  });
});

describe('t()', () => {
  it('resolves per language', () => {
    expect(t('uk', 'zoneDashboard')).toBe('Дашборд');
    expect(t('en', 'zoneDashboard')).toBe('Dashboard');
  });
  it('interpolates {params}', () => {
    expect(t('uk', 'stepOfTotal', { n: 2, total: 4 })).toBe('КРОК 2 / 4');
    expect(t('en', 'stepOfTotal', { n: 2, total: 4 })).toBe('STEP 2 / 4');
  });
  it('structurally rejects non-catalog keys (compile-time)', () => {
    // @ts-expect-error user/dynamic strings must not be translatable (HC-6/VIS-003)
    t('uk', 'user typed this');
  });
});
