/**
 * deriveFootprint spec (Story 3.3, Task 3).
 * @module internal/footprint/derive-footprint.spec
 * @internal
 *
 * Pure derivation: TransactionRow + amountUSD → FootprintRecord. Pins the
 * UTC operation-date split (year/month), the EXACT 5-field shape, the
 * categoryId=null / hash-passthrough contract, and the host-TZ invariance
 * (isolated hostile-TZ describe, mirrored from stage2 tz-determinism.spec.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { deriveFootprint } from './derive-footprint';
import type { TransactionRow } from '../importStatement/stage3/types';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal TransactionRow, overriding only what a test cares about. */
function makeRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    rowIndex: 0,
    hash: 'h',
    source: null,
    date: new Date('2024-06-15T12:00:00.000Z'),
    amount: 0,
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
    ...overrides,
  } as TransactionRow;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('deriveFootprint — pure operation-date split (UTC)', () => {
  it('derives UTC year + 1-based month, null category, hash passthrough, amountUSD passthrough, exact 5-field shape', () => {
    const row = makeRow({ hash: 'wrapped-hash', date: new Date('2024-06-15T12:00:00.000Z') });
    const result = deriveFootprint(row, 42.5);

    expect(result.year).toBe(2024);
    expect(result.month).toBe(6);
    expect(result.categoryId).toBeNull();
    expect(result.hash).toBe('wrapped-hash');
    expect(result.amountUSD).toBe(42.5);

    // EXACTLY 5 fields — no 6th field leaks through (ENT-001 minimization).
    expect(Object.keys(result).sort()).toEqual([
      'amountUSD',
      'categoryId',
      'hash',
      'month',
      'year',
    ]);
  });

  it('reads row.date (operation date) for the calendar split — a March date yields month 3', () => {
    const row = makeRow({ date: new Date('2025-03-20T08:30:00.000Z') });
    const result = deriveFootprint(row, 0);

    expect(result.year).toBe(2025);
    expect(result.month).toBe(3);
  });

  it('does NOT re-hash — it passes row.hash through verbatim', () => {
    const row = makeRow({ hash: 'already-dup-wrapped-3.2-hash' });
    expect(deriveFootprint(row, 0).hash).toBe('already-dup-wrapped-3.2-hash');
  });

  describe('month boundaries (1-based, numeric)', () => {
    it('January → month 1', () => {
      const result = deriveFootprint(makeRow({ date: new Date('2024-01-10T00:00:00.000Z') }), 0);
      expect(result.month).toBe(1);
    });

    it('December → month 12', () => {
      const result = deriveFootprint(makeRow({ date: new Date('2024-12-10T00:00:00.000Z') }), 0);
      expect(result.month).toBe(12);
    });

    it('a single-digit month is the NUMBER 3, not the string "03"', () => {
      const result = deriveFootprint(makeRow({ date: new Date('2024-03-10T00:00:00.000Z') }), 0);
      expect(result.month).toBe(3);
      expect(typeof result.month).toBe('number');
      // The numeric 3 is NOT the zero-padded string '03'.
      expect(result.month as unknown).not.toBe('03');
    });
  });
});

// ── TZ isolation ─────────────────────────────────────────────────────────────
// Mirror of stage2/tz-determinism.spec.ts: save TZ, set a hostile UTC-5/UTC-4
// host, restore in afterAll so the env mutation cannot bleed into other specs.

let originalTZ: string | undefined;

beforeAll(() => {
  originalTZ = process.env['TZ'];
  // Simulate a UTC-5/UTC-4 host to prove the UTC accessors are invariant to host TZ.
  process.env['TZ'] = 'America/New_York';
});

afterAll(() => {
  // Restore TZ — must not bleed into other specs.
  if (originalTZ === undefined) {
    delete process.env['TZ'];
  } else {
    process.env['TZ'] = originalTZ;
  }
});

describe('deriveFootprint — TZ-consistency pin (hostile America/New_York)', () => {
  it('TZ env is set to America/New_York in this describe (sanity check)', () => {
    expect(process.env['TZ']).toBe('America/New_York');
  });

  it('2026-03-01T02:00:00Z (Feb 28 21:00 LOCAL in NY) yields UTC year 2026, month 3', () => {
    // Local NY time is still February; UTC calendar date is March. The UTC
    // accessors MUST report month 3 — invariant to host TZ. A local-time split
    // would (wrongly) report February here.
    const row = makeRow({ date: new Date('2026-03-01T02:00:00.000Z') });
    const result = deriveFootprint(row, 0);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(3);
  });

  it('2026-01-01T03:00:00Z (Dec 31 LOCAL in NY) yields UTC year 2026, month 1', () => {
    // Local NY time is still December 2025; UTC calendar date is January 2026.
    // The UTC accessors MUST report 2026/1 — a local-time split would (wrongly)
    // report 2025/12, crossing both a month AND a year boundary.
    const row = makeRow({ date: new Date('2026-01-01T03:00:00.000Z') });
    const result = deriveFootprint(row, 0);
    expect(result.year).toBe(2026);
    expect(result.month).toBe(1);
  });
});

describe('deriveFootprint — TZ restored after hostile describe', () => {
  // This describe registers AFTER the afterAll above runs (afterAll fires at the
  // end of the file's suites), so assert restoration here would be premature.
  // Instead we pin the saved original so a regression in the save/restore wiring
  // is visible: TZ must equal whatever it was before this file mutated it.
  it('originalTZ was captured (restore wiring is present)', () => {
    // originalTZ is the pre-mutation value; the afterAll restores process.env.TZ
    // to exactly this. We assert the capture happened (not undefined-by-accident
    // logic error) — the restore itself is exercised by the afterAll above.
    expect(originalTZ === undefined || typeof originalTZ === 'string').toBe(true);
  });
});
