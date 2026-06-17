/**
 * ValueInput — renders the right value widget for a condition, keyed off the
 * field's `valueKind` (text/num/num2/day/day2/code/optone/optset/regex/bool).
 * Options come from `field.options`.  Pure: `onChange(nextValue)` out.
 *
 * Bound to ConditionFieldDTO + ConditionDTO natively.  The value is `unknown` on
 * the wire — each branch narrows it locally for its widget.
 */
import { useT } from '../../../i18n/LangProvider';
import type { ConditionDTO, ConditionFieldDTO } from '@abc-budget/engine';
import './s3c.css';

export interface ValueInputProps {
  field: ConditionFieldDTO;
  condition: ConditionDTO;
  onChange: (value: unknown) => void;
}

function asPair(value: unknown): [number | '', number | ''] {
  const arr = Array.isArray(value) ? value : [];
  return [arr[0] ?? '', arr[1] ?? ''];
}

export function ValueInput({ field, condition, onChange }: ValueInputProps) {
  const t = useT();
  const kind = field.valueKind;
  const value = condition.value;
  const options = field.options ?? [];

  if (kind === 'code' || kind === 'optone') {
    return (
      <div className="cream cb-sel">
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (kind === 'optset') {
    const selected = Array.isArray(value) ? (value as string[]) : [];
    return (
      <div className="cb-set">
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              type="button"
              key={o.value}
              className={on ? 'cb-chip on' : 'cb-chip'}
              aria-pressed={on}
              onClick={() => onChange(on ? selected.filter((v) => v !== o.value) : [...selected, o.value])}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  if (kind === 'bool') {
    return (
      <div className="cream cb-sel">
        <select value={value ? 'true' : 'false'} onChange={(e) => onChange(e.target.value === 'true')}>
          <option value="true">✓</option>
          <option value="false">✗</option>
        </select>
      </div>
    );
  }

  if (kind === 'num' || kind === 'day') {
    return (
      <div className="cream cb-num">
        <input
          type="number"
          value={value === '' || value == null ? '' : Number(value)}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        />
      </div>
    );
  }

  if (kind === 'num2' || kind === 'day2') {
    const [lo, hi] = asPair(value);
    return (
      <div className="cb-range">
        <div className="cream cb-num">
          <input type="number" value={lo} onChange={(e) => onChange([e.target.value === '' ? '' : Number(e.target.value), hi])} />
        </div>
        <span className="cb-dash" aria-hidden="true">
          –
        </span>
        <div className="cream cb-num">
          <input type="number" value={hi} onChange={(e) => onChange([lo, e.target.value === '' ? '' : Number(e.target.value)])} />
        </div>
      </div>
    );
  }

  // text | regex (and any unknown kind) → free-text input
  return (
    <div className="cream cb-txt">
      <input
        value={String(value ?? '')}
        placeholder={kind === 'regex' ? t('s3cBldRegexPh') : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
