import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CatChip } from './CatChip';
import { CategoryCell } from './CategoryCell';
import { LangProvider } from '../../../i18n/LangProvider';
import { cat } from './fixtures';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const wrap = (node: React.ReactNode) => <LangProvider initialLang="uk">{node}</LangProvider>;

describe('CatChip', () => {
  it('renders glyph + category name from CategoryDTO', () => {
    const { container } = render(wrap(<CatChip category={cat({ name: 'Продукти', icon: 'groceries' })} lang="uk" />));
    expect(screen.getByText('Продукти')).toBeTruthy();
    expect(container.querySelector('.catchip svg')).toBeTruthy();
  });

  it('shows the «ВРУЧНУ» manual tag when isManual', () => {
    const { container } = render(wrap(<CatChip category={cat()} isManual lang="uk" />));
    expect(container.querySelector('.catchip.src-manual')).toBeTruthy();
    expect(container.querySelector('.catchip-ovr')?.textContent).toBe('ВРУЧНУ');
  });

  it('renders nothing-manual chip (src-rule) by default', () => {
    const { container } = render(wrap(<CatChip category={cat()} lang="uk" />));
    expect(container.querySelector('.catchip.src-rule')).toBeTruthy();
    expect(container.querySelector('.catchip-ovr')).toBeNull();
  });

  it('4.9b seam: a `previous` category renders the old→new diff arrow', () => {
    const { container } = render(
      wrap(<CatChip previous={cat({ name: 'Інше', icon: 'other' })} category={cat({ name: 'Продукти' })} lang="uk" />),
    );
    expect(container.querySelector('.catcell-diff')).toBeTruthy();
    expect(container.querySelector('.catcell-arrow')).toBeTruthy();
    expect(screen.getByText('Інше')).toBeTruthy();
    expect(screen.getByText('Продукти')).toBeTruthy();
  });

  it('4.9a never passes `previous` → no diff arrow', () => {
    const { container } = render(wrap(<CatChip category={cat()} lang="uk" />));
    expect(container.querySelector('.catcell-diff')).toBeNull();
    expect(container.querySelector('.catcell-arrow')).toBeNull();
  });
});

describe('CategoryCell', () => {
  it('routes onClick (the screen decides → LOG/)', () => {
    const onClick = vi.fn();
    const { container } = render(wrap(<CategoryCell category={cat()} onClick={onClick} lang="uk" />));
    fireEvent.click(container.querySelector('button.catcell')!);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('shows the orange Assign affordance when uncategorized', () => {
    const { container } = render(wrap(<CategoryCell category={undefined} onClick={vi.fn()} lang="uk" />));
    expect(container.querySelector('.catcell.none')).toBeTruthy();
    expect(container.querySelector('.catcell-assign .lamp.orange')).toBeTruthy();
  });

  it('4.9c seam: the atypical slot renders the gold Ring (off by default)', () => {
    const { container, rerender } = render(wrap(<CategoryCell category={cat()} onClick={vi.fn()} lang="uk" />));
    expect(container.querySelector('.atyp-ring')).toBeNull();
    rerender(wrap(<CategoryCell category={cat()} atypical onClick={vi.fn()} lang="uk" />));
    expect(container.querySelector('.atyp-ring')).toBeTruthy();
  });
});
