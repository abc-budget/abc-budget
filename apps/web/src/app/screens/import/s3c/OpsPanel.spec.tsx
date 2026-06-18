import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { OpsPanel } from './OpsPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { mccTitle } from '../../../mcc/mcc-lookup';
import { cat, categoryMap, row, diffRow, CAT_GROCERIES, CAT_TRANSPORT, FIELDS, FIELDS_MULTI_CURRENCY, cond, TYPICALITY_MULTI, typFlag } from './fixtures';
import type { CategorizedRowDTO, ConditionDTO, ConditionFieldDTO, TypicalityFlagDTO } from '@abc-budget/engine';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderPanel(
  over: {
    rows?: CategorizedRowDTO[];
    fields?: ConditionFieldDTO[];
    categories?: Map<string, import('@abc-budget/engine').CategoryDTO>;
    draft?: ConditionDTO[];
    lang?: Lang;
    onCellClick?: (i: number) => void;
    typicality?: Map<number, TypicalityFlagDTO>;
    atypFirst?: boolean;
  } = {},
) {
  const onCellClick = over.onCellClick ?? vi.fn();
  const rows = over.rows ?? [row({ rowIndex: 0 }), row({ rowIndex: 1, description: 'НОВА ПОШТА', categoryId: null })];
  const utils = render(
    <LangProvider initialLang={over.lang ?? 'uk'}>
      <OpsPanel
        rows={rows}
        fields={over.fields ?? FIELDS}
        categories={over.categories ?? categoryMap(cat(), cat({ id: 'shipping', name: 'Доставка', icon: 'shopping' }))}
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
        typicality={over.typicality}
        atypFirst={over.atypFirst}
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

  it('renders the description column header + the description cell content (field id `description`)', () => {
    // FINDING-B red→green: with the real DTO field id `description` (not the
    // prototype `desc`), the column header resolves AND the cell shows content.
    const { container } = renderPanel({ rows: [row({ description: 'АТБ МАРКЕТ' })] });
    // the header label key resolves (uk chrome) — not the raw field id
    const headers = Array.from(container.querySelectorAll('thead .th-lab')).map((n) => n.textContent);
    expect(headers).not.toContain('description');
    // the description cell carries the .op-desc class AND the verbatim content
    const descCell = container.querySelector('.op-desc .desc-val');
    expect(descCell).toBeTruthy();
    expect(descCell?.textContent).toBe('АТБ МАРКЕТ');
  });

  it('renders the operation date as formatted MM-DD, never the raw full-ISO (FINDING-A)', () => {
    // FINDING-A red→green: date is full-ISO (2023-09-30T00:00:00.000Z). The old
    // slice(5) rendered "09-30T00:00:00.000Z"; formatOpDate renders "09-30".
    const { container } = renderPanel({ rows: [row({ date: '2023-09-30T00:00:00.000Z' })] });
    expect(container.textContent).toContain('09-30');
    expect(container.textContent).not.toContain('T00:00:00');
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

  it('renders the currency column header (localized) + the verbatim code, NOT — (multi-currency)', () => {
    // MINOR-1 red→green: when >1 distinct currency surfaces the `currency` field,
    // the header resolves the localized label AND the cell shows the code (the
    // same class of bug as the `desc` header — no colHeaderKey/cellValue case).
    const rows = [
      row({ rowIndex: 0, currency: 'UAH', description: 'АТБ' }),
      row({ rowIndex: 1, currency: 'USD', description: 'NETFLIX' }),
    ];
    const { container } = renderPanel({ rows, fields: FIELDS_MULTI_CURRENCY, lang: 'uk' });
    // header: the localized uk label, never the raw field id
    const headers = Array.from(container.querySelectorAll('thead .th-lab')).map((n) => n.textContent);
    expect(headers).toContain('Валюта');
    expect(headers).not.toContain('currency');
    // cells: the verbatim codes, never the — placeholder
    const cellTexts = Array.from(container.querySelectorAll('tbody tr')).map((tr) => tr.textContent ?? '');
    expect(cellTexts.some((t) => t.includes('UAH'))).toBe(true);
    expect(cellTexts.some((t) => t.includes('USD'))).toBe(true);
  });

  it('renders the currency header label in en (Currency)', () => {
    const rows = [row({ rowIndex: 0, currency: 'UAH' }), row({ rowIndex: 1, currency: 'USD' })];
    const { container } = renderPanel({ rows, fields: FIELDS_MULTI_CURRENCY, lang: 'en' });
    const headers = Array.from(container.querySelectorAll('thead .th-lab')).map((n) => n.textContent);
    expect(headers).toContain('Currency');
  });

  it('single-currency: no currency field → no currency column (placement unaffected)', () => {
    // the default FIELDS has no `currency` field — no such header renders.
    const { container } = renderPanel();
    const headers = Array.from(container.querySelectorAll('thead .th-lab')).map((n) => n.textContent);
    expect(headers).not.toContain('Валюта');
    expect(headers).not.toContain('Currency');
  });

  it('passes previousCategoryId → CategoryCell.previous (old→new) for changed rows', () => {
    const rows = [diffRow({ rowIndex: 5 })]; // categoryId transport, previousCategoryId groceries
    const cats = new Map([[CAT_GROCERIES.id, CAT_GROCERIES], [CAT_TRANSPORT.id, CAT_TRANSPORT]]);
    const { container } = renderPanel({ rows, categories: cats });
    expect(container.querySelector('.catcell-diff')).toBeTruthy();
    expect(screen.getByText('Продукти')).toBeTruthy();
    expect(screen.getByText('Транспорт')).toBeTruthy();
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

  // ── 4.9c typicality overlay ──

  it('overlays typicality: Ring on the category cell + AtypReasons + the op-atyp row tint', () => {
    const rows = [row({ rowIndex: 1, description: 'CASINO', mcc: 6051 })];
    const typ = new Map([[1, TYPICALITY_MULTI[0]]]);
    const { container } = renderPanel({ rows, typicality: typ });
    expect(container.querySelector('.atyp-ring')).toBeTruthy(); // CategoryCell.atypical seam
    expect(container.querySelector('.atyp-reasons')).toBeTruthy(); // desc-cell chips
    expect(container.querySelector('tr.op-atyp')).toBeTruthy(); // row tint
  });

  it('atypFirst re-sorts the displayed window flagged-first by atypicality DESC', () => {
    // rowIndex 5 (atyp .68) and rowIndex 2 (atyp .77) flagged, rowIndex 0 unflagged.
    const rows = [
      row({ rowIndex: 0, description: 'PLAIN', categoryId: 'groceries' }),
      row({ rowIndex: 5, description: 'CASINO', categoryId: 'groceries' }),
      row({ rowIndex: 2, description: 'OUTLIER', categoryId: 'groceries' }),
    ];
    const typ = new Map<number, TypicalityFlagDTO>([
      [5, typFlag({ rowIndex: 5, atypicality: 0.68 })],
      [2, typFlag({ rowIndex: 2, atypicality: 0.77 })],
    ]);
    const { container } = renderPanel({ rows, typicality: typ, atypFirst: true });
    const descs = Array.from(container.querySelectorAll('tbody tr .desc-val')).map((n) => n.textContent);
    // highest atypicality first (.77 → OUTLIER), then .68 → CASINO, then the unflagged PLAIN
    expect(descs).toEqual(['OUTLIER', 'CASINO', 'PLAIN']);
  });
});
