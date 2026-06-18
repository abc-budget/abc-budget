import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LangProvider } from '../../../i18n/LangProvider';
import { SelfCheckBanner } from './SelfCheckBanner';

afterEach(cleanup);

describe('SelfCheckBanner', () => {
  it('shows the eyebrow + the pluralized count + the re-sort toggle; fires callbacks', () => {
    const onToggleSort = vi.fn(), onHide = vi.fn();
    render(<LangProvider initialLang="uk"><SelfCheckBanner count={3} atypFirst={false}
      onToggleSort={onToggleSort} onHide={onHide} lang="uk" /></LangProvider>);
    expect(screen.getByText(/САМОПЕРЕВІРКА НАБОРУ/)).toBeTruthy();
    expect(screen.getByText(/3 операцій найменш схожі/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Нетипові — згори/)); expect(onToggleSort).toHaveBeenCalled();
    fireEvent.click(screen.getByTitle(/Сховати/)); expect(onHide).toHaveBeenCalled();
  });
});
