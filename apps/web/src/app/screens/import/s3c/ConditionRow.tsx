/**
 * ConditionRow — one row of the builder: field select × operator select ×
 * ValueInput × remove.  Bound to ConditionDTO + the available ConditionFieldDTO
 * list.  Presentational: `onChange(nextCondition)` / `onRemove()` out.
 *
 * Changing the FIELD re-seeds the condition (operator → the field's first valid
 * op, value → the kind default).  Changing the OPERATOR re-defaults the value
 * (the prototype's `defaultValue(field, op)` rule — a kind-shaped empty).
 */
import { ValueInput } from './ValueInput';
import { fieldLabel, operatorLabel } from './labels';
import { useT } from '../../../i18n/LangProvider';
import type { ConditionDTO, ConditionFieldDTO } from '@abc-budget/engine';
import './s3c.css';

export interface ConditionRowProps {
  fields: ConditionFieldDTO[];
  condition: ConditionDTO;
  onChange: (next: ConditionDTO) => void;
  onRemove: () => void;
  lang: 'uk' | 'en';
}

/** Kind-shaped empty default for a freshly (re)seeded value. */
export function defaultValueFor(field: ConditionFieldDTO): unknown {
  switch (field.valueKind) {
    case 'num':
    case 'day':
      return '';
    case 'num2':
    case 'day2':
      return ['', ''];
    case 'optset':
      return [];
    case 'optone':
    case 'code':
      return field.options?.[0]?.value ?? '';
    case 'bool':
      return false;
    default:
      return '';
  }
}

export function ConditionRow({ fields, condition, onChange, onRemove, lang: _lang }: ConditionRowProps) {
  const t = useT();
  const field = fields.find((f) => f.field === condition.field) ?? fields[0];

  const onFieldChange = (nextFieldId: string) => {
    const nextField = fields.find((f) => f.field === nextFieldId) ?? fields[0];
    onChange({
      field: nextField.field,
      operator: nextField.operators[0] ?? condition.operator,
      value: defaultValueFor(nextField),
    });
  };

  const onOperatorChange = (nextOp: string) => {
    onChange({ ...condition, operator: nextOp, value: defaultValueFor(field) });
  };

  return (
    <div className="cond-row">
      <div className="cream cb-sel cb-field">
        <select value={condition.field} onChange={(e) => onFieldChange(e.target.value)} aria-label="field">
          {fields.map((f) => (
            <option key={f.field} value={f.field}>
              {fieldLabel(f.field, t)}
            </option>
          ))}
        </select>
      </div>
      <div className="cream cb-sel cb-op">
        <select value={condition.operator} onChange={(e) => onOperatorChange(e.target.value)} aria-label="operator">
          {field.operators.map((op) => (
            <option key={op} value={op}>
              {operatorLabel(op, t)}
            </option>
          ))}
        </select>
      </div>
      <ValueInput field={field} condition={condition} onChange={(value) => onChange({ ...condition, value })} />
      <button type="button" className="cb-rm" onClick={onRemove} aria-label={t('s3cBldRemove')}>
        ✕
      </button>
    </div>
  );
}
