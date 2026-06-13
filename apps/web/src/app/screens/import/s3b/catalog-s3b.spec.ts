/**
 * catalog-s3b.spec.ts — verifies that every S3b chrome key resolves non-empty
 * in both uk and en catalogs, and that parameterized keys work correctly.
 */
import { describe, expect, it } from 'vitest';
import { CATALOG_UK } from '../../../i18n/catalog-uk';
import { CATALOG_EN } from '../../../i18n/catalog-en';
import { t } from '../../../i18n/i18n';

/** All S3b chrome keys (namespaced s3b*). */
const S3B_KEYS = [
  's3bEyebrow',
  's3bStepOf',
  's3bTitle',
  's3bLead',
  's3bRaw',
  's3bTransient',
  's3bRows',
  's3bCols',
  's3bUnknown',
  's3bUnknownShort',
  's3bGuessed',
  's3bGuessedN',
  's3bConfirmed',
  's3bIgnored',
  's3bStatusTitle',
  's3bRecallNote',
  's3bNormTitle',
  's3bNormSub',
  's3bPickType',
  's3bMore',
  's3bConfirm',
  's3bReconfigure',
  's3bUndo',
  's3bBlockTag',
  's3bBlockBody',
  's3bBlockFix',
  's3bCfgStep1',
  's3bCfgStep2',
  's3bCfgFor',
  's3bCfgApply',
  's3bCfgCancel',
  's3bCfgBack',
  's3bCfgPreview',
  's3bWorkerTag',
  's3bWorkerTitle',
  's3bWorkerBody',
  's3bWorkerRows',
  's3bWorkerHint',
  's3bPerrTag',
  's3bPerrWhat',
  's3bPerrWhy',
  's3bPerrDo',
  's3bPerrReview',
  's3bNext',
  's3bBack',
  's3bFoot',
  's3bHelpIntro',
  's3bSelectColHint',
  's3bShowing',
  's3bOfFull',
] as const;


describe('S3b catalog keys', () => {
  it('every s3b* key exists in both uk and en catalogs', () => {
    for (const key of S3B_KEYS) {
      expect(key in CATALOG_UK, `uk missing: ${key}`).toBe(true);
      expect(key in CATALOG_EN, `en missing: ${key}`).toBe(true);
    }
  });

  it('every s3b* key resolves to a non-empty string in uk', () => {
    for (const key of S3B_KEYS) {
      const val = CATALOG_UK[key as keyof typeof CATALOG_UK];
      expect(typeof val, `uk ${key} not a string`).toBe('string');
      expect((val as string).length, `uk ${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('every s3b* key resolves to a non-empty string in en', () => {
    for (const key of S3B_KEYS) {
      const val = CATALOG_EN[key as keyof typeof CATALOG_EN];
      expect(typeof val, `en ${key} not a string`).toBe('string');
      expect((val as string).length, `en ${key} is empty`).toBeGreaterThan(0);
    }
  });

  it('s3bShowing resolves with {n}/{m} params — uk', () => {
    const result = t('uk', 's3bShowing', { n: 5, m: 20 });
    expect(result).toBe('показано 5 з 20');
  });

  it('s3bShowing resolves with {n}/{m} params — en', () => {
    const result = t('en', 's3bShowing', { n: 5, m: 20 });
    expect(result).toBe('showing 5 of 20');
  });

  it('s3bOfFull resolves with {n}/{m} params — uk', () => {
    const result = t('uk', 's3bOfFull', { n: 10, m: 100 });
    expect(result).toBe('10 з 100 у файлі');
  });

  it('s3bOfFull resolves with {n}/{m} params — en', () => {
    const result = t('en', 's3bOfFull', { n: 10, m: 100 });
    expect(result).toBe('10 of 100 in file');
  });
});
