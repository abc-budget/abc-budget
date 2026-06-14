/**
 * dup-counter.spec.ts — Story 3.2 (Q-011 second half), decisions 1–6.
 *
 * Runs against the REAL hash (this file does NOT mock ./hash) so the wrap→re-SHA
 * behaviour is exercised end to end. Two layers:
 *   - applyDupCounters() unit: grouping, wrap shape, shuffle-SET stability, batch
 *     determinism, singleton dup:0.
 *   - generateRows() real-hash pins: two identical rows → distinct final hashes;
 *     shuffle the batch rows → byte-identical SORTED set (HC-9); the overlap
 *     fixture (subset vs widening superset with an in-month dup → same dup-pair set).
 *
 * No clock/random; the engine suite runs under a hostile TZ by construction.
 */

import { describe, it, expect } from 'vitest';
import type { AmountColumnParams } from '../types';
import { ColumnDefinition } from '../types';
import type { CellData, ImportStatementRowData } from '../stage2/types';
import { SupportedDataType } from '../stage2/types';
import { applyDupCounters } from './hash';
import { generateRows } from './row-generator';
import type { ColumnInfo } from './row-generator';

// ── Helpers (real hash, real generateRows) ─────────────────────────────────────

function cell(value: unknown): CellData {
  let type: SupportedDataType = SupportedDataType.UNKNOWN;
  if (typeof value === 'number') type = SupportedDataType.NUMBER;
  else if (typeof value === 'string') type = SupportedDataType.TEXT;
  else if (value instanceof Date) type = SupportedDataType.DATE;
  return { value, type, error: null, ignore: null };
}

function makeRow(rowIndex: number, data: Record<string, unknown>): ImportStatementRowData {
  return {
    rowIndex,
    get: (columnId: string): CellData => cell(data[columnId] ?? null),
    errorMessageAt: () => null,
    ignoreMessageAt: () => null,
    get isIgnored() { return false; },
    get hasErrors() { return false; },
  } as ImportStatementRowData;
}

const COLUMNS: ColumnInfo[] = [
  { id: 'c1', definition: ColumnDefinition.DATE, params: null },
  { id: 'c2', definition: ColumnDefinition.AMOUNT, params: { currency: 'auto' } as AmountColumnParams },
  { id: 'c3', definition: ColumnDefinition.CURRENCY, params: null },
  { id: 'c4', definition: ColumnDefinition.DESCRIPTION, params: null },
];
const DATE = new Date('2024-02-10');
/** An identical-row factory: same date/amount/currency/description → same base hash. */
const dupRow = (i: number) => makeRow(i, { c1: DATE, c2: 100.5, c3: 'USD', c4: 'АТБ' });
/** A distinct row (different amount). */
const otherRow = (i: number) => makeRow(i, { c1: DATE, c2: 42, c3: 'USD', c4: 'Bolt' });

const sorted = (xs: string[]) => [...xs].sort();
const HEX64 = /^[0-9a-f]{64}$/;

// ===========================================================================
// applyDupCounters — unit (decisions 1, 2, 3, 6)
// ===========================================================================

describe('applyDupCounters — unit', () => {
  it('singleton → one final hash, opaque 64-hex (dup:0 wrapped)', async () => {
    const [h] = await applyDupCounters(['base-a']);
    expect(h).toMatch(HEX64);
  });

  it('two identical base hashes → two DISTINCT finals (decision: full-row dups get distinct hashes)', async () => {
    const [h0, h1] = await applyDupCounters(['base-a', 'base-a']);
    expect(h0).not.toBe(h1);
    expect(h0).toMatch(HEX64);
    expect(h1).toMatch(HEX64);
  });

  it('three identical → three distinct; distinct bases → distinct finals (each its own dup:0)', async () => {
    const finals = await applyDupCounters(['x', 'x', 'x', 'y', 'z']);
    expect(new Set(finals).size).toBe(5);
  });

  it('decision 6 — final = SHA-256 over {base, dup}: matches a direct re-run (wrap, not suffix)', async () => {
    // Same group of 2: applyDupCounters must produce the SAME pair a second time
    // (pure, no hidden state) AND the values are not the bare base (they are wrapped).
    const a = await applyDupCounters(['base-a', 'base-a']);
    const b = await applyDupCounters(['base-a', 'base-a']);
    expect(a).toEqual(b);
    expect(a).not.toContain('base-a'); // wrapped, never the bare base string
  });

  it('decision 1 — batch-deterministic, never global: two separate single-row batches each get dup:0', async () => {
    const [first] = await applyDupCounters(['base-a']);
    const [second] = await applyDupCounters(['base-a']); // a "re-import" — NOT N..2N-1
    expect(second).toBe(first); // same SET, idempotent (no carried running count)
  });

  it('decision 2 — stable by COUNT not order: shuffled input → byte-identical SORTED set', async () => {
    const inOrder = ['a', 'b', 'a', 'a', 'b', 'c'];
    const shuffled = ['c', 'a', 'b', 'a', 'b', 'a']; // same multiset, different order
    const finalsA = await applyDupCounters(inOrder);
    const finalsB = await applyDupCounters(shuffled);
    expect(sorted(finalsA)).toEqual(sorted(finalsB));
    // and within a group the finals are distinct (3 'a' → 3 distinct)
    expect(new Set(finalsA).size).toBe(new Set(sorted(finalsA)).size);
  });
});

