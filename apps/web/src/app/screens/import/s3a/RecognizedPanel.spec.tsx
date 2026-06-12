import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RecognizedPanel } from './RecognizedPanel';
import type { RecognizedSummary } from './RecognizedPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

const FILE = { name: 'statement-june.csv', sizeLabel: '47 KB', rows: 536 };

/** 4-of-5 recall — the prototype's demo shape (Баланс stays untyped). */
const PARTIAL: RecognizedSummary = {
  n: 4,
  m: 5,
  cols: [
    { name: 'Дата', definition: 'date' },
    { name: 'Опис', definition: 'description' },
    { name: 'Сума', definition: 'amount' },
    { name: 'Валюта', definition: 'currency' },
    { name: 'Баланс', definition: null },
  ],
};

const FULL: RecognizedSummary = {
  n: 2,
  m: 2,
  cols: [
    { name: 'Дата', definition: 'date' },
    { name: 'Сума', definition: 'amount' },
  ],
};

function renderPanel(recog: RecognizedSummary, lang: Lang = 'uk') {
  const onReplace = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <RecognizedPanel file={FILE} recog={recog} onReplace={onReplace} onRemove={onRemove} />
    </LangProvider>,
  );
  return { ...utils, onReplace, onRemove };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('RecognizedPanel (S3a recognized, n > 0)', () => {
  it('full recall (n = m): the "all recognized" title and NO partial line', () => {
    renderPanel(FULL, 'uk');
    expect(screen.getByText('Усі 2 колонок розпізнано')).toBeTruthy();
    expect(screen.queryByTestId('s3a-partial')).toBeNull();
  });

  it('partial recall (n < m): the n-of-m title AND the gold-lamp partial line with k = m − n', () => {
    renderPanel(PARTIAL, 'uk');
    expect(screen.getByText('Розпізнано 4 з 5 колонок')).toBeTruthy();
    const partial = screen.getByTestId('s3a-partial');
    expect(partial.textContent).toContain('1 ще без типу — зіставите їх на наступному кроці.');
    expect(partial.querySelector('.lamp.gold')).toBeTruthy();
  });

  it('shows the N / M eyebrow and the green header lamp', () => {
    const { container } = renderPanel(PARTIAL);
    expect(screen.getByText('4 / 5')).toBeTruthy();
    expect(container.querySelector('.panel-h .lamp.green')).toBeTruthy();
    expect(screen.getByText('▸ РОЗПІЗНАНО З ВАШИХ ПРАВИЛ')).toBeTruthy();
  });

  it('savedmap: recalled rows show the localized type + the «recalled» tag; untyped rows the unknown style', () => {
    const { container } = renderPanel(PARTIAL, 'uk');
    const rows = container.querySelectorAll('.sm-row');
    expect(rows).toHaveLength(5);
    // typed row: name → localized type label + tag
    expect(rows[0].textContent).toContain('Дата');
    expect(rows[0].querySelector('.sm-tag')!.textContent).toBe('з правил');
    expect(rows[0].classList.contains('sm-unk')).toBe(false);
    // untyped row: unknown style + «без типу», no tag
    expect(rows[4].classList.contains('sm-unk')).toBe(true);
    expect(rows[4].querySelector('.sm-type-unk')!.textContent).toBe('без типу');
    expect(rows[4].querySelector('.sm-tag')).toBeNull();
  });

  it('renders the dedup reassurance block (FEAT-018 copy — informational, no numbers) and the proceed note', () => {
    renderPanel(PARTIAL, 'uk');
    expect(screen.getByText('Повторні операції не рахуються двічі')).toBeTruthy();
    expect(screen.getByText(/ABC їх розпізнає й об’єднає/)).toBeTruthy();
    expect(screen.getByText(/Кожен імпорт проходить перевірку/)).toBeTruthy();
  });

  it('renders the en copy end-to-end (title, tag, dedup, type labels)', () => {
    renderPanel(PARTIAL, 'en');
    expect(screen.getByText('Recognized 4 of 5 columns')).toBeTruthy();
    expect(screen.getByText('▸ RECALLED FROM YOUR RULES')).toBeTruthy();
    expect(screen.getByText('Repeat transactions aren’t counted twice')).toBeTruthy();
    expect(screen.getAllByText('from rules')).toHaveLength(4);
    expect(screen.getByText('Date')).toBeTruthy();
    expect(screen.getByText('untyped')).toBeTruthy();
  });

  it('passes replace/remove through the embedded FileChip', () => {
    const { onReplace, onRemove } = renderPanel(PARTIAL);
    fireEvent.click(screen.getByRole('button', { name: 'Замінити' }));
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати' }));
    expect(onReplace).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
