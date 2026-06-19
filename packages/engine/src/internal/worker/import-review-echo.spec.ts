import { describe, it, expect } from 'vitest';
import { echoDecodedCells } from './import-review-echo';
import { ColumnDefinition } from '../importStatement/types';

// Minimal fake stage2 row: get(id) → { value } (mirrors ImportStatementRowData.get).
function fakeRow(cells: Record<string, { value: unknown }>) {
  return {
    rowIndex: 0,
    get: (id: string) => cells[id] ?? { value: undefined },
  } as unknown as import('../importStatement/stage2/types').ImportStatementRowData;
}
const col = (id: string, definition: ColumnDefinition) => ({ id, definition, params: null });

describe('echoDecodedCells', () => {
  it('echoes decoded date/amount/currency/description raw (date → ISO)', () => {
    const row = fakeRow({
      d: { value: new Date('2026-06-14T00:00:00Z') },
      a: { value: 1500 },
      c: { value: 'UAH' },
      s: { value: 'ATB' },
    });
    const out = echoDecodedCells(row, [
      col('d', ColumnDefinition.DATE),
      col('a', ColumnDefinition.AMOUNT),
      col('c', ColumnDefinition.CURRENCY),
      col('s', ColumnDefinition.DESCRIPTION),
    ]);
    expect(out).toEqual({ date: '2026-06-14T00:00:00.000Z', amount: 1500, currency: 'UAH', description: 'ATB' });
  });

  it('echoes RAW signed amount for an income row (no abs)', () => {
    const row = fakeRow({ a: { value: 50000 } });
    expect(echoDecodedCells(row, [col('a', ColumnDefinition.AMOUNT)]).amount).toBe(50000);
  });

  it('null for undecoded/absent/failed cells (no re-validation, never throws)', () => {
    const row = {
      rowIndex: 0,
      get: (id: string) => { if (id === 'boom') throw new Error('corrupt'); return { value: 'not-a-date' }; },
    } as unknown as import('../importStatement/stage2/types').ImportStatementRowData;
    const out = echoDecodedCells(row, [
      col('boom', ColumnDefinition.DATE),     // throws → null
      col('a', ColumnDefinition.AMOUNT),      // value 'not-a-date' (string, not number) → null
    ]);
    expect(out).toEqual({ date: null, amount: null, currency: null, description: null });
  });
});
