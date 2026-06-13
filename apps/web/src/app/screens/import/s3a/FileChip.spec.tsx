import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileChip } from './FileChip';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

const FILE = { name: 'statement-june.csv', sizeLabel: '47 KB', rows: 536 };

function renderChip(lang: Lang = 'uk') {
  const onReplace = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <FileChip file={FILE} onReplace={onReplace} onRemove={onRemove} />
    </LangProvider>,
  );
  return { ...utils, onReplace, onRemove };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('FileChip (S3a shared file card)', () => {
  it('shows the file name and the size · rows-estimate line (uk)', () => {
    renderChip('uk');
    expect(screen.getByText('statement-june.csv')).toBeTruthy();
    expect(screen.getByText('47 KB · 536 рядків (приблизно)')).toBeTruthy();
  });

  it('shows the en rows estimate', () => {
    renderChip('en');
    expect(screen.getByText('47 KB · 536 rows (approx.)')).toBeTruthy();
  });

  it('replace button fires onReplace', () => {
    const { onReplace } = renderChip();
    fireEvent.click(screen.getByRole('button', { name: 'Замінити' }));
    expect(onReplace).toHaveBeenCalledOnce();
  });

  it('remove button carries an aria-label (a11y — its visible glyph is ✕) and fires onRemove', () => {
    const { onRemove } = renderChip();
    const remove = screen.getByRole('button', { name: 'Прибрати' });
    expect(remove.getAttribute('aria-label')).toBe('Прибрати');
    expect(remove.classList.contains('fc-x')).toBe(true);
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledOnce();
  });
});
