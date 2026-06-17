import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CategoryPicker } from './CategoryPicker';
import { LangProvider } from '../../../i18n/LangProvider';
import { cat } from './fixtures';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderPicker(onPick = vi.fn(), onCreate = vi.fn()) {
  const categories = [
    cat({ id: 'groceries', name: 'Продукти', icon: 'groceries' }),
    cat({ id: 'dining', name: 'Кафе', icon: 'dining' }),
  ];
  const utils = render(
    <LangProvider initialLang="uk">
      <CategoryPicker categories={categories} currentId="groceries" onPick={onPick} onCreate={onCreate} lang="uk" />
    </LangProvider>,
  );
  return { ...utils, onPick, onCreate };
}

describe('CategoryPicker', () => {
  it('lists categories (glyph + name) and marks the current one', () => {
    const { container } = renderPicker();
    expect(screen.getByText('Продукти')).toBeTruthy();
    expect(screen.getByText('Кафе')).toBeTruthy();
    expect(container.querySelector('.catpicker-item.on')).toBeTruthy();
    expect(container.querySelector('.cpi-check')).toBeTruthy();
  });

  it('picking a category fires onPick with its id', () => {
    const { onPick } = renderPicker();
    fireEvent.click(screen.getByText('Кафе'));
    expect(onPick).toHaveBeenCalledWith('dining');
  });

  it('inline create from search fires onCreate with the query', () => {
    const { container, onCreate } = renderPicker();
    const input = container.querySelector('.catpicker-search input')!;
    fireEvent.change(input, { target: { value: 'Аптека' } });
    // no match → the only row is "create «Аптека»"
    fireEvent.click(screen.getByText('Створити «Аптека»'));
    expect(onCreate).toHaveBeenCalledWith('Аптека');
  });

  it('the trailing "create category" row fires onCreate with an empty name', () => {
    const { onCreate } = renderPicker();
    fireEvent.click(screen.getByText('Створити категорію'));
    expect(onCreate).toHaveBeenCalledWith('');
  });
});
