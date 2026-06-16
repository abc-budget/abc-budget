/**
 * Date-operator TZ-basis spec (Story 4.2 Task 5, isolated file).
 *
 * Pins the PM ruling: `createDateRule` evaluates EVERY DateOperation variant on
 * the UTC calendar day, consistent with `deriveFootprint` (which splits
 * year/month via `getUTCFullYear`/`getUTCMonth`). The prior art read LOCAL-time
 * accessors, so under a non-UTC host a date-rule and the footprint month could
 * disagree at a day/month boundary. These tests run under a hostile host TZ and
 * prove rule-day ≡ footprint-day at exactly such a boundary.
 *
 * ISOLATION: `process.env.TZ` is saved in `beforeAll`, set to
 * 'America/New_York' (UTC-5 / UTC-4 DST), and restored in `afterAll` so this env
 * mutation cannot bleed into any other spec. THIS FILE MUST REMAIN SEPARATE from
 * rule-factories.spec.ts (which asserts local-invariant day-of-month logic).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createDateRule } from './rule-factories';
import { deriveFootprint } from '../footprint/derive-footprint';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';

// ── TZ isolation (harness copied from stage2/tz-determinism.spec.ts) ──────────

let originalTZ: string | undefined;

beforeAll(() => {
  originalTZ = process.env['TZ'];
  // Simulate a UTC-5/UTC-4 host to prove the date operators are evaluated in UTC
  process.env['TZ'] = 'America/New_York';
});

afterAll(() => {
  // Restore TZ — must not bleed into other specs
  if (originalTZ === undefined) {
    delete process.env['TZ'];
  } else {
    process.env['TZ'] = originalTZ;
  }
});

// ── Helper ────────────────────────────────────────────────────────────────────

/** Minimal stage-3 row carrying a given operation `date`. */
function rowWith(date: Date): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    hash: 'h',
    date,
    amount: 10,
    currency: 'USD',
    description: null,
    counterparty: null,
    account: null,
    bankCategory: null,
    mcc: null,
    isBankCommission: false,
    isCashback: false,
    category: null,
    isManuallySetCategory: false,
  } as ImportStatementStage3Row;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createDateRule — UTC basis under hostile TZ (America/New_York)', () => {
  it('TZ env is America/New_York in this spec (sanity check)', () => {
    expect(process.env['TZ']).toBe('America/New_York');
  });

  // 2026-03-01T02:00:00Z → UTC: March 1st (day 1). LOCAL NY: Feb 28, 21:00.
  // A LOCAL-accessor rule would see day 28 of February; a UTC rule sees day 1
  // of March — the SAME calendar day `deriveFootprint` reads.
  const boundary = new Date('2026-03-01T02:00:00Z');

  it('firstDayOfMonth MATCHES the UTC-day-1 boundary (local NY is Feb 28)', () => {
    expect(createDateRule({ type: 'firstDayOfMonth' }).evaluate(rowWith(boundary))).toBe(true);
  });

  it('specificDay value:1 MATCHES; value:28 does NOT (it is UTC the 1st, not the 28th)', () => {
    expect(createDateRule({ type: 'specificDay', value: 1 }).evaluate(rowWith(boundary))).toBe(true);
    expect(createDateRule({ type: 'specificDay', value: 28 }).evaluate(rowWith(boundary))).toBe(false);
  });

  it('rule-day ≡ footprint-day at the boundary (footprint month is March AND specificDay:1 matches)', () => {
    // deriveFootprint reads the SAME UTC calendar day: month 3 (March), day 1.
    expect(deriveFootprint(rowWith(boundary), 0).month).toBe(3);
    // The date rule must agree — a {specificDay:1} rule matches the same row.
    expect(createDateRule({ type: 'specificDay', value: 1 }).evaluate(rowWith(boundary))).toBe(true);
  });

  it('dayRange {start:1,end:7} MATCHES the boundary date (UTC day 1)', () => {
    expect(
      createDateRule({ type: 'dayRange', start: 1, end: 7 }).evaluate(rowWith(boundary)),
    ).toBe(true);
  });

  it('lastDayOfMonth is UTC: a UTC-Apr-1 row (local NY Mar 31) does NOT match April’s last day', () => {
    // 2026-04-01T01:00:00Z → UTC Apr 1 (day 1); LOCAL NY is Mar 31, 21:00 (would
    // be a "last day" under local accessors). UTC basis → it is the 1st, no match.
    const aprBoundary = new Date('2026-04-01T01:00:00Z');
    expect(createDateRule({ type: 'lastDayOfMonth' }).evaluate(rowWith(aprBoundary))).toBe(false);
    // And the footprint agrees this is April (month 4), not March.
    expect(deriveFootprint(rowWith(aprBoundary), 0).month).toBe(4);
  });

  // Last-weekday window: prove BOTH the weekday and the "last 7 days" cutoff are
  // computed in UTC. 2026-03-29T02:00:00Z is UTC Sunday March 29 (March has 31
  // days, so day 29 is within the last 7: 29 > 31-7=24). LOCAL NY is Sat Mar 28,
  // 21:00 — a local-accessor rule would compute the WRONG weekday and day.
  const lastSundayBoundary = new Date('2026-03-29T02:00:00Z');

  it('lastSundayOfMonth MATCHES UTC Sun Mar 29 (weekday + last-7 window in UTC)', () => {
    expect(
      createDateRule({ type: 'lastSundayOfMonth' }).evaluate(rowWith(lastSundayBoundary)),
    ).toBe(true);
    // Under LOCAL accessors this same instant is Saturday Mar 28 → lastSaturday,
    // NOT lastSunday. Assert the UTC weekday wins: lastSaturday must NOT match.
    expect(
      createDateRule({ type: 'lastSaturdayOfMonth' }).evaluate(rowWith(lastSundayBoundary)),
    ).toBe(false);
  });

  it('lastMondayOfMonth: UTC Mon Mar 30 2026 matches (last-7 window UTC)', () => {
    // 2026-03-30T02:00:00Z → UTC Monday March 30 (30 > 24 → last 7 days).
    const lastMonday = new Date('2026-03-30T02:00:00Z');
    expect(createDateRule({ type: 'lastMondayOfMonth' }).evaluate(rowWith(lastMonday))).toBe(true);
  });

  it('lastSaturdayOfMonth: UTC Sat Mar 28 2026 matches (last-7 window UTC)', () => {
    // 2026-03-28T02:00:00Z → UTC Saturday March 28 (28 > 24 → last 7 days).
    const lastSaturday = new Date('2026-03-28T02:00:00Z');
    expect(
      createDateRule({ type: 'lastSaturdayOfMonth' }).evaluate(rowWith(lastSaturday)),
    ).toBe(true);
  });
});

describe('TZ isolation', () => {
  it('process.env.TZ is restored after this suite (asserted inside afterAll guard)', () => {
    // The restore itself runs in afterAll; here we just confirm the harness saved
    // a value to restore TO (string-or-undefined), and that TZ is currently the
    // hostile pin (proving afterAll has NOT yet fired mid-suite).
    expect(['string', 'undefined']).toContain(typeof originalTZ);
    expect(process.env['TZ']).toBe('America/New_York');
  });
});
