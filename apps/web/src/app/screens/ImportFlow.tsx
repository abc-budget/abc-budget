import { useMemo, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import { Key, Lamp, Panel, PanelBody, PanelHeader } from '../../ui/altus/components';
import { useEngineClient } from '../engine-client-context';
import { FlowHeader } from '../headers';
import { useT } from '../i18n/LangProvider';
import { ImportSessionContext } from './import/import-session-context';
import { S3aSource } from './import/s3a/S3aSource';
import { useS3aSession } from './import/s3a/use-s3a-session';
import './import/s3a/s3a.css';

/**
 * Launched flow (FEAT-030): single route, internal step state — gates are state
 * transitions, structurally unbypassable by URL.
 *
 * 2.7: the 1.5 always-open stub dies — gate #1 is REAL: step 0 advances iff the
 * S3a session is recognized OR unknown (both legitimate proceed paths,
 * FEAT-009); idle/decoding/error keep Next disabled. The session hook lives
 * HERE (not in S3aSource) so it survives step changes — ImportSessionContext
 * hands {sessionId, snapshot} to S3b at 2.8.
 *
 * useBlocker exit-protection (1.5 carry-forward): any router navigation while
 * a session exists → altus confirm modal; Leave → importAbort THEN proceed;
 * Stay → reset the blocker. Steps are internal state, so every blocked
 * navigation IS a flow exit.
 */
export function ImportFlow() {
  const navigate = useNavigate();
  const t = useT();
  const client = useEngineClient();
  const session = useS3aSession(client);

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

  /** Gate #1 (real, 2.7): per-step predicates — s3b/s3c gates land with 2.8+. */
  const canAdvance = () =>
    step.id === 's3a' ? session.state === 'recognized' || session.state === 'unknown' : true;
  const nextEnabled = canAdvance();

  /** Exit-protection: blocker is active iff a worker-side session exists. */
  const blocker = useBlocker(session.sessionId !== null);

  const importSession = useMemo(
    () => ({ sessionId: session.sessionId, snapshot: session.snapshot }),
    [session.sessionId, session.snapshot],
  );

  return (
    <div className="shell" data-testid="screen-import">
      <FlowHeader steps={STEPS.map(({ id, label }) => ({ id, label }))} activeIndex={stepIndex} />
      <main className="screen-body">
        <ImportSessionContext.Provider value={importSession}>
          {step.id === 's3a' ? (
            <>
              <div className="s3-head">
                <div className="f-mono ob-eyebrow">{t('s3aEyebrow')}</div>
                <h1 className="f-disp s3-title">{t('s3aTitle')}</h1>
                <p className="body-p s3-lead">{t('s3aLead')}</p>
              </div>
              <S3aSource session={session} />
            </>
          ) : (
            <Panel screws>
              <PanelHeader logchip={step.logchip} title={step.title} />
              <PanelBody>
                <p className="body-p">{step.note}</p>
              </PanelBody>
            </Panel>
          )}
        </ImportSessionContext.Provider>
        <div className="flow-footer">
          <Key
            variant="beige"
            sm
            onClick={() => (isFirst ? navigate('/dashboard') : setStepIndex(stepIndex - 1))}
          >
            {t('keyBack')}
          </Key>
          {!isLast ? (
            <Key
              variant="gold"
              disabled={!nextEnabled}
              aria-disabled={!nextEnabled}
              onClick={() => nextEnabled && setStepIndex(stepIndex + 1)}
            >
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
      {blocker.state === 'blocked' && (
        <div className="modal-scrim" role="dialog" aria-modal="true" aria-label={t('s3aLeaveTitle')}>
          <div className="modal">
            <div className="modal-h">
              <Lamp tone="gold" />
              <span className="f-disp modal-title">{t('s3aLeaveTitle')}</span>
            </div>
            <p className="body-p modal-body">{t('s3aLeaveBody')}</p>
            <div className="modal-actions">
              <Key variant="beige" sm onClick={() => blocker.reset()}>
                {t('s3aLeaveStay')}
              </Key>
              <Key
                variant="orange"
                sm
                onClick={() => {
                  // abort FIRST (frees the worker-side stage graph), then leave
                  void session.abandon().finally(() => blocker.proceed());
                }}
              >
                {t('s3aLeaveLeave')}
              </Key>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
