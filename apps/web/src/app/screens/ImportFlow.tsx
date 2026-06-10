import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Key, Panel, PanelBody, PanelHeader } from '../../ui/altus/components';
import { FlowHeader } from '../headers';

const STEPS = [
  { id: 's3a', label: 'ФАЙЛ', logchip: 'S3A', title: 'Джерело', note: 'Завантаження файлу — EP-2.1 (the wedge).' },
  { id: 's3b', label: 'КОЛОНКИ', logchip: 'S3B', title: 'Колонки', note: 'Мапінг колонок + UNKNOWN-gate — EP-2.' },
  { id: 's3c', label: 'КАТЕГОРІЇ', logchip: 'S3C', title: 'Категоризація', note: 'Правила, RUL/, LOG/ — EP-4.' },
  { id: 's3d', label: 'ОГЛЯД', logchip: 'S3D', title: 'Огляд і збереження', note: 'Збереження footprint — EP-3.' },
];

/**
 * Launched flow (FEAT-030): single route, internal step state — gates are state
 * transitions, structurally unbypassable by URL. Gate stubs are always-open;
 * EP-2 swaps in real predicates. EP-2 carry-forward: useBlocker exit protection.
 */
export function ImportFlow() {
  const navigate = useNavigate();
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
            Назад
          </Key>
          {!isLast ? (
            <Key variant="gold" onClick={() => canAdvance() && setStepIndex(stepIndex + 1)}>
              Далі
            </Key>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--sp-m)' }}>
              <Key variant="beige" onClick={() => setStepIndex(0)}>Імпортувати ще</Key>
              <Key variant="gold" onClick={() => navigate('/dashboard')}>До бюджету</Key>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
