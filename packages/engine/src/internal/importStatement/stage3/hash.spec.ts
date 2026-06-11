/**
 * Row-hash tests — Story 2.3 QA FINDING-1 pin (ENT-009).
 *
 * COUNTERPARTY is identifying data and must participate in the row hash like
 * description. These tests run against the REAL hash implementation (the
 * row-generator spec mocks ./hash entirely, so the pin lives here).
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
