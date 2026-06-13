import { useLang } from '../../../i18n/LangProvider';
import { Cream } from '../../../../ui/altus/components';
import type { ParamField as ParamFieldSchema, UiValues } from './param-schema';
import './s3b.css';

export interface ParamFieldProps {
  field: ParamFieldSchema;
  value: UiValues;
  /** Update a UI value key (the option key, or `${key}Custom` for the sub-value). */
  onChange: (key: string, val: string) => void;
  /** Distinct sample values (for the 'select' custom sub-control, e.g. status). */
  distinct?: string[];
}

/**
 * ParamField — one config field: a segmented radio control + an optional custom
 * sub-control (free-text input or a distinct-value select).
 *
 * Ported from design-reference/s3b-app.jsx :: ParamField.  The custom value is
 * stored under `${field.key}Custom` (matching param-schema.ts buildEngineParams,
 * which reads `currencyCustom` / `formatCustom` / `successValueCustom`).
 * Pure: props in, onChange(key, val) out.
 */
export function ParamField({ field, value, onChange, distinct = [] }: ParamFieldProps) {
  const { lang } = useLang();
  const cur = value[field.key] ?? field.def;
  const customKey = `${field.key}Custom`;
  const activeOpt = field.options.find((o) => o.val === cur);

  return (
    <div className="cfg-field">
      <span className="cfg-flab f-mono">{field.label[lang]}</span>
      <div className="seg sm wrap" role="radiogroup" aria-label={field.label[lang]}>
        {field.options.map((o) => (
          <button
            type="button"
            key={o.val}
            role="radio"
            aria-checked={cur === o.val}
            className={`seg-btn${cur === o.val ? ' on' : ''}`}
            onClick={() => onChange(field.key, o.val)}
            title={o.hint ? o.hint[lang] : undefined}
          >
            {o.label[lang]}
          </button>
        ))}
      </div>
      {activeOpt?.hint && <span className="cfg-hint f-mono">{activeOpt.hint[lang]}</span>}
      {field.custom && cur === field.custom.when && (
        <div className="cfg-custom">
          <span className="cfg-clab f-mono">{field.custom.label[lang]}</span>
          {field.custom.kind === 'text' ? (
            <Cream className="cfg-cinput">
              <input
                className="f-mono"
                placeholder={field.custom.placeholder}
                value={value[customKey] ?? ''}
                aria-label={field.custom.label[lang]}
                onChange={(e) => onChange(customKey, e.target.value)}
              />
            </Cream>
          ) : (
            <div className="seg sm wrap" role="radiogroup" aria-label={field.custom.label[lang]}>
              {distinct.map((d) => (
                <button
                  type="button"
                  key={d}
                  role="radio"
                  aria-checked={value[customKey] === d}
                  className={`seg-btn${value[customKey] === d ? ' on' : ''}`}
                  onClick={() => onChange(customKey, d)}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
