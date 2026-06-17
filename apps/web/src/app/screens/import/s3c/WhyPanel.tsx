/**
 * WhyPanel — the LOG/ "why this category?" explainer.  Renders the operation
 * row, then per-rule evaluation: a Lamp (green=win / orange=miss / gray=neutral
 * short-circuit), the per-condition met-state (✓/✗/neutral), and the category
 * the rule assigns.  A manual-override notice is shown read-only.
 *
 * NO Reorder / Edit / SetManual actions — those are the 4.9b management surface.
 * Bound to WhyTreeDTO + CategorizedRowDTO + a category Map.
 */
import { CatChip } from './CatChip';
import { condText, formatOpDate } from './labels';
import { Panel, PanelHeader, PanelBody } from '../../../../ui/altus/components/Panel';
import { Lamp } from '../../../../ui/altus/components/Lamp';
import { Chip } from '../../../../ui/altus/components/Chip';
import { CatIcon } from '../../../../ui/altus/icons';
import { useT } from '../../../i18n/LangProvider';
import type { CategorizedRowDTO, CategoryDTO, WhyRuleDTO, WhyTreeDTO } from '@abc-budget/engine';
import './s3c.css';

export interface WhyPanelProps {
  why: WhyTreeDTO;
  row: CategorizedRowDTO;
  categories: Map<string, CategoryDTO>;
  onClose: () => void;
  lang: 'uk' | 'en';
}

const CURRENCY_SYMBOL: Record<string, string> = { UAH: '₴', USD: '$', EUR: '€', GBP: '£' };
function fmtAmount(amount: number, currency: string): string {
  const v = Math.abs(amount).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${amount < 0 ? '−' : ''}${v} ${CURRENCY_SYMBOL[currency] ?? currency}`;
}

function lampTone(status: WhyRuleDTO['status']): 'green' | 'orange' | 'gray' {
  return status === 'win' ? 'green' : status === 'miss' ? 'orange' : 'gray';
}

export function WhyPanel({ why, row, categories, onClose, lang }: WhyPanelProps) {
  const t = useT();
  const manualCat = why.manual ? categories.get(why.manual.categoryId) : undefined;
  const hasWin = why.rules.some((r) => r.status === 'win');

  return (
    <Panel className="whypanel">
      <PanelHeader logchip="LOG/" title={t('s3cWhyTitle')}>
        <Chip onClick={onClose}>✕ {t('s3cClose')}</Chip>
      </PanelHeader>
      <PanelBody>
        {/* operation row — CONTENT (description) is user data, never translated (HC-6) */}
        <div className="crt why-op f-mono">
          {t('s3cWhyOp')}&nbsp;{' '}
          <span style={{ color: 'var(--cream)' }}>{row.description ?? '—'}</span> ·{' '}
          <span style={{ color: '#F2C637' }}>{fmtAmount(row.amount, row.currency)}</span> · {formatOpDate(row.date)}
        </div>

        {why.manual && (
          <div className="why-manual">
            <Lamp tone="orange" />
            <span className="f-mono">{t('s3cWhyManual')}</span>
            <CatChip category={manualCat} isManual lang={lang} />
          </div>
        )}

        <div className="why-evallab f-mono">{why.manual ? t('s3cWhyEvalLabManual') : t('s3cWhyEvalLab')}</div>
        {!why.manual && !hasWin && <div className="why-norule f-mono">▸ {t('s3cWhyNoRule')}</div>}

        {why.rules.map((rule) => {
          const cat = categories.get(rule.categoryId);
          return (
            <div key={rule.ruleId} className={`whyrow ${rule.status}`}>
              <span className="whyrow-lamp">
                <Lamp tone={lampTone(rule.status)} />
              </span>
              <div className="whyrow-body">
                <div className="whyrow-rule f-mono">
                  {rule.conditions.length === 0 ? (
                    <span>[ {t('s3cRuleRest')} ]</span>
                  ) : (
                    rule.conditions.map((c, j) => {
                      const cls = c.met === null ? 'n' : c.met ? 'y' : 'x';
                      return (
                        <span key={j}>
                          {j > 0 && <span className="rand">AND</span>}
                          <span className={`wcond ${cls}`}>
                            {condText({ field: c.field, operator: c.operator, value: c.value }, t)}
                            {c.met === true && ' ✓'}
                            {c.met === false && ' ✗'}
                          </span>
                        </span>
                      );
                    })
                  )}
                  <span className="rule-arrow">→</span>
                  <span className="rule-cat">
                    <CatIcon id={cat?.icon ?? 'other'} size={13} color="var(--ebony)" />
                    {cat?.name ?? '—'}
                  </span>
                </div>
                <div className={`whyrow-status f-mono ${rule.status}`}>
                  {rule.status === 'win' && `// ✓ ${t('s3cWhyWinner')}`}
                  {rule.status === 'miss' && `// ✗ ${t('s3cWhyMiss')}`}
                  {rule.status === 'neutral' && `// ${t('s3cWhyNeutral')}`}
                </div>
              </div>
            </div>
          );
        })}
      </PanelBody>
    </Panel>
  );
}
