import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColMenu } from './ColMenu';
import type { MappingColumn } from './types';
import { TYPE_ORDER } from './type-order';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function col(over: Partial<MappingColumn> = {}): MappingColumn {
  return { id: 'c1', rawName: 'Amount', definition: 'amount', recallState: 'confirmed', sampleCells: [], ...over };
}

function renderMenu(column: MappingColumn, lang: Lang = 'uk') {
  const cb = {
    onPick: vi.fn(),
    onMore: vi.fn(),
    onUndo: vi.fn(),
    onReconfigure: vi.fn(),
    onConfirm: vi.fn(),
  };
  const utils = render(
    <LangProvider initialLang={lang}>
      <ColMenu column={column} {...cb} />
    </LangProvider>,
  );
  return { ...utils, cb };
}

describe('ColMenu (per-state actions)', () => {
  it('has role=menu and renders the full TYPE_ORDER pick list as radio items', () => {
    const { container } = renderMenu(col({ definition: null, recallState: null }));
    expect(container.querySelector('[role="menu"]')).toBeTruthy();
    expect(container.querySelectorAll('.cm-item[role="menuitemradio"]')).toHaveLength(TYPE_ORDER.length);
  });

  it('UNKNOWN: no current-actions block (no confirm/reconfigure/undo)', () => {
    const { container } = renderMenu(col({ definition: null, recallState: null }));
    expect(container.querySelector('.cm-current')).toBeNull();
    expect(container.querySelector('.cm-confirm')).toBeNull();
  });

  it('GUESSED: confirm + reconfigure + undo all present', () => {
    const { container } = renderMenu(col({ definition: 'amount', recallState: 'guessed' }));
    expect(container.querySelector('.cm-confirm')).toBeTruthy();
    expect(container.querySelector('.cm-act.cm-undo')).toBeTruthy();
    expect(screen.getByText('Налаштувати')).toBeTruthy();
  });

  it('CONFIRMED: reconfigure + undo present, NO confirm (confirm is guessed-only)', () => {
    const { container } = renderMenu(col({ definition: 'amount', recallState: 'confirmed' }));
    expect(container.querySelector('.cm-confirm')).toBeNull();
    expect(container.querySelector('.cm-act.cm-undo')).toBeTruthy();
  });

  it('the current type shows a ✓ tick and aria-checked', () => {
    const { container } = renderMenu(col({ definition: 'amount', recallState: 'confirmed' }));
    const checked = container.querySelector('.cm-item[aria-checked="true"]')!;
    expect(checked.querySelector('.cm-tick')?.textContent).toBe('✓');
  });

  it('pick fires onPick with the chosen engine definition', () => {
    const { container, cb } = renderMenu(col({ definition: null, recallState: null, id: 'z9' }));
    // bank_account maps via TYPE_ORDER → engine string
    const items = container.querySelectorAll('.cm-item');
    const accountIdx = TYPE_ORDER.indexOf('bank_account');
    fireEvent.click(items[accountIdx]);
    expect(cb.onPick).toHaveBeenCalledWith('z9', 'bank_account');
  });

  it('More / Confirm / Undo / Reconfigure fire their callbacks', () => {
    const { container, cb } = renderMenu(col({ definition: 'amount', recallState: 'guessed', id: 'q' }));
    fireEvent.click(container.querySelector('.cm-confirm')!);
    fireEvent.click(container.querySelector('.cm-act.cm-undo')!);
    fireEvent.click(screen.getByText('Налаштувати'));
    fireEvent.click(container.querySelector('.cm-more')!);
    expect(cb.onConfirm).toHaveBeenCalledWith('q');
    expect(cb.onUndo).toHaveBeenCalledWith('q');
    expect(cb.onReconfigure).toHaveBeenCalledWith('q');
    expect(cb.onMore).toHaveBeenCalledWith('q');
  });

  it('resolves en copy', () => {
    renderMenu(col({ definition: 'amount', recallState: 'guessed' }), 'en');
    expect(screen.getByText('Reconfigure')).toBeTruthy();
    expect(screen.getByText('Undo (revert)')).toBeTruthy();
  });
});
