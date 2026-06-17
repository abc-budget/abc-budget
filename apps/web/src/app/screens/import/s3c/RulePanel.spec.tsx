import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RulePanel } from './RulePanel';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { cat, categoryMap, cond, FIELDS, rule, RULES_MULTI } from './fixtures';
import type { RuleSummaryDTO } from '@abc-budget/engine';

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const defaultRulesProps = {
  editingId: null as number | null,
  onEditRule: vi.fn(),
  onDeleteRule: vi.fn(),
  onReorder: vi.fn(),
  saveLane: 'live' as 'live' | 'sandbox',
  engaged: false,
};

function renderRules(
  over: {
    tab?: 'build' | 'rules';
    rules?: RuleSummaryDTO[];
    lang?: Lang;
    editingId?: number | null;
    onEditRule?: (rule: RuleSummaryDTO) => void;
    onDeleteRule?: (ruleId: number) => void;
    onReorder?: (order: number[]) => void;
    saveLane?: 'live' | 'sandbox';
    engaged?: boolean;
  } = {},
) {
  return render(
    <LangProvider initialLang={over.lang ?? 'uk'}>
      <RulePanel
        tab={over.tab ?? 'rules'}
        onTab={vi.fn()}
        fields={[]}
        draft={[]}
        onDraft={vi.fn()}
        draftCategoryId={null}
        categories={categoryMap(cat({ id: 'groceries', name: 'Продукти' }), cat({ id: 'transport', name: 'Транспорт', icon: 'transport', currency: 'UAH' }), cat({ id: 'travel', name: 'Подорожі', icon: 'travel', currency: 'USD' }))}
        onPickCategory={vi.fn()}
        rules={over.rules ?? [rule({ ruleId: 1, appliedCount: 7 })]}
        liveMatchCount={3}
        onSave={vi.fn()}
        onCreateCategory={vi.fn()}
        lang={over.lang ?? 'uk'}
        editingId={over.editingId ?? defaultRulesProps.editingId}
        onEditRule={over.onEditRule ?? defaultRulesProps.onEditRule}
        onDeleteRule={over.onDeleteRule ?? defaultRulesProps.onDeleteRule}
        onReorder={over.onReorder ?? defaultRulesProps.onReorder}
        saveLane={over.saveLane ?? defaultRulesProps.saveLane}
        engaged={over.engaged ?? defaultRulesProps.engaged}
      />
    </LangProvider>,
  );
}

function renderBuild(
  over: {
    tab?: 'build' | 'rules';
    draft?: import('@abc-budget/engine').ConditionDTO[];
    draftCategoryId?: string | null;
    lang?: Lang;
    editingId?: number | null;
    saveLane?: 'live' | 'sandbox';
    engaged?: boolean;
    onEditRule?: (rule: RuleSummaryDTO) => void;
    onDeleteRule?: (ruleId: number) => void;
    onReorder?: (order: number[]) => void;
  } = {},
) {
  return render(
    <LangProvider initialLang={over.lang ?? 'uk'}>
      <RulePanel
        tab={over.tab ?? 'build'}
        onTab={vi.fn()}
        fields={FIELDS}
        draft={over.draft ?? []}
        onDraft={vi.fn()}
        draftCategoryId={over.draftCategoryId ?? null}
        categories={categoryMap(cat({ id: 'groceries', name: 'Продукти' }))}
        onPickCategory={vi.fn()}
        rules={[]}
        liveMatchCount={0}
        onSave={vi.fn()}
        onCreateCategory={vi.fn()}
        lang={over.lang ?? 'uk'}
        editingId={over.editingId ?? null}
        onEditRule={over.onEditRule ?? vi.fn()}
        onDeleteRule={over.onDeleteRule ?? vi.fn()}
        onReorder={over.onReorder ?? vi.fn()}
        saveLane={over.saveLane ?? 'live'}
        engaged={over.engaged ?? false}
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

  it('the ALTUS rule-row pixel classes are present', () => {
    const { container } = renderRules();
    expect(container.querySelector('.rule-row')).toBeTruthy();
    expect(container.querySelector('.rule-conds')).toBeTruthy();
    expect(container.querySelector('.panel')).toBeTruthy();
  });
});

describe('RulePanel — edit / delete / reorder (4.9b)', () => {
  it('rules list now exposes Edit + Delete + reorder (drag handle + ↑↓)', () => {
    const { container } = renderRules({ rules: RULES_MULTI });
    expect(container.querySelector('.rule-edit-btn')).toBeTruthy();
    expect(container.querySelector('.rule-del-btn')).toBeTruthy();
    expect(container.querySelector('.rule-handle')).toBeTruthy();
    expect(container.querySelectorAll('.rule-move').length).toBeGreaterThan(0); // mobile ↑↓
  });

  it('clicking Edit fires onEditRule with the rule', () => {
    const onEditRule = vi.fn();
    renderRules({ rules: RULES_MULTI, onEditRule });
    fireEvent.click(screen.getAllByText(/Змінити/)[0].closest('button')!);
    expect(onEditRule).toHaveBeenCalledWith(RULES_MULTI[0]);
  });

  it('mobile ↓ on rule 1 reorders it below rule 2 (ruleIds new order)', () => {
    const onReorder = vi.fn();
    renderRules({ rules: RULES_MULTI, onReorder });
    fireEvent.click(screen.getAllByLabelText('Вниз')[0]);
    expect(onReorder).toHaveBeenCalledWith([2, 1, 3]); // R1 and R2 swapped, by ruleId
  });

  it('dynamic save button: editing + sandbox lane + not engaged → orange «Переглянути зміни»', () => {
    renderBuild({ editingId: 1, saveLane: 'sandbox', engaged: false, draft: [cond()], draftCategoryId: 'groceries' });
    const btn = screen.getByText(/Переглянути зміни ▸/).closest('button')!;
    expect(btn.className).toContain('orange');
  });

  it('dynamic save button: editing + live lane → gold «Оновити правило»', () => {
    renderBuild({ editingId: 1, saveLane: 'live', engaged: false, draft: [cond()], draftCategoryId: 'groceries' });
    expect(screen.getByText('Оновити правило').closest('button')!.className).toContain('gold');
  });
});
