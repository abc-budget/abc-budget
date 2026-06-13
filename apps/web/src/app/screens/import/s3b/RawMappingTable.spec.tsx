import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RawMappingTable } from './RawMappingTable';
import type { MappingColumn } from './types';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** Two columns with parallel sample cells (3 rows): col A clean, col B with error/ignore/empty. */
const COLUMNS: MappingColumn[] = [
  {
    id: 'a',
    rawName: 'Дата',
    definition: 'date',
    recallState: 'confirmed',
    sampleCells: [{ value: '2026-05-28' }, { value: '2026-05-29' }, { value: '2026-05-30' }],
  },
  {
    id: 'b',
    rawName: 'Сума',
    definition: 'amount',
    recallState: 'confirmed',
    sampleCells: [
      { value: '-320.50' },
      { value: 'n/a', error: 'Not a number' },
      { value: '', ignore: 'Skipped row' },
    ],
  },
];

function renderTable(columns = COLUMNS, lang: Lang = 'uk', openColId: string | null = null) {
  const onOpenCol = vi.fn();
  const menu = {
    onPick: vi.fn(),
    onMore: vi.fn(),
    onUndo: vi.fn(),
    onReconfigure: vi.fn(),
    onConfirm: vi.fn(),
  };
  const utils = render(
    <LangProvider initialLang={lang}>
      <RawMappingTable
        columns={columns}
        fileLabel="wise.csv"
        totalRows={240}
        openColId={openColId}
        onOpenCol={onOpenCol}
        menu={menu}
      />
    </LangProvider>,
  );
  return { ...utils, onOpenCol, menu };
}

describe('RawMappingTable (transposed sample view, no filter toolbar)', () => {
  it('renders a ColHeader per column + the header panel counts', () => {
    const { container } = renderTable();
    expect(container.querySelectorAll('thead .colh')).toHaveLength(2);
    expect(screen.getByText(/240/)).toBeTruthy();
    const rawnames = [...container.querySelectorAll('thead .colh-rawname')].map((n) => n.textContent);
    expect(rawnames).toEqual(['Дата', 'Сума']);
  });

  it('does NOT render the EP-5 filter toolbar (decision #6)', () => {
    const { container } = renderTable();
    expect(container.querySelector('.raw-toolbar')).toBeNull();
    expect(container.querySelector('.rtb-seg')).toBeNull();
  });

  it('TRANSPOSES sampleCells: row i = the i-th cell of every column', () => {
    const { container } = renderTable();
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(3);
    // row 0: date 2026-05-28 | amount -320.50
    const row0Cells = bodyRows[0].querySelectorAll('td:not(.td-ps)');
    expect(row0Cells[0].textContent).toBe('2026-05-28');
    expect(row0Cells[1].textContent).toBe('-320.50');
  });

  it('per-cell: empty → em-dash + cell-empty; error → cell-err + title; ignore → cell-ign + title', () => {
    const { container } = renderTable();
    const bodyRows = container.querySelectorAll('tbody tr');
    // row 1, col B = error cell "n/a"
    const errCell = bodyRows[1].querySelectorAll('td:not(.td-ps)')[1];
    expect(errCell.classList.contains('cell-err')).toBe(true);
    expect(errCell.getAttribute('title')).toBe('Not a number');
    // row 2, col B = ignore + empty value → em-dash, cell-ign + cell-empty
    const ignCell = bodyRows[2].querySelectorAll('td:not(.td-ps)')[1];
    expect(ignCell.classList.contains('cell-ign')).toBe(true);
    expect(ignCell.classList.contains('cell-empty')).toBe(true);
    expect(ignCell.textContent).toBe('—');
    expect(ignCell.getAttribute('title')).toBe('Skipped row');
  });

  it('marks the parse-state gutter per transposed row (error / skipped / ok)', () => {
    const { container } = renderTable();
    const dots = container.querySelectorAll('tbody .ps-dot');
    expect(dots[0].className).toContain('ps-ok');
    expect(dots[1].className).toContain('ps-error');
    expect(dots[2].className).toContain('ps-skipped');
  });

  it('renders the open column menu inline and forwards onOpenCol', () => {
    const { container, onOpenCol } = renderTable(COLUMNS, 'uk', 'a');
    expect(container.querySelector('.colmenu')).toBeTruthy();
    fireEvent.click(container.querySelectorAll('thead .colh')[1]);
    expect(onOpenCol).toHaveBeenCalledWith('b');
  });

  it('numeric columns get cell-num styling', () => {
    const { container } = renderTable();
    const amountCell = container.querySelectorAll('tbody tr')[0].querySelectorAll('td:not(.td-ps)')[1];
    expect(amountCell.classList.contains('cell-num')).toBe(true);
  });
});
