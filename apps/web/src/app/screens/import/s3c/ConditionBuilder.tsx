/**
 * ConditionBuilder — the AND-combined list of ConditionRows that defines a rule
 * draft.  Bound to ConditionDTO[].  Presentational: `onChange(nextConditions)`.
 *
 * Amount-requires-currency UX (the prototype `enforceCurrency` invariant): when
 * ANY condition is on the amount field, the pairing NOTE is shown AND a currency
 * input is surfaced on each amount condition (comparing an amount without a
 * currency is meaningless — HC).  The currency rides on `ConditionDTO.currency`.
 */
import { ConditionRow, defaultValueFor } from './ConditionRow';
import { useT } from '../../../i18n/LangProvider';
import type { ConditionDTO, ConditionFieldDTO } from '@abc-budget/engine';
import './s3c.css';

export interface ConditionBuilderProps {
  conditions: ConditionDTO[];
  fields: ConditionFieldDTO[];
  onChange: (next: ConditionDTO[]) => void;
  lang: 'uk' | 'en';
}

const AMOUNT_FIELDS = new Set(['amount']);
/** ISO currencies offered when an amount condition needs its mandatory pairing. */
const CURRENCY_OPTIONS = ['UAH', 'USD', 'EUR', 'GBP'] as const;

function isAmount(c: ConditionDTO): boolean {
  return AMOUNT_FIELDS.has(c.field);
}

export function ConditionBuilder({ conditions, fields, onChange, lang }: ConditionBuilderProps) {
  const t = useT();
  const hasAmount = conditions.some(isAmount);

  const update = (i: number, next: ConditionDTO) => onChange(conditions.map((c, j) => (j === i ? next : c)));
  const remove = (i: number) => onChange(conditions.filter((_, j) => j !== i));
  const add = () => {
    const preferred = fields.find((f) => f.field === 'description') ?? fields[0];
    if (!preferred) return;
    onChange([
      ...conditions,
      { field: preferred.field, operator: preferred.operators[0] ?? '', value: defaultValueFor(preferred) },
    ]);
  };

  return (
    <div className="cond-builder">
      {conditions.map((c, i) => {
        const amountRow = isAmount(c);
        return (
          <div key={i}>
            {i > 0 && <div className="cond-and f-mono">{t('s3cBldAnd')}</div>}
            <ConditionRow
              fields={fields}
              condition={c}
              onChange={(next) => update(i, next)}
              onRemove={() => remove(i)}
              lang={lang}
            />
            {amountRow && (
              // amount MUST carry a currency — surface the mandatory pairing input
              <div className="cond-row" data-testid="amount-currency-row">
                <span className="cond-and f-mono">{t('s3cBldCurLab')}</span>
                <div className="cream cb-cur">
                  <select
                    aria-label={t('s3cBldCurLab')}
                    value={c.currency ?? CURRENCY_OPTIONS[0]}
                    onChange={(e) => update(i, { ...c, currency: e.target.value })}
                  >
                    {CURRENCY_OPTIONS.map((iso) => (
                      <option key={iso} value={iso}>
                        {iso}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div className="cond-foot">
        <button type="button" className="cond-add f-mono" onClick={add}>
          <span style={{ fontSize: 14 }} aria-hidden="true">
            ＋
          </span>{' '}
          {t('s3cBldAdd')}
        </button>
        {hasAmount && (
          <span className="cond-curnote f-mono" data-testid="currency-pair-note">
            ▸ {t('s3cBldCurPairNote')}
          </span>
        )}
      </div>
    </div>
  );
}
