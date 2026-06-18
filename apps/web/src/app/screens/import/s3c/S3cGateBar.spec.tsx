import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LangProvider } from '../../../i18n/LangProvider';
import { S3cGateBar } from './S3cGateBar';

afterEach(cleanup);

describe('S3cGateBar', () => {
  it('blocked: orange tag + count + the «Призначити решту…» escape', () => {
    const onAutoOther = vi.fn();
    const { container } = render(<LangProvider initialLang="uk"><S3cGateBar remainderCount={4} onAutoOther={onAutoOther} lang="uk" /></LangProvider>);
    expect(screen.getByText(/НЕ ВСІ КАТЕГОРИЗОВАНІ/)).toBeTruthy();
    expect(screen.getByText(/4 операцій ще без категорії/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Призначити решту/)); expect(onAutoOther).toHaveBeenCalled();
    expect(container.querySelector('.gate.blocked')).toBeTruthy();
  });
  it('open (zero remainder): green tag, no escape button', () => {
    const { container } = render(<LangProvider initialLang="uk"><S3cGateBar remainderCount={0} onAutoOther={() => {}} lang="uk" /></LangProvider>);
    expect(screen.getByText(/УСІ КАТЕГОРИЗОВАНІ/)).toBeTruthy();
    expect(container.querySelector('.gate.open')).toBeTruthy();
    expect(screen.queryByText(/Призначити решту/)).toBeNull();
  });
});
