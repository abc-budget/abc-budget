import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Key, Panel, PanelBody, PanelHeader } from '../../ui/altus/components';
import { FlowHeader } from '../headers';
import { useT } from '../i18n/LangProvider';

/**
 * Launched flow (FEAT-030): single route, internal step state — gates are state
 * transitions, structurally unbypassable by URL. Gate stubs are always-open;
 * EP-2 swaps in real predicates. EP-2 carry-forward: useBlocker exit protection.
 */
export function ImportFlow() {
  const navigate = useNavigate();
  const t = useT();

  const STEPS = [
    { id: 's3a', label: t('stepFile'), logchip: 'S3A', title: t('impSourceTitle'), note: t('impSourceNote') },
    { id: 's3b', label: t('stepColumns'), logchip: 'S3B', title: t('impColumnsTitle'), note: t('impColumnsNote') },
    { id: 's3c', label: t('stepCategories'), logchip: 'S3C', title: t('impCategoriesTitle'), note: t('impCategoriesNote') },
    { id: 's3d', label: t('stepReview'), logchip: 'S3D', title: t('impReviewTitle'), note: t('impReviewNote') },
  ];

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  /** The gate seam: EP-2 replaces with real per-step predicates (HC-8). */
  const canAdvance = () => true;

  return (
    <div className="shell" data-testid="screen-import">
      <FlowHeader steps={STEPS.map(({ id, label }) => ({ id, label }))} activeIndex={stepIndex} />
      <main className="screen-body">
        <Panel screws>
          <PanelHeader logchip={step.logchip} title={step.title} />
          <PanelBody>
            <p className="body-p">{step.note}</p>
          </PanelBody>
        </Panel>
        <div className="flow-footer">
          <Key
            variant="beige"
            sm
            onClick={() => (isFirst ? navigate('/dashboard') : setStepIndex(stepIndex - 1))}
          >
            {t('keyBack')}
          </Key>
          {!isLast ? (
            <Key variant="gold" onClick={() => canAdvance() && setStepIndex(stepIndex + 1)}>
              {t('keyNext')}
            </Key>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--sp-m)' }}>
              <Key variant="beige" onClick={() => setStepIndex(0)}>{t('keyImportMore')}</Key>
              <Key variant="gold" onClick={() => navigate('/dashboard')}>{t('keyToBudget')}</Key>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
