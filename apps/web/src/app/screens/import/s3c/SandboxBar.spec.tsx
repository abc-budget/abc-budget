import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LangProvider } from '../../../i18n/LangProvider';
import { SandboxBar } from './SandboxBar';

afterEach(cleanup);
const renderBar = (over = {}) =>
  render(<LangProvider initialLang="uk"><SandboxBar count={2} changedOnly={false}
    onToggleChangedOnly={() => {}} onApply={() => {}} onCancel={() => {}} lang="uk" {...over} /></LangProvider>);

describe('SandboxBar', () => {
  it('shows the hazard tag + the pluralized diff count', () => {
    renderBar();
    expect(screen.getByText(/ВІРТУАЛЬНЕ ДЕРЕВО ПРАВИЛ/)).toBeTruthy();
    expect(screen.getByText(/2 операцій змінять категорію/)).toBeTruthy();
  });
  it('Apply / Cancel / Review fire their callbacks', () => {
    const onApply = vi.fn(), onCancel = vi.fn(), onToggle = vi.fn();
    renderBar({ onApply, onCancel, onToggleChangedOnly: onToggle });
    fireEvent.click(screen.getByText('Застосувати')); expect(onApply).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Скасувати')); expect(onCancel).toHaveBeenCalled();
    fireEvent.click(screen.getByText(/Переглянути зміни/)); expect(onToggle).toHaveBeenCalled();
  });
  it('disables Review when count is 0', () => {
    renderBar({ count: 0 });
    expect((screen.getByText(/Усі операції|Переглянути зміни/).closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
