import { useEffect, useState } from 'react';
import { useLang, useT } from '../../../i18n/LangProvider';
import { columnTypeLabel } from '../../../i18n/column-type-label';
import { Panel, PanelBody, PanelHeader, Key } from '../../../../ui/altus/components';
import { TypeGlyph } from './TypeGlyph';
import { MarkdownHelp } from './MarkdownHelp';
import { ParamField } from './ParamField';
import { TYPE_ORDER } from './type-order';
import { paramSchema, paramDefaults } from './param-schema';
import type { UiValues } from './param-schema';
import { helpFor } from './help-docs';
import type { MappingColumn } from './types';
import './s3b.css';

export interface ConfigWizardProps {
  column: MappingColumn;
  /**
   * Apply the chosen type + UI values.
   *
   * APPLY CONTRACT: the wizard emits the raw UI field values (`uiValues`); the
   * Task-4 container converts them to engine params via
   * `buildEngineParams(definition, uiValues)` (param-schema.ts) before calling
   * importApplyColumn.  This keeps the wizard pure (no engine-param construction
   * here).  uiValues is the merged option map + `${key}Custom` sub-values.
   */
  onApply: (definition: string, uiValues: UiValues) => void;
  onCancel: () => void;
}

/**
 * ConfigWizard — the «More» 2-step configurator.
 *
 * Ported from design-reference/s3b-app.jsx :: ConfigWizard.  Step 1 = the
 * TYPE_ORDER picker grid; step 2 = the per-type ParamField set + the scrollable
 * `cfg-helpdoc` MarkdownHelp (helpFor(type,lang)) + a preview of the column's
 * sample values.  A mapped column opens at step 2; an UNKNOWN one at step 1.
 */
export function ConfigWizard({ column, onApply, onCancel }: ConfigWizardProps) {
  const t = useT();
  const { lang } = useLang();
  const startUnknown = column.definition === null || column.definition === 'unknown';
  const startType = startUnknown ? 'amount' : column.definition!;

  const [step, setStep] = useState<1 | 2>(startUnknown ? 1 : 2);
  const [type, setType] = useState<string>(startType);
  const [values, setValues] = useState<UiValues>(() => paramDefaults(startType));

  // Reset field values to the selected type's defaults whenever the type changes.
  useEffect(() => {
    setValues(paramDefaults(type));
  }, [type]);

  const sampleValues = column.sampleCells
    .slice(0, 3)
    .map((c) => (c.value === null || c.value === undefined ? '' : c.value));
  const distinct = [...new Set(column.sampleCells.map((c) => c.value).filter((v): v is string => !!v))];
  const schema = paramSchema(type);
  const doc = helpFor(type, lang);

  function setValue(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  return (
    <Panel className="cfgpanel">
      <PanelHeader logchip="SET/" title={`${t('s3bCfgFor')} · ${column.rawName}`}>
        <span className="eyebrow-ink">{step === 1 ? t('s3bCfgStep1') : t('s3bCfgStep2')}</span>
      </PanelHeader>
      <PanelBody>
        {step === 1 ? (
          <div className="cfg-types" role="radiogroup" aria-label={t('s3bCfgStep1')}>
            {TYPE_ORDER.map((key) => (
              <button
                type="button"
                key={key}
                role="radio"
                aria-checked={type === key}
                className={`cfg-type${type === key ? ' sel' : ''}`}
                onClick={() => setType(key)}
              >
                <span className="cfg-type-ic">
                  <TypeGlyph name={key} size={18} />
                </span>
                <span className="cfg-type-lab f-disp">{columnTypeLabel(key, lang)}</span>
                {type === key && (
                  <span className="cfg-type-tick" aria-hidden="true">
                    ✓
                  </span>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="cfg-config">
            <div className="cfg-help">
              <span className="cfg-help-ic">
                <TypeGlyph name={type} size={20} />
              </span>
              <div className="cfg-help-head">
                <div className="cfg-help-type f-disp">{columnTypeLabel(type, lang)}</div>
              </div>
            </div>

            {doc ? (
              <div className="cfg-helpdoc">
                <MarkdownHelp md={doc} />
              </div>
            ) : (
              <div className="cfg-helpdoc cfg-helpdoc-empty f-mono">
                ▸ {lang === 'uk' ? 'довідку для цього типу ще не написано' : 'help for this type isn’t written yet'}
              </div>
            )}

            {schema.length > 0 ? (
              <div className="cfg-fields">
                {schema.map((f) => (
                  <ParamField key={f.key} field={f} value={values} onChange={setValue} distinct={distinct} />
                ))}
              </div>
            ) : (
              <div className="cfg-nodefault f-mono">
                ▸{' '}
                {lang === 'uk'
                  ? 'Без параметрів · цей тип не потребує налаштування'
                  : 'No parameters · this type needs no configuration'}
              </div>
            )}

            <div className="cfg-preview">
              <div className="cfg-prev-lab f-mono">{t('s3bCfgPreview')}</div>
              <div className="cfg-prev-vals">
                {sampleValues.map((v, i) => (
                  <span key={i} className="f-mono">
                    {v === '' ? '—' : v}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="cfg-actions">
          {step === 2 ? (
            <Key variant="beige" sm onClick={() => setStep(1)}>
              {t('s3bCfgBack')}
            </Key>
          ) : (
            <Key variant="beige" sm onClick={onCancel}>
              {t('s3bCfgCancel')}
            </Key>
          )}
          {step === 1 ? (
            <Key variant="gold" sm onClick={() => setStep(2)}>
              {t('s3bNext')}
            </Key>
          ) : (
            <Key variant="green" sm onClick={() => onApply(type, values)}>
              {t('s3bCfgApply')}
            </Key>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
