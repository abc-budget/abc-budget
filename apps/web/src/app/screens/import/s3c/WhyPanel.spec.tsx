import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WhyPanel } from './WhyPanel';
import { LangProvider } from '../../../i18n/LangProvider';
import { cat, categoryMap, row, whyTree } from './fixtures';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderWhy(over: Parameters<typeof whyTree>[0] = {}) {
  return render(
    <LangProvider initialLang="uk">
      <WhyPanel
        why={whyTree(over)}
        row={row()}
        categories={categoryMap(
          cat({ id: 'groceries', name: 'Продукти' }),
          cat({ id: 'dining', name: 'Кафе', icon: 'dining' }),
          cat({ id: 'other', name: 'Інше', icon: 'other' }),
        )}
        onClose={vi.fn()}
        lang="uk"
      />
    </LangProvider>,
  );
}

describe('WhyPanel', () => {
  it('renders a win / miss / neutral lamp for each evaluated rule', () => {
    const { container } = renderWhy();
    expect(container.querySelector('.whyrow.win .lamp.green')).toBeTruthy();
    expect(container.querySelector('.whyrow.miss .lamp.orange')).toBeTruthy();
    expect(container.querySelector('.whyrow.neutral .lamp.gray')).toBeTruthy();
  });

  it('marks per-condition met-state (✓ / ✗ / neutral) with the wcond classes', () => {
    const { container } = renderWhy();
    expect(container.querySelector('.wcond.y')).toBeTruthy(); // met
    expect(container.querySelector('.wcond.x')).toBeTruthy(); // not met
    expect(container.querySelector('.wcond.n')).toBeTruthy(); // not evaluated
  });

  it('shows the read-only manual-override notice when manual wins', () => {
    const { container } = renderWhy({ manual: { categoryId: 'groceries' }, winnerRuleId: null });
    expect(container.querySelector('.why-manual')).toBeTruthy();
    expect(container.querySelector('.why-manual .lamp.orange')).toBeTruthy();
    // read-only: no reorder / edit / set-manual action chips
    expect(container.querySelector('.why-actions')).toBeNull();
    expect(container.querySelector('.why-reset')).toBeNull();
  });

  it('carries the ALTUS .panel / .logchip / .whyrow pixel classes', () => {
    const { container } = renderWhy();
    expect(container.querySelector('.panel')).toBeTruthy();
    expect(container.querySelector('.logchip')?.textContent).toBe('LOG/');
    expect(container.querySelector('.whyrow')).toBeTruthy();
  });
});
