/**
 * catalog-s3c.spec.ts — every S3c chrome key resolves non-empty in both uk and
 * en (uk + en parity), and the parameterized keys interpolate correctly.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG_UK } from '../../../i18n/catalog-uk';
import { CATALOG_EN } from '../../../i18n/catalog-en';
import { t } from '../../../i18n/i18n';
import type { ChromeKey } from '../../../i18n/i18n';

const S3C_KEYS = (Object.keys(CATALOG_UK) as ChromeKey[]).filter((k) => k.startsWith('s3c'));

describe('S3c catalog keys', () => {
  it('there is a non-trivial set of s3c* keys', () => {
    expect(S3C_KEYS.length).toBeGreaterThan(40);
  });

  it('every s3c* key resolves to a non-empty string in BOTH uk and en (parity)', () => {
    for (const key of S3C_KEYS) {
      const uk = CATALOG_UK[key];
      const en = CATALOG_EN[key];
      expect(typeof uk, `uk ${key} not a string`).toBe('string');
      expect(typeof en, `en ${key} not a string`).toBe('string');
      expect(uk.length, `uk ${key} empty`).toBeGreaterThan(0);
      expect(en.length, `en ${key} empty`).toBeGreaterThan(0);
    }
  });

  it('parameterized keys interpolate {n}/{m}/{q}', () => {
    expect(t('uk', 's3cOpsTotal', { n: 12 })).toBe('12 оп.');
    expect(t('en', 's3cOpsTotal', { n: 12 })).toBe('12 ops');
    expect(t('uk', 's3cPageOf', { n: 1, m: 4 })).toBe('1 / 4');
    expect(t('uk', 's3cLiveMatch', { n: 9 })).toBe('9 збігів у списку');
    expect(t('en', 's3cLiveMatch', { n: 9 })).toBe('9 matches in list');
    expect(t('uk', 's3cCreateNamed', { q: 'Аптека' })).toBe('Створити «Аптека»');
    expect(t('en', 's3cCreateNamed', { q: 'Pharmacy' })).toBe('Create “Pharmacy”');
  });
});
