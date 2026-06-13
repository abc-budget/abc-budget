import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StatusPanel } from './StatusPanel';
import type { MappingColumn } from './types';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const COLUMNS: MappingColumn[] = [
  { id: 'a', rawName: 'Дата', definition: 'date', recallState: 'confirmed', sampleCells: [] },
  { id: 'b', rawName: 'Сума', definition: 'amount', recallState: 'guessed', sampleCells: [] },
  { id: 'c', rawName: 'X', definition: null, recallState: null, sampleCells: [] },
  { id: 'd', rawName: 'Y', definition: 'ignore', recallState: 'confirmed', sampleCells: [] },
];

function renderPanel(columns = COLUMNS, lang: Lang = 'uk') {
  const onJump = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <StatusPanel columns={columns} onJump={onJump} />
    </LangProvider>,
  );
  return { ...utils, onJump };
}

describe('StatusPanel (default right pane)', () => {
  it('renders the collisionBanner slot at the top of the body when provided', () => {
    const onJump = vi.fn();
    render(
      <LangProvider initialLang="uk">
        <StatusPanel
          columns={COLUMNS}
          onJump={onJump}
          collisionBanner={<div data-testid="my-collision-banner" />}
        />
      </LangProvider>,
    );
    expect(screen.getByTestId('my-collision-banner')).toBeTruthy();
  });

  it('renders the info step-intro <details> with rendered markdown', () => {
    const { container } = renderPanel();
    const details = container.querySelector('details.step-intro')!;
    expect(details).toBeTruthy();
    expect(details.querySelector('.step-intro-body .md')).toBeTruthy();
  });

  it('progress bar has progressbar role with handled/total aria values (3/4 handled)', () => {
    const { container } = renderPanel();
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuemax')).toBe('4');
    expect(bar.getAttribute('aria-valuenow')).toBe('3'); // total − unknown = 4 − 1
  });

  it('legend counts: 1 confirmed, 1 guessed, 1 unknown (ignored excluded from confirmed)', () => {
    const { container } = renderPanel();
    const legend = container.querySelector('.status-legend')!.textContent!;
    expect(legend).toContain('1 підтв.');
    expect(legend).toContain('1 з правил');
    expect(legend).toContain('1 не визначено');
  });

  it('per-column status list: a row per column with state class + jump on click', () => {
    const { container, onJump } = renderPanel();
    const rows = container.querySelectorAll('.status-row');
    expect(rows).toHaveLength(4);
    expect(rows[0].classList.contains('confirmed')).toBe(true);
    expect(rows[1].classList.contains('guessed')).toBe(true);
    expect(rows[2].classList.contains('unknown')).toBe(true);
    expect(rows[3].classList.contains('ignored')).toBe(true);
    fireEvent.click(rows[2]);
    expect(onJump).toHaveBeenCalledWith('c');
  });

  it('renders the recall note', () => {
    renderPanel();
    expect(screen.getByText(/«З правил»/)).toBeTruthy();
  });

  it('resolves en copy', () => {
    const { container } = renderPanel(COLUMNS, 'en');
    expect(container.querySelector('.status-legend')!.textContent).toContain('1 set');
    expect(screen.getByText(/ABOUT THIS STEP/)).toBeTruthy();
  });
});
