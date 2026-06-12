import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ErrorPanel } from './ErrorPanel';
import type { DecodeErrorView } from './ErrorPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import { CATALOG_UK } from '../../../i18n/catalog-uk';
import type { Lang } from '../../../i18n/i18n';

const ERROR: DecodeErrorView = {
  what: 'Файл не вдалося відкрити',
  why: 'Він порожній, пошкоджений або це не таблиця (CSV/XLS/XLSX).',
  action: 'Перевірте, що це експорт виписки, і спробуйте інший файл.',
};

function renderPanel(opts?: {
  lang?: Lang;
  file?: { name: string; sizeLabel?: string } | null;
  error?: DecodeErrorView;
}) {
  const onRetry = vi.fn();
  const utils = render(
    <LangProvider initialLang={opts?.lang ?? 'uk'}>
      <ErrorPanel
        file={opts?.file === undefined ? { name: 'statement.pdf', sizeLabel: '12 KB' } : opts.file}
        error={opts?.error ?? ERROR}
        onRetry={onRetry}
      />
    </LangProvider>,
  );
  return { ...utils, onRetry };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ErrorPanel (S3a read failure — HC-7 loud)', () => {
  it('renders the orange-lamp header and the loud tag (uk)', () => {
    const { container } = renderPanel();
    expect(container.querySelector('.panel-h .lamp.orange')).toBeTruthy();
    expect(screen.getByText('▸ НЕ ВДАЛОСЯ ПРОЧИТАТИ ФАЙЛ')).toBeTruthy();
  });

  it('shows the failing file line with name and size', () => {
    renderPanel();
    expect(screen.getByText('✕ statement.pdf · 12 KB')).toBeTruthy();
  });

  it('omits the file line when no file is known; omits the size when absent', () => {
    const { container } = renderPanel({ file: null });
    expect(container.querySelector('.err-file')).toBeNull();
    cleanup();
    renderPanel({ file: { name: 'statement.pdf' } });
    expect(screen.getByText('✕ statement.pdf')).toBeTruthy();
  });

  it('the ЩО/ЧОМУ/ДІЯ rows render the PROP values under the catalog labels (decode-issue-driven)', () => {
    const custom: DecodeErrorView = {
      what: 'Аркуш захищено паролем',
      why: 'XLSX зашифровано.',
      action: 'Зніміть пароль і спробуйте ще раз.',
    };
    const { container } = renderPanel({ error: custom });
    const lines = container.querySelectorAll('.err-line');
    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toBe('ЩО:Аркуш захищено паролем');
    expect(lines[1].textContent).toBe('ЧОМУ:XLSX зашифровано.');
    expect(lines[2].textContent).toBe('ДІЯ:Зніміть пароль і спробуйте ще раз.');
  });

  it('the catalog ships generic defaults the container can fall back to (s3aErr*V)', () => {
    // The defaults live in the CATALOG, not the component — pin they exist and match the bundle.
    expect(CATALOG_UK.s3aErrWhatV).toBe('Файл не вдалося відкрити');
    expect(CATALOG_UK.s3aErrWhyV).toContain('CSV/XLS/XLSX');
    expect(CATALOG_UK.s3aErrDoV).toContain('спробуйте інший файл');
  });

  it('retry key fires onRetry; en labels render', () => {
    const { onRetry } = renderPanel({
      lang: 'en',
      error: { what: 'The file could not be opened', why: 'w', action: 'a' },
    });
    expect(screen.getByText('▸ COULDN’T READ THE FILE')).toBeTruthy();
    expect(screen.getByText('WHAT:')).toBeTruthy();
    expect(screen.getByText('WHY:')).toBeTruthy();
    expect(screen.getByText('DO:')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose another file' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
