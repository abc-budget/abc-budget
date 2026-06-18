import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { CategoryCell } from './CategoryCell';
import { LangProvider } from '../../../i18n/LangProvider';
import { CAT_GROCERIES, CAT_TRANSPORT } from './fixtures';

afterEach(() => {
  cleanup();
});

describe('CategoryCell', () => {
  it('renders the CatChip name for a categorized row (baseline)', () => {
    const { container } = render(
      <LangProvider initialLang="uk">
        <CategoryCell category={CAT_GROCERIES} onClick={() => {}} lang="uk" />
      </LangProvider>,
    );
    expect(screen.getByText('Продукти')).toBeTruthy();
    expect(container.querySelector('.catcell.has')).toBeTruthy();
  });

  it('renders the assign affordance when category is undefined', () => {
    const { container } = render(
      <LangProvider initialLang="uk">
        <CategoryCell category={undefined} onClick={() => {}} lang="uk" />
      </LangProvider>,
    );
    expect(container.querySelector('.catcell.none')).toBeTruthy();
  });

  it('renders old→new diff when `previous` is set (CatChip.previous seam)', () => {
    const { container } = render(
      <LangProvider initialLang="uk">
        <CategoryCell category={CAT_TRANSPORT} previous={CAT_GROCERIES} onClick={() => {}} lang="uk" />
      </LangProvider>,
    );
    expect(container.querySelector('.catcell-diff')).toBeTruthy();
    expect(container.querySelector('.catcell-arrow')).toBeTruthy();
    expect(screen.getByText('Продукти')).toBeTruthy(); // old
    expect(screen.getByText('Транспорт')).toBeTruthy(); // new
    expect(container.querySelector('.catcell.changed')).toBeTruthy();
  });

  it('uncategorize diff (new=null): keeps the OLD chip + shows «uncategorized», not a bare assign', () => {
    // A sandbox edit that strips a row's category: previous set, category undefined.
    const { container } = render(
      <LangProvider initialLang="uk">
        <CategoryCell category={undefined} previous={CAT_GROCERIES} onClick={() => {}} lang="uk" />
      </LangProvider>,
    );
    // the old chip must still render (FINDING-3: it was being dropped)
    expect(screen.getByText('Продукти')).toBeTruthy();
    expect(container.querySelector('.catcell-diff')).toBeTruthy();
    expect(container.querySelector('.catcell-arrow')).toBeTruthy();
    // the new side is the «uncategorized» lost-pill, not the plain assign affordance
    expect(container.querySelector('.nocat-pill.lost')).toBeTruthy();
    expect(container.querySelector('.catcell.changed')).toBeTruthy();
    expect(container.querySelector('.catcell-assign')).toBeNull();
  });

  it('does NOT add .changed when previous is not set', () => {
    const { container } = render(
      <LangProvider initialLang="uk">
        <CategoryCell category={CAT_GROCERIES} onClick={() => {}} lang="uk" />
      </LangProvider>,
    );
    expect(container.querySelector('.catcell.changed')).toBeNull();
    expect(container.querySelector('.catcell-diff')).toBeNull();
  });

  it('calls onClick when the cell button is clicked', () => {
    const onClick = vi.fn();
    render(
      <LangProvider initialLang="uk">
        <CategoryCell category={CAT_GROCERIES} onClick={onClick} lang="uk" />
      </LangProvider>,
    );
    screen.getByTitle(/чому|why/i).click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});
