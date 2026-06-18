/**
 * operator-coverage.spec.ts — the CLASS-KILLER for operator-id drift.
 *
 * The S3c UI labels each rule operator by its WIRE id (the engine's
 * `RuleOperation['type']`, operations.ts). 4.9a shipped OP_KEY keyed by SHORT
 * prototype ids (eq/gt/oneof) → every long wire id (equals/greaterThan/oneOf)
 * leaked raw. This test enumerates the FULL wire operator union and asserts
 * EVERY operator resolves to a non-empty label in BOTH locales — so a new or
 * renamed engine operator fails here instead of silently leaking. Its
 * compile-time twin is `OP_KEY: Record<RuleOperatorId, ChromeKey>` (labels.ts),
 * which fails `tsc` the moment the engine union changes.
 */
import { describe, expect, it } from 'vitest';
import { t } from '../../../i18n/i18n';
import type { ChromeKey } from '../../../i18n/i18n';
import { OPERATOR_IDS, operatorLabel } from './labels';

/**
 * The complete wire operator union — the human mirror of operations.ts
 * `RuleOperation['type']` (DateOperation | NumberOperation | StringOperation |
 * BooleanOperation | StringMatchOperation). Kept honest by the set-equality test
 * below (OPERATOR_IDS is type-enforced against the engine union).
 */
const WIRE_OPERATORS = [
  // NumberOperation
  'equals', 'notEquals', 'greaterThan', 'lessThan', 'greaterThanOrEqual', 'lessThanOrEqual', 'between',
  // StringOperation (equals/notEquals shared)
  'contains', 'notContains', 'startsWith', 'endsWith', 'matches',
  // StringMatchOperation (equals/notEquals shared)
  'oneOf',
  // BooleanOperation
  'isTrue', 'isFalse',
  // DateOperation
  'specificDay', 'dayRange',
  'firstDayOfMonth', 'firstMondayOfMonth', 'firstSaturdayOfMonth', 'firstSundayOfMonth',
  'lastDayOfMonth', 'lastMondayOfMonth', 'lastSaturdayOfMonth', 'lastSundayOfMonth',
] as const;

const tUk = (k: ChromeKey, p?: Record<string, string | number>) => t('uk', k, p);
const tEn = (k: ChromeKey, p?: Record<string, string | number>) => t('en', k, p);

describe('operator label coverage (class-killer: every wire operator localizes)', () => {
  it('OP_KEY covers EXACTLY the wire operator union (operations.ts) — no drift', () => {
    expect(new Set(OPERATOR_IDS)).toEqual(new Set<string>(WIRE_OPERATORS));
  });

  it('every wire operator resolves via the map (no raw fallback) + non-empty uk & en labels', () => {
    for (const op of WIRE_OPERATORS) {
      expect(OPERATOR_IDS, `'${op}' missing from OP_KEY → would leak raw`).toContain(op);
      expect(operatorLabel(op, tUk).length, `uk label for '${op}'`).toBeGreaterThan(0);
      expect(operatorLabel(op, tEn).length, `en label for '${op}'`).toBeGreaterThan(0);
    }
  });
});
