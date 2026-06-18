/**
 * S3c label + condition-text helpers — chrome-only resolution of field names,
 * operator glyphs, and the readable mono token for a condition.  Pure functions
 * over the DTO types + the typed ChromeKey catalog (NO engine import).
 */
import type { ChromeKey } from '../../../i18n/i18n';
import type { ConditionDTO, RuleOperatorId } from '@abc-budget/engine';

type Translate = (key: ChromeKey, params?: Record<string, string | number>) => string;

/** field id → its ChromeKey (chrome strings only; unknown fields fall back to the raw id). */
const FIELD_KEY: Record<string, ChromeKey> = {
  date: 's3cFieldDate',
  amount: 's3cFieldAmount',
  cur: 's3cFieldCur',
  currency: 's3cFieldCur',
  mcc: 's3cFieldMcc',
  category: 's3cFieldCategory',
  bankCategory: 's3cFieldCategory',
  desc: 's3cFieldDesc',
  description: 's3cFieldDesc',
  account: 's3cFieldAccount',
  counterparty: 's3cFieldCounterparty',
};

/**
 * operator wire id → its ChromeKey.  Typed `Record<RuleOperatorId, …>` so it
 * MUST cover every operator the engine grammar can emit (operations.ts) — adding
 * or renaming an operator there fails `tsc` here until a label is supplied. This
 * is the compile-time half of the operator-id class-killer (operator-coverage.spec).
 */
const OP_KEY: Record<RuleOperatorId, ChromeKey> = {
  // NumberOperation
  equals: 's3cOpEq',
  notEquals: 's3cOpNeq',
  greaterThan: 's3cOpGt',
  lessThan: 's3cOpLt',
  greaterThanOrEqual: 's3cOpGte',
  lessThanOrEqual: 's3cOpLte',
  between: 's3cOpBetween',
  // StringOperation
  contains: 's3cOpContains',
  notContains: 's3cOpNcontains',
  startsWith: 's3cOpStarts',
  endsWith: 's3cOpEnds',
  matches: 's3cOpMatches',
  // StringMatchOperation
  oneOf: 's3cOpOneof',
  // BooleanOperation
  isTrue: 's3cOpIsTrue',
  isFalse: 's3cOpIsFalse',
  // DateOperation
  specificDay: 's3cOpSpecificDay',
  dayRange: 's3cOpDayRange',
  firstDayOfMonth: 's3cOpFirstDayOfMonth',
  firstMondayOfMonth: 's3cOpFirstMondayOfMonth',
  firstSaturdayOfMonth: 's3cOpFirstSaturdayOfMonth',
  firstSundayOfMonth: 's3cOpFirstSundayOfMonth',
  lastDayOfMonth: 's3cOpLastDayOfMonth',
  lastMondayOfMonth: 's3cOpLastMondayOfMonth',
  lastSaturdayOfMonth: 's3cOpLastSaturdayOfMonth',
  lastSundayOfMonth: 's3cOpLastSundayOfMonth',
};

/** Every operator id the UI labels — the wire union, single-sourced from OP_KEY. */
export const OPERATOR_IDS = Object.keys(OP_KEY) as RuleOperatorId[];

/**
 * Formats a CategorizedRowDTO ISO date (full-ISO, e.g. `2023-09-30T00:00:00.000Z`)
 * to the design's display format `MM-DD` (zero-padded).  Uses UTC accessors so it
 * matches the UTC-keyed footprint date and never TZ-shifts the day.  This is
 * chrome formatting, NOT content — so it is not i18n'd (HC-6).  Malformed/empty
 * input falls back to the raw string (or '—' when empty).
 */
export function formatOpDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

export function fieldLabel(field: string, t: Translate): string {
  const key = FIELD_KEY[field];
  return key ? t(key) : field;
}

export function operatorLabel(operator: string, t: Translate): string {
  // `operator` is the wire string; a known one resolves via OP_KEY, an unknown
  // one falls back to the raw id (the cast just lets us probe the typed map).
  const key = OP_KEY[operator as RuleOperatorId] as ChromeKey | undefined;
  return key ? t(key) : operator;
}

/** Renders an unknown value as a readable token (arrays → "a–b" or "a, b"). */
function valueToken(value: unknown): string {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((v) => typeof v === 'number')) {
      return `${value[0]}–${value[1]}`;
    }
    return value.join(', ') || '—';
  }
  return String(value);
}

/**
 * The readable mono token for a condition — `[ field op «value» ]`, or
 * `[ field · op ]` when the operator carries no value (date markers etc.).
 * Operation CONTENT (the value) is rendered verbatim — it is user data, not
 * chrome, so it is never translated (HC-6).
 */
export function condText(c: ConditionDTO, t: Translate): string {
  const f = fieldLabel(c.field, t);
  const o = operatorLabel(c.operator, t);
  if (c.value == null || c.value === '') return `[ ${f} · ${o} ]`;
  return `[ ${f} ${o} «${valueToken(c.value)}» ]`;
}
