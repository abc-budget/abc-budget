import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkerProgressPanel } from './WorkerProgressPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderPanel(done: number, total: number, lang: Lang = 'uk') {
  return render(
    <LangProvider initialLang={lang}>
      <WorkerProgressPanel done={done} total={total} />
    </LangProvider>,
  );
}

describe('WorkerProgressPanel (importNext takeover, honest determinate)', () => {
  it('drives the progressbar from props (done/total) — no synthetic timer', () => {
    const { container } = renderPanel(2920, 5840);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuemax')).toBe('5840');
    expect(bar.getAttribute('aria-valuenow')).toBe('2920');
    // 50% → half the 36 cells lit
    expect(container.querySelectorAll('.wcell.lit')).toHaveLength(18);
    expect(screen.getByText('50%')).toBeTruthy();
  });

  it('shows the gold-lamp header + processed-rows readout (uk locale groups 5 840)', () => {
    const { container } = renderPanel(100, 5840);
    expect(container.querySelector('.workerpanel .panel-h .lamp.gold')).toBeTruthy();
    // uk-UA groups thousands with a (narrow no-break) space; assert digits + label
    const read = container.querySelector('.worker-read')?.textContent ?? '';
    expect(read.replace(/[\s  ]/g, '')).toContain('5840');
    expect(read).toContain('рядків оброблено');
  });

  it('indeterminate before the first event (total ≤ 0): 0% lit, indet class', () => {
    const { container } = renderPanel(0, 0);
    expect(container.querySelector('.worker-gauge.indet')).toBeTruthy();
    expect(container.querySelectorAll('.wcell.lit')).toHaveLength(0);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
  });

  it('clamps to 100% / all cells when done ≥ total', () => {
    const { container } = renderPanel(6000, 5840);
    expect(screen.getByText('100%')).toBeTruthy();
    expect(container.querySelectorAll('.wcell.lit')).toHaveLength(36);
  });

  it('resolves en copy + en number locale', () => {
    const { container } = renderPanel(100, 5840, 'en');
    expect(screen.getByText('Parsing the statement')).toBeTruthy();
    expect(container.querySelector('.worker-read')?.textContent).toContain('5,840');
  });
});
