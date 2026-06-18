import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AutoOtherModal } from './AutoOtherModal';
import { LangProvider } from '../../../i18n/LangProvider';
import { magnitude, CAT_GROCERIES, cat } from './fixtures';

afterEach(() => {
  cleanup();
});

describe('AutoOtherModal', () => {
  it('shows the «≈» base total + the per-currency pending tail + the op count; default = lastRemainderCategoryId', () => {
    render(
      <LangProvider initialLang="uk">
        <AutoOtherModal
          magnitude={magnitude()}
          categories={[CAT_GROCERIES, cat({ id: 'other', name: 'Інше', icon: 'other' })]}
          onConfirm={() => {}}
          onCancel={() => {}}
          onCreateCategory={() => {}}
          lang="uk"
        />
      </LangProvider>,
    );
    expect(screen.getByText('≈')).toBeTruthy();
    expect(screen.getByText(/USD/)).toBeTruthy(); // the pending tail currency
    expect(screen.getByText(/3/)).toBeTruthy(); // opCount
  });

  it('confirm fires onConfirm with the chosen category', () => {
    const onConfirm = vi.fn();
    render(
      <LangProvider initialLang="uk">
        <AutoOtherModal
          magnitude={magnitude({ lastRemainderCategoryId: 'other' })}
          categories={[cat({ id: 'other', name: 'Інше', icon: 'other' })]}
          onConfirm={onConfirm}
          onCancel={() => {}}
          onCreateCategory={() => {}}
          lang="uk"
        />
      </LangProvider>,
    );
    fireEvent.click(screen.getByText(/Призначити решту/));
    expect(onConfirm).toHaveBeenCalledWith('other'); // default picker = lastRemainderCategoryId
  });
});
