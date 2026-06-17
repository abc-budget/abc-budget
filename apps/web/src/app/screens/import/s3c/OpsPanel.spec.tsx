import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpsPanel } from './OpsPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { mccTitle } from '../../../mcc/mcc-lookup';
import { cat, categoryMap, row, FIELDS, cond } from './fixtures';
import type { CategorizedRowDTO, ConditionDTO } from '@abc-budget/engine';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderPanel(
  over: {
    rows?: CategorizedRowDTO[];
    draft?: ConditionDTO[];
    lang?: Lang;
    onCellClick?: (i: number) => void;
  } = {},
) {
  const onCellClick = over.onCellClick ?? vi.fn();
  const rows = over.rows ?? [row({ rowIndex: 0 }), row({ rowIndex: 1, description: 'НОВА ПОШТА', categoryId: null })];
  const utils = render(
    <LangProvider initialLang={over.lang ?? 'uk'}>
      <OpsPanel
        rows={rows}
        fields={FIELDS}
        categories={categoryMap(cat(), cat({ id: 'shipping', name: 'Доставка', icon: 'shopping' }))}
        total={42}
        matchCount={2}
        segment="all"
        onSegment={vi.fn()}
        page={0}
        onPage={vi.fn()}
        draft={over.draft ?? []}
        onAddCondition={vi.fn()}
        onCellClick={onCellClick}
        lang={over.lang ?? 'uk'}
      />
    </LangProvider>,
  );
  return { ...utils, onCellClick };
}

describe('OpsPanel', () => {
  it('renders one row per CategorizedRowDTO + the category cell (CatChip name)', () => {
    const { container } = renderPanel();
    const bodyRows = container.querySelectorAll('tbody tr');
    expect(bodyRows.length).toBe(2);
    // categorized row shows the CatChip name
    expect(screen.getByText('Продукти')).toBeTruthy();
    // ALTUS pixel-pass proxy: the table carries the .opstable class
    expect(container.querySelector('.opstable')).toBeTruthy();
    expect(container.querySelector('.panel')).toBeTruthy();
  });

  it('keys rows on rowIndex, not the array index (stable across a sliding window)', () => {
    // rows whose rowIndex differs from their array position
    const rows = [row({ rowIndex: 17, description: 'A' }), row({ rowIndex: 4, description: 'B' })];
    const onCellClick = vi.fn();
    renderPanel({ rows, onCellClick });
    // first cell click reports rowIndex 17 (the DTO identity), not 0
    const cells = screen.getAllByTitle(/чому|why/i);
    fireEvent.click(cells[0]);
    expect(onCellClick).toHaveBeenCalledWith(17);
  });

  it('renders the MCC column via mccTitle (localized reference title)', () => {
    // FIELDS has no mcc column header by default? it does — add the mcc field already present.
    const expected = mccTitle(5812, 'uk');
    const { container } = renderPanel();
    expect(container.textContent).toContain(expected);
    // the localized title is NOT just the bare code when the table knows it
    expect(expected).not.toBe('5812');
  });

  it('localizes the MCC title with the active language (mccTitle(en) differs from uk)', () => {
    const uk = mccTitle(5812, 'uk');
    const en = mccTitle(5812, 'en');
    const { container } = renderPanel({ lang: 'en' });
    expect(container.textContent).toContain(en);
    expect(uk).not.toBe(en);
  });

  it('shows the filter-strip with condition tokens only when a draft is present', () => {
    const { container, rerender } = renderPanel({ draft: [] });
    expect(container.querySelector('.filter-strip')).toBeNull();
    rerender(
      <LangProvider initialLang="uk">
        <OpsPanel
          rows={[row()]}
          fields={FIELDS}
          categories={categoryMap(cat())}
          total={1}
          matchCount={1}
          segment="all"
          onSegment={vi.fn()}
          page={0}
          onPage={vi.fn()}
          draft={[cond()]}
          onAddCondition={vi.fn()}
          onCellClick={vi.fn()}
          lang="uk"
        />
      </LangProvider>,
    );
    expect(document.querySelector('.filter-strip')).toBeTruthy();
  });
});
