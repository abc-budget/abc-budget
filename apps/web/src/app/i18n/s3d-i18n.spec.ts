import { describe, it, expect } from 'vitest';
import { t } from './i18n';

describe('s3d catalog', () => {
  it('privacy note tells the honest FULL-DATE truth (decision 1) — not MONTH·YEAR', () => {
    expect(t('uk', 's3dPrivacyNote')).toContain('ПОВНА ДАТА');
    expect(t('uk', 's3dPrivacyNote')).not.toContain('МІСЯЦЬ');
    expect(t('en', 's3dPrivacyNote')).toContain('FULL DATE');
    expect(t('en', 's3dPrivacyNote')).not.toContain('MONTH');
  });

  it('parameterized strings interpolate {n}/{m}', () => {
    expect(t('en', 's3dSaveCount', { n: 12 })).toBe('Save 12 operations');
    expect(t('uk', 's3dShowing', { n: 14, m: 78 })).toBe('показано 14 з 78');
  });
});
