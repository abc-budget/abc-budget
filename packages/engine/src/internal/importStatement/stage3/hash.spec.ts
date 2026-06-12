/**
 * Row-hash tests — Story 2.3 QA FINDING-1 pin (ENT-009) + Story 2.5 Q-011 pin (decision 2).
 *
 * COUNTERPARTY is identifying data and must participate in the row hash like
 * description (2.3). Q-011 (2.5): the pseudo-op discriminator ('main' | 'commission' |
 * 'cashback') also enters the canonical hash — one source row must yield THREE pairwise-
 * distinct hashes across the three discriminator values.
 *
 * These tests run against the REAL hash implementation (the row-generator spec mocks
 * ./hash entirely, so the pins live here).
 */

import { describe, it, expect } from 'vitest';
import type { CellData, ImportStatementRowData } from '../stage2/types';
import { SupportedDataType } from '../stage2/types';
import { ColumnDefinition } from '../types';
import { calculateRowHash, generateHashableObject } from './hash';

function makeRow(cellData: Record<string, unknown>): ImportStatementRowData {
  return {
    rowIndex: 0,
    get: (columnId: string): CellData => ({
      value: cellData[columnId] ?? null,
      type: SupportedDataType.TEXT,
      error: null,
      ignore: null,
    }),
    errorMessageAt: () => null,
    ignoreMessageAt: () => null,
    get isIgnored() {
      return false;
    },
    get hasErrors() {
      return false;
    },
  } as ImportStatementRowData;
}

const COLUMNS = [
  { id: 'c-date', definition: ColumnDefinition.DATE },
  { id: 'c-amount', definition: ColumnDefinition.AMOUNT },
  { id: 'c-desc', definition: ColumnDefinition.DESCRIPTION },
  { id: 'c-cp', definition: ColumnDefinition.COUNTERPARTY },
];

const BASE_CELLS = {
  'c-date': new Date('2024-01-15T00:00:00Z'),
  'c-amount': 42.5,
  'c-desc': 'Coffee',
};

describe('calculateRowHash — COUNTERPARTY participates (ENT-009)', () => {
  it('two rows differing ONLY by counterparty hash differently', async () => {
    const rowA = makeRow({ ...BASE_CELLS, 'c-cp': 'Cafe Alpha' });
    const rowB = makeRow({ ...BASE_CELLS, 'c-cp': 'Cafe Beta' });

    const hashA = await calculateRowHash(rowA, COLUMNS);
    const hashB = await calculateRowHash(rowB, COLUMNS);

    expect(hashA).not.toBe(hashB);
  });

  it('identical rows (counterparty included) hash identically', async () => {
    const rowA = makeRow({ ...BASE_CELLS, 'c-cp': 'Cafe Alpha' });
    const rowB = makeRow({ ...BASE_CELLS, 'c-cp': 'Cafe Alpha' });

    expect(await calculateRowHash(rowA, COLUMNS)).toBe(
      await calculateRowHash(rowB, COLUMNS)
    );
  });

  it('hashable object carries a COUNTERPARTY key (null when unmapped)', () => {
    const withCp = generateHashableObject(
      makeRow({ ...BASE_CELLS, 'c-cp': 'Cafe Alpha' }),
      COLUMNS
    );
    expect(withCp[ColumnDefinition.COUNTERPARTY]).toBe('Cafe Alpha');

    const withoutCp = generateHashableObject(
      makeRow(BASE_CELLS),
      COLUMNS.filter((c) => c.definition !== ColumnDefinition.COUNTERPARTY)
    );
    expect(withoutCp[ColumnDefinition.COUNTERPARTY]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Q-011 — pseudo-op type-marker in the canonical hash (decision 2, Story 2.5)
// ---------------------------------------------------------------------------

describe('Q-011 — pseudo-op discriminator in the canonical hash (decision 2)', () => {
  const row = makeRow({ ...BASE_CELLS, 'c-cp': 'Merchant X' });

  it('canonical object carries pseudoOp: "main" by default', () => {
    const obj = generateHashableObject(row, COLUMNS);
    expect(obj['pseudoOp']).toBe('main');
  });

  it('canonical object carries the explicit discriminator when supplied', () => {
    expect(generateHashableObject(row, COLUMNS, 'commission')['pseudoOp']).toBe('commission');
    expect(generateHashableObject(row, COLUMNS, 'cashback')['pseudoOp']).toBe('cashback');
  });

  it('THREE pairwise-distinct hashes for same row across all discriminator values (decision 2 pin)', async () => {
    const hashMain = await calculateRowHash(row, COLUMNS, 'main');
    const hashCommission = await calculateRowHash(row, COLUMNS, 'commission');
    const hashCashback = await calculateRowHash(row, COLUMNS, 'cashback');

    expect(hashMain).not.toBe(hashCommission);
    expect(hashMain).not.toBe(hashCashback);
    expect(hashCommission).not.toBe(hashCashback);
  });

  it('same-type (commission) pseudo-ops from different rows hash distinctly (same-type cross-row pin)', async () => {
    const rowA = makeRow({ ...BASE_CELLS, 'c-cp': 'Merchant A' });
    const rowB = makeRow({ ...BASE_CELLS, 'c-cp': 'Merchant B' });

    const hashA = await calculateRowHash(rowA, COLUMNS, 'commission');
    const hashB = await calculateRowHash(rowB, COLUMNS, 'commission');

    expect(hashA).not.toBe(hashB);
  });

  it('default-param call ≡ explicit "main" discriminator', async () => {
    const hashDefault = await calculateRowHash(row, COLUMNS);
    const hashExplicitMain = await calculateRowHash(row, COLUMNS, 'main');

    expect(hashDefault).toBe(hashExplicitMain);
  });
});