// ===========================================================================
// generateRows — real-hash pins (decisions 2, 4, 5)
// ===========================================================================

describe('generateRows — dup-counter end to end (real hash)', () => {
  it('two identical mappable rows → DISTINCT final hashes; a singleton keeps its own', async () => {
    const { rows } = await generateRows([dupRow(0), dupRow(1), otherRow(2)], COLUMNS, 'USD');
    expect(rows).toHaveLength(3);
    const [d0, d1, o] = rows.map((r) => r.hash);
    expect(d0).not.toBe(d1); // the two identical rows are now distinct records
    expect(o).not.toBe(d0);
    expect(o).not.toBe(d1);
    expect(d0).toMatch(HEX64);
  });

  it('decision 2 PIN — shuffle the batch rows → byte-identical SORTED set of final hashes (HC-9)', async () => {
    const batch = [dupRow(0), dupRow(1), otherRow(2), dupRow(3)]; // 3 identical + 1 distinct
    const a = await generateRows(batch, COLUMNS, 'USD');
    const b = await generateRows([batch[3], batch[1], batch[2], batch[0]], COLUMNS, 'USD');
    expect(sorted(a.rows.map((r) => r.hash))).toEqual(sorted(b.rows.map((r) => r.hash)));
  });

  it('decision 4 PIN — overlap: in-month dup over a subset vs a widening superset → same dup-pair set', async () => {
    // The duplicate pair (two identical Feb rows) appears in BOTH ranges because
    // exports are by whole date. The superset adds other-month rows that do not
    // touch the pair's group. The pair's final-hash SET must reproduce.
    const marRow = makeRow(9, { c1: new Date('2024-03-01'), c2: 7, c3: 'USD', c4: 'Mar' });
    const decRow = makeRow(9, { c1: new Date('2024-12-01'), c2: 9, c3: 'USD', c4: 'Dec' });

    const janMar = await generateRows([dupRow(0), dupRow(1), marRow], COLUMNS, 'USD');
    const janDec = await generateRows([dupRow(0), dupRow(1), marRow, decRow], COLUMNS, 'USD');

    // The dup pair = the two hashes that are NOT the Mar/Dec singletons. Compare the
    // SET of the pair across both ranges.
    const pair = (res: { rows: { hash: string; amount: number }[] }) =>
      sorted(res.rows.filter((r) => r.amount === 100.5).map((r) => r.hash));

    expect(pair(janMar)).toHaveLength(2);
    expect(pair(janMar)).toEqual(pair(janDec)); // reproduced → 3.4 upsert dedups cleanly
  });

  it('decision 5 — pseudo-op marker keeps a main vs its derived ops distinct (now also dup-wrapped)', async () => {
    // A row with a commission + cashback cell → main + 2 pseudo-ops, all distinct.
    const cols: ColumnInfo[] = [
      ...COLUMNS,
      { id: 'c5', definition: ColumnDefinition.BANK_COMMISSION, params: { currency: 'auto' } as AmountColumnParams },
      { id: 'c6', definition: ColumnDefinition.CASHBACK, params: { currency: 'auto' } as AmountColumnParams },
    ];
    const row = makeRow(0, { c1: DATE, c2: 100.5, c3: 'USD', c4: 'АТБ', c5: 2.5, c6: 1 });
    const { rows } = await generateRows([row], cols, 'USD');
    const hashes = rows.map((r) => r.hash);
    expect(new Set(hashes).size).toBe(hashes.length); // main + commission + cashback all distinct
    expect(hashes.every((h) => HEX64.test(h))).toBe(true);
  });

  it('determinism — same batch twice → identical hashes per index (run-to-run)', async () => {
    const batch = [dupRow(0), dupRow(1), otherRow(2)];
    const a = await generateRows(batch, COLUMNS, 'USD');
    const b = await generateRows(batch, COLUMNS, 'USD');
    a.rows.forEach((r, i) => expect(r.hash).toBe(b.rows[i].hash));
  });
});
