import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CollisionBanner } from './CollisionBanner';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderBanner(lang: Lang = 'uk') {
  const onConfirm = vi.fn();
  const onDecline = vi.fn();
  const utils = render(
    <LangProvider initialLang={lang}>
      <CollisionBanner columnName="Сума" onConfirm={onConfirm} onDecline={onDecline} />
    </LangProvider>,
  );
  return { ...utils, onConfirm, onDecline };
}

describe('CollisionBanner (loud save-collision affordance, decision #5)', () => {
  it('is loud + persistent: own .collbanner block, role=alert, names the column', () => {
    const { container } = renderBanner();
    const banner = screen.getByTestId('collision-banner');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(container.querySelector('.collbanner')).toBeTruthy();
    expect(container.querySelector('.collbanner-lamp')).toBeTruthy();
    expect(banner.textContent).toContain('Сума');
  });

  it('confirm → onConfirm; decline → onDecline', () => {
    const { onConfirm, onDecline } = renderBanner();
    fireEvent.click(screen.getByRole('button', { name: /Оновити правило/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: /Лишити збережене/i }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('resolves en copy', () => {
    renderBanner('en');
    expect(screen.getByRole('button', { name: /Update the rule/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Keep saved/i })).toBeTruthy();
    expect(screen.getByTestId('collision-banner').textContent).toContain('saved rule');
  });
});
