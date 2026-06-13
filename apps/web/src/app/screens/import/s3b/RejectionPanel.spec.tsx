import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RejectionPanel } from './RejectionPanel';
import type { RejectionInfo } from './RejectionPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

/** A rejection with FIVE cell errors — proves the list is NOT truncated (>3). */
const REJECTION: RejectionInfo = {
  errorCount: 5,
  totalCount: 12,
  threshold: 0.3,
  cellErrors: [
    { rowIndex: 3, message: 'not a number: «—»' },
    { rowIndex: 6, message: 'not a number: «n/a»' },
    { rowIndex: 8, message: 'not a number: «н/д»' },
    { rowIndex: 9, message: 'not a number: «x»' },
    { rowIndex: 11, message: 'not a number: «?»' },
  ],
};

function renderPanel(rej = REJECTION, lang: Lang = 'uk') {
  const onRetry = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <RejectionPanel rejection={rej} columnName="amount" onRetry={onRetry} />
    </LangProvider>,
  );
  return { ...utils, onRetry };
}

describe('RejectionPanel (>30% ColumnTransformRejection, loud)', () => {
  it('renders the orange header naming the column + WHAT/WHY/DO rows', () => {
    const { container } = renderPanel();
    expect(container.querySelector('.perrpanel .panel-h .lamp.orange')).toBeTruthy();
    expect(screen.getByText(/amount/)).toBeTruthy();
    const lines = container.querySelectorAll('.err-line');
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toContain('5 з 12'); // WHAT: errors/total
    expect(lines[1].textContent).toContain('30%'); // WHY: threshold pct
  });

  it('renders ALL cellErrors (5 > 3 — not truncated)', () => {
    const { container } = renderPanel();
    const rows = container.querySelectorAll('[data-testid="rejection-cell-errors"] .perr-row');
    expect(rows).toHaveLength(5);
    // 1-based row labels
    expect(rows[0].textContent).toContain('РЯДОК 4');
    expect(rows[4].textContent).toContain('РЯДОК 12');
    expect(rows[4].textContent).toContain('«?»');
  });

  it('the retry/review key fires onRetry', () => {
    const { container, onRetry } = renderPanel();
    fireEvent.click(container.querySelector('.key.orange')!);
    expect(onRetry).toHaveBeenCalled();
  });

  it('resolves en copy', () => {
    renderPanel(REJECTION, 'en');
    expect(screen.getByText(/5 of 12 values could not be parsed/)).toBeTruthy();
    expect(screen.getByText(/exceeds the 30% error threshold/)).toBeTruthy();
  });
});
