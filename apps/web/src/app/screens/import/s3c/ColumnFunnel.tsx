/**
 * ColumnFunnel — the per-column header funnel.  Opening it lists the field's
 * operators; picking one seeds a draft condition (`onPick(operator)` — the
 * screen builds the ConditionDTO from field+operator).  Open state is owned by
 * the parent (`isOpen` / `onToggle`) so only one funnel opens at a time.
 */
import { FunnelIcon } from './icons';
import { fieldLabel, operatorLabel } from './labels';
import { useT } from '../../../i18n/LangProvider';
import type { ConditionFieldDTO } from '@abc-budget/engine';
import './s3c.css';

export interface ColumnFunnelProps {
  field: ConditionFieldDTO;
  active: boolean;
  onPick: (operator: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  lang: 'uk' | 'en';
}

export function ColumnFunnel({ field, active, onPick, isOpen, onToggle, lang: _lang }: ColumnFunnelProps) {
  const t = useT();
  return (
    <span className="colfunnel-wrap">
      <button
        type="button"
        className={`colfunnel${active ? ' active' : ''}${isOpen ? ' open' : ''}`}
        title={t('s3cFunnelTitle')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
      >
        <FunnelIcon size={13} />
      </button>
      {isOpen && (
        <div className="funnel-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          <div className="funnel-head f-mono">{fieldLabel(field.field, t)}</div>
          {field.operators.map((op) => (
            <button
              type="button"
              key={op}
              className="funnel-item f-mono"
              role="menuitem"
              onClick={() => {
                onPick(op);
                onToggle();
              }}
            >
              {operatorLabel(op, t)}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
