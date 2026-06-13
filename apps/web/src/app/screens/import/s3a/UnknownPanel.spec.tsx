import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { UnknownPanel } from './UnknownPanel';
import type { RecognizedSummary } from './RecognizedPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

const FILE = { name: 'export_2026_q2.csv', sizeLabel: '70 KB', rows: 794 };

/** First-ever import — empty pool, every column untyped. */
const RECOG: RecognizedSummary = {
  n: 0,
  m: 3,
  cols: [
    { name: 'Käufer', definition: null },
    { name: 'Betrag', definition: null },
    { name: 'Datum', definition: null },
  ],
};

function renderPanel(lang: Lang = 'uk') {
  const utils = render(
    <LangProvider initialLang={lang}>
      <UnknownPanel file={FILE} recog={RECOG} onReplace={vi.fn()} onRemove={vi.fn()} />
    </LangProvider>,
  );
  return utils;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('UnknownPanel (S3a first-ever import, n = 0)', () => {
  it('renders the gold-lamp header, 0/M eyebrow and the first-import title (uk)', () => {
    const { container } = renderPanel('uk');
    expect(container.querySelector('.panel-h .lamp.gold')).toBeTruthy();
    expect(screen.getByText('0 / 3')).toBeTruthy();
    expect(screen.getByText('▸ ЖОДНОЇ ВІДОМОЇ КОЛОНКИ')).toBeTruthy();
    expect(screen.getByText('Перший імпорт — правил ще немає')).toBeTruthy();
  });

  it('savedmap renders EVERY column in the unknown style («без типу»)', () => {
    const { container } = renderPanel('uk');
    const rows = container.querySelectorAll('.sm-row');
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.classList.contains('sm-unk')).toBe(true);
      expect(row.querySelector('.sm-type-unk')!.textContent).toBe('без типу');
    }
    expect(screen.getByText('Käufer')).toBeTruthy();
  });

  it('the CRT next-step note shows the all-untyped count and points at the Columns step', () => {
    const { container } = renderPanel('uk');
    const crt = container.querySelector('.unk-detected.crt')!;
    expect(crt.textContent).toContain('3 колонок · усі без типу');
    expect(crt.textContent).toContain('→ КОЛОНКИ');
    // verbatim prototype copy — intentionally bilingual
    expect(crt.textContent).toContain('// наступний крок · next step');
  });

  it('renders the en copy', () => {
    renderPanel('en');
    expect(screen.getByText('▸ NO KNOWN COLUMN')).toBeTruthy();
    expect(screen.getByText('First import — no rules yet')).toBeTruthy();
    expect(screen.getByText(/3 columns · all untyped/)).toBeTruthy();
    expect(screen.getAllByText('untyped')).toHaveLength(3);
  });
});
