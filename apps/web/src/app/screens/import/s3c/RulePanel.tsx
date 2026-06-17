/**
 * RulePanel — the RUL/ side panel.  Two tabs:
 *   Build  — ConditionBuilder + CategoryPicker + "Save as rule".
 *   Rules  — search + a READ-ONLY first-match-wins list (condition chips →
 *            CatChip, appliedCount).  NO edit / delete / reorder controls — that
 *            is the 4.9b rule-management surface; 4.9a only READS the tree.
 *
 * Bound to RuleSummaryDTO[] + ConditionFieldDTO[] + a category Map.
 */
import { useState } from 'react';
import { ConditionBuilder } from './ConditionBuilder';
import { CategoryPicker } from './CategoryPicker';
import { condText } from './labels';
import { SearchIcon, CheckIcon } from './icons';
import { CatIcon } from '../../../../ui/altus/icons';
import { Panel, PanelHeader, PanelBody } from '../../../../ui/altus/components/Panel';
import { Key } from '../../../../ui/altus/components/Key';
import { useT } from '../../../i18n/LangProvider';
import type {
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  RuleSummaryDTO,
} from '@abc-budget/engine';
import './s3c.css';

export type RuleTab = 'build' | 'rules';

export interface RulePanelProps {
  tab: RuleTab;
  onTab: (tab: RuleTab) => void;
  fields: ConditionFieldDTO[];
  draft: ConditionDTO[];
  onDraft: (next: ConditionDTO[]) => void;
  draftCategoryId: string | null;
  categories: Map<string, CategoryDTO>;
  onPickCategory: (categoryId: string) => void;
  rules: RuleSummaryDTO[];
  liveMatchCount: number;
  onSave: () => void;
  onCreateCategory: (name: string) => void;
  lang: 'uk' | 'en';
}

export function RulePanel({
  tab,
  onTab,
  fields,
  draft,
  onDraft,
  draftCategoryId,
  categories,
  onPickCategory,
  rules,
  liveMatchCount,
  onSave,
  onCreateCategory,
  lang,
}: RulePanelProps) {
  const t = useT();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const categoryList = [...categories.values()];
  const canSave = draft.length > 0 && draftCategoryId != null;

  const ruleMatches = (r: RuleSummaryDTO): boolean => {
    if (!query) return true;
    const cat = categories.get(r.categoryId);
    if (cat && cat.name.toLowerCase().includes(query)) return true;
    return r.conditions.some((c) => condText(c, t).toLowerCase().includes(query));
  };

  return (
    <Panel className="rulepanel">
      <PanelHeader logchip="RUL/" title={t('s3cRulesTitle')}>
        {tab === 'build' && draft.length > 0 && (
          <span className="eyebrow-ink">{t('s3cLiveMatch', { n: liveMatchCount })}</span>
        )}
      </PanelHeader>

      <div className="rul-tabs">
        <button type="button" className={`rul-tab${tab === 'build' ? ' on' : ''}`} onClick={() => onTab('build')}>
          {t('s3cTabBuild')}
        </button>
        <button type="button" className={`rul-tab${tab === 'rules' ? ' on' : ''}`} onClick={() => onTab('rules')}>
          {t('s3cTabRules')} ({rules.length})
        </button>
      </div>

      <PanelBody>
        {tab === 'build' ? (
          <>
            {draft.length === 0 && <div className="draft-empty f-mono">▸ {t('s3cDraftEmpty')}</div>}
            <ConditionBuilder conditions={draft} fields={fields} onChange={onDraft} lang={lang} />
            {draft.length > 0 && (
              <>
                <hr className="dash" style={{ margin: '13px 0 11px' }} />
                <span className="f-mono bulk-catlab">{t('s3cPickCat')}</span>
                <CategoryPicker
                  categories={categoryList}
                  currentId={draftCategoryId}
                  onPick={onPickCategory}
                  onCreate={onCreateCategory}
                  lang={lang}
                />
                <div className="rule-edit-actions">
                  <button type="button" className="key beige sm" onClick={() => onDraft([])}>
                    {t('s3cClearDraft')}
                  </button>
                  <Key variant="gold" sm disabled={!canSave} icon={<CheckIcon size={16} />} onClick={onSave}>
                    {t('s3cSaveAsRule')}
                  </Key>
                </div>
                <div className="bulk-note f-mono">{t('s3cCreateRuleNote')}</div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="cream catpicker-search rules-search">
              <SearchIcon size={14} />
              <input value={q} placeholder={t('s3cRulesSearch')} onChange={(e) => setQ(e.target.value)} />
            </div>
            {rules.length === 0 ? (
              <div className="catpicker-empty f-mono">— {t('s3cEmptyTag')} —</div>
            ) : (
              <>
                <div className="rules-firstmatch f-mono">▾ {t('s3cFirstMatch')}</div>
                <div className="rules-list rules-scroll">
                  {rules.filter(ruleMatches).map((r, i) => {
                    const cat = categories.get(r.categoryId);
                    return (
                      <div key={r.ruleId} className="rule-row">
                        <span className="rule-ord f-mono">{String(i + 1).padStart(2, '0')}</span>
                        <div className="rule-body">
                          <div className="rule-conds f-mono">
                            {r.conditions.length === 0 ? (
                              <span className="rcond rcond-all">[ {t('s3cRuleRest')} ]</span>
                            ) : (
                              r.conditions.map((c, j) => (
                                <span key={j}>
                                  {j > 0 && <span className="rand">AND</span>}
                                  <span className="rcond">{condText(c, t)}</span>
                                </span>
                              ))
                            )}
                            <span className="rule-arrow">{t('s3cRuleArrow')}</span>
                            <span className="rule-cat">
                              <CatIcon id={cat?.icon ?? 'other'} size={14} color="var(--ebony)" />
                              {cat?.name ?? '—'}
                            </span>
                          </div>
                          <div className="rule-meta">
                            <span className="rule-applied f-mono">{t('s3cApplied', { n: r.appliedCount })}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </PanelBody>
    </Panel>
  );
}
