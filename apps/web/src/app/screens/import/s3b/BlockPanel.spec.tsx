import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BlockPanel } from './BlockPanel';
import type { MappingColumn } from './types';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const UNMAPPED: MappingColumn[] = [
  { id: 'x', rawName: 'exchange_rate', definition: null, recallState: null, sampleCells: [] },
  { id: 'y', rawName: 'cashback', definition: null, recallState: null, sampleCells: [] },
];

function renderPanel(cols = UNMAPPED, lang: Lang = 'uk') {
  const onJump = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <BlockPanel unmappedColumns={cols} onJump={onJump} />
    </LangProvider>,
  );
  return { ...utils, onJump };
}

describe('BlockPanel (loud UNKNOWN gate, Option A)', () => {
  it('renders the orange-lamp gate header + body', () => {
    const { container } = renderPanel();
    expect(container.querySelector('.blockpanel .panel-h .lamp.orange')).toBeTruthy();
    expect(screen.getByText('▸ Є КОЛОНКИ БЕЗ ТИПУ')).toBeTruthy();
  });

  it('names every unmapped column as a jump chip', () => {
    const { container, onJump } = renderPanel();
    const chips = container.querySelectorAll('.block-chip');
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('exchange_rate');
    fireEvent.click(chips[1]);
    expect(onJump).toHaveBeenCalledWith('y');
  });

  it('the «go to first» key jumps to the first unmapped column', () => {
    const { container, onJump } = renderPanel();
    fireEvent.click(container.querySelector('.key.orange')!);
    expect(onJump).toHaveBeenCalledWith('x');
  });

  it('resolves en copy', () => {
    renderPanel(UNMAPPED, 'en');
    expect(screen.getByText('▸ COLUMNS WITHOUT A TYPE')).toBeTruthy();
    expect(screen.getByText('Go to the first')).toBeTruthy();
  });
});
