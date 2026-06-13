import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ColHeader } from './ColHeader';
import type { MappingColumn } from './types';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function col(over: Partial<MappingColumn> = {}): MappingColumn {
  return {
    id: 'c1',
    rawName: 'Сума',
    definition: 'amount',
    recallState: 'confirmed',
    sampleCells: [],
    ...over,
  };
}

function renderHeader(column: MappingColumn, lang: Lang = 'uk', isActive = false, collision = false) {
  const onOpen = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <ColHeader column={column} isActive={isActive} collision={collision} onOpen={onOpen} />
    </LangProvider>,
  );
  return { ...utils, onOpen };
}

describe('ColHeader (per-column header states)', () => {
  it('UNKNOWN: loud orange class, ? badge, «без типу», ▸ unknown', () => {
    const { container } = renderHeader(col({ definition: null, recallState: null }));
    const btn = container.querySelector('button.colh')!;
    expect(btn.classList.contains('unknown')).toBe(true);
    expect(container.querySelector('.colh-q')?.textContent).toBe('?');
    expect(screen.getByText('без типу')).toBeTruthy();
    expect(container.querySelector('.colh-state')?.textContent).toContain('не визначено');
  });

  it('GUESSED: gold class + the loud recall ◇ glyph (item 3, distinct class)', () => {
    const { container } = renderHeader(col({ definition: 'amount', recallState: 'guessed' }));
    expect(container.querySelector('button.colh')!.classList.contains('guessed')).toBe(true);
    // item 3: the recalled affordance is a distinct, loud element, not a subtle dot
    const glyph = container.querySelector('.colh-recall-glyph');
    expect(glyph).toBeTruthy();
    expect(glyph?.textContent).toBe('◇');
    expect(container.querySelector('.colh-state')?.textContent).toContain('з правил');
  });

  it('CONFIRMED: green class, ✓ set, type label + glyph', () => {
    const { container } = renderHeader(col({ definition: 'amount', recallState: 'confirmed' }));
    expect(container.querySelector('button.colh')!.classList.contains('confirmed')).toBe(true);
    expect(container.querySelector('.colh-state')?.textContent).toContain('✓');
    expect(container.querySelector('.colh-rawname')?.textContent).toBe('Сума');
    expect(container.querySelector('.colh-type')?.textContent).toContain('Сума');
    expect(container.querySelector('[data-glyph="amount"]')).toBeTruthy();
  });

  it('IGNORED: muted class, ignored label', () => {
    const { container } = renderHeader(col({ definition: 'ignore', recallState: 'confirmed' }));
    expect(container.querySelector('button.colh')!.classList.contains('ignored')).toBe(true);
    expect(container.querySelector('.colh-state')?.textContent).toContain('ігнор.');
  });

  it('COLLISION: loud distinct badge (role=alert, own class), not a subtle dot', () => {
    const { container } = renderHeader(col({ definition: 'amount', recallState: 'guessed' }), 'uk', false, true);
    const btn = container.querySelector('button.colh')!;
    expect(btn.classList.contains('collision')).toBe(true);
    const badge = container.querySelector('.colh-collision');
    expect(badge).toBeTruthy();
    expect(badge?.getAttribute('role')).toBe('alert');
    expect(badge?.textContent).toContain('правило');
  });

  it('no collision badge when collision is false (default)', () => {
    const { container } = renderHeader(col({ definition: 'amount', recallState: 'guessed' }));
    expect(container.querySelector('.colh-collision')).toBeNull();
    expect(container.querySelector('button.colh')!.classList.contains('collision')).toBe(false);
  });

  it('active adds the active class and aria-expanded', () => {
    const { container } = renderHeader(col(), 'uk', true);
    const btn = container.querySelector('button.colh')!;
    expect(btn.classList.contains('active')).toBe(true);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('clicking calls onOpen with the column id', () => {
    const { container, onOpen } = renderHeader(col({ id: 'xyz' }));
    fireEvent.click(container.querySelector('button.colh')!);
    expect(onOpen).toHaveBeenCalledWith('xyz');
  });

  it('resolves en copy', () => {
    const { container } = renderHeader(col({ definition: null, recallState: null }), 'en');
    expect(screen.getByText('no type')).toBeTruthy();
    expect(container.querySelector('.colh-state')?.textContent).toContain('unknown');
  });
});
