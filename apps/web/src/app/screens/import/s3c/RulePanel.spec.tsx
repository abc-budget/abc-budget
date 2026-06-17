import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { RulePanel } from './RulePanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { cat, categoryMap, rule } from './fixtures';
import type { RuleSummaryDTO } from '@abc-budget/engine';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function renderRules(over: { tab?: 'build' | 'rules'; rules?: RuleSummaryDTO[]; lang?: Lang } = {}) {
  return render(
    <LangProvider initialLang={over.lang ?? 'uk'}>
      <RulePanel
        tab={over.tab ?? 'rules'}
        onTab={vi.fn()}
        fields={[]}
        draft={[]}
        onDraft={vi.fn()}
        draftCategoryId={null}
        categories={categoryMap(cat({ id: 'groceries', name: 'Продукти' }))}
        onPickCategory={vi.fn()}
        rules={over.rules ?? [rule({ ruleId: 1, appliedCount: 7 })]}
        liveMatchCount={3}
        onSave={vi.fn()}
        onCreateCategory={vi.fn()}
        lang={over.lang ?? 'uk'}
      />
    </LangProvider>,
  );
}

describe('RulePanel — Rules tab (read-only · 4.9a)', () => {
  it('shows the first-match-wins banner + the rule appliedCount', () => {
    const { container } = renderRules();
    expect(container.querySelector('.rules-firstmatch')?.textContent).toContain('ПЕРШЕ ЗБІГ ПЕРЕМАГАЄ');
    expect(screen.getByText('7 оп.')).toBeTruthy();
  });

  it('renders the → CatChip target (category glyph + name)', () => {
    renderRules();
    expect(screen.getByText('Продукти')).toBeTruthy();
  });

  it('has NO edit / delete / reorder controls (4.9b management surface)', () => {
    const { container } = renderRules();
    expect(container.querySelector('.rule-edit-btn')).toBeNull();
    expect(container.querySelector('.rule-del-btn')).toBeNull();
    expect(container.querySelector('.rule-handle')).toBeNull();
    // no drag affordance either
    expect(container.querySelector('[draggable="true"]')).toBeNull();
    expect(container.querySelector('.drag-tip')).toBeNull();
  });

  it('the ALTUS rule-row pixel classes are present', () => {
    const { container } = renderRules();
    expect(container.querySelector('.rule-row')).toBeTruthy();
    expect(container.querySelector('.rule-conds')).toBeTruthy();
    expect(container.querySelector('.panel')).toBeTruthy();
  });
});
