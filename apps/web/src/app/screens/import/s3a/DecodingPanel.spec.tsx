import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DecodingPanel } from './DecodingPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

function renderPanel(props: { fileName?: string; done: number; total: number }, lang: Lang = 'uk') {
  return render(
    <LangProvider initialLang={lang}>
      <DecodingPanel fileName={props.fileName ?? 'big-statement.csv'} done={props.done} total={props.total} />
    </LangProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('DecodingPanel (S3a decoding — PROGRESS-DURING-DECODE visual)', () => {
  it('shows the filename and the honest done/total counts (uk)', () => {
    renderPanel({ done: 2500, total: 10000 });
    expect(screen.getByText('big-statement.csv')).toBeTruthy();
    expect(screen.getByText('2500 / 10000 рядків')).toBeTruthy();
    expect(screen.getByText('2500 / 10000')).toBeTruthy(); // header eyebrow
  });

  it('determinate progressbar carries real aria values and lights cells proportionally', () => {
    const { container } = renderPanel({ done: 5000, total: 10000 });
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('5000');
    expect(bar.getAttribute('aria-valuemax')).toBe('10000');
    expect(bar.classList.contains('indet')).toBe(false);
    const lit = container.querySelectorAll('.dec-cell.lit');
    expect(lit).toHaveLength(14); // 28-cell track at 50%
  });

  it('total unknown (≤ 0) → indeterminate sweep, NO fake numbers (aria-valuenow absent)', () => {
    const { container } = renderPanel({ done: 0, total: 0 });
    const bar = screen.getByRole('progressbar');
    expect(bar.classList.contains('indet')).toBe(true);
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(container.querySelectorAll('.dec-cell.lit')).toHaveLength(0);
    expect(screen.getByText('ВІДКРИВАЄМО ФАЙЛ…')).toBeTruthy();
  });

  it('renders the gold work-in-progress lamp in the header', () => {
    const { container } = renderPanel({ done: 1, total: 2 });
    expect(container.querySelector('.panel-h .lamp.gold')).toBeTruthy();
    expect(screen.getByText('▸ ЧИТАННЯ ФАЙЛУ')).toBeTruthy();
  });

  it('renders the en copy in both modes', () => {
    renderPanel({ done: 0, total: 0 }, 'en');
    expect(screen.getByText('▸ READING THE FILE')).toBeTruthy();
    expect(screen.getByText('OPENING THE FILE…')).toBeTruthy();
    cleanup();
    renderPanel({ done: 3, total: 9 }, 'en');
    expect(screen.getByText('3 / 9 rows')).toBeTruthy();
  });
});
