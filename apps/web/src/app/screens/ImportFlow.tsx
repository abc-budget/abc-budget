import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router';
import type { Stage2SnapshotDTO } from '@abc-budget/engine';
import { Key, Lamp, Panel, PanelBody, PanelHeader } from '../../ui/altus/components';
import { useEngineClient } from '../engine-client-context';
import { FlowHeader } from '../headers';
import { useT } from '../i18n/LangProvider';
import { ImportSessionContext } from './import/import-session-context';
import { BaseCurrencyDialog } from './import/s3a/BaseCurrencyDialog';
import { S3aSource } from './import/s3a/S3aSource';
import { useS3aSession } from './import/s3a/use-s3a-session';
import { S3bMapping } from './import/s3b/S3bMapping';
import { useS3bSession } from './import/s3b/use-s3b-session';
import './import/s3a/s3a.css';
import './import/s3b/s3b.css';

/**
 * A placeholder snapshot for the S3b hook BEFORE S3a establishes a session.
 * The S3b body never renders without a real session (it's step 2, reachable
 * only after gate #1), but the hook must be called unconditionally — it
 * re-seeds from the real snapshot the moment the sessionId arrives.
 */
const EMPTY_SNAPSHOT: Stage2SnapshotDTO = {
  columns: [],
  recognized: { n: 0, m: 0 },
  lastSaveCollision: null,
  unmapped: [],
};

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

  /**
   * Cold-start base-currency gate (2.7 Task 4, ENT-019): probe on /import
   * entry. null → BaseCurrencyDialog BEFORE any file work; non-null → straight
   * to S3a. While the probe is in flight the S3a body is simply withheld (one
   * IDB read — a single frame; no spinner, the step head/footer render as-is),
   * so a file drop physically cannot precede the probe's verdict.
   *
   * A probe REJECTION also routes to the gate: a flow that cannot read the
   * setting must not silently unlock; the subsequent setBaseCurrency then
   * fails LOUD inline in the dialog (HC-7) instead of vanishing here.
   */
  const [baseGate, setBaseGate] = useState<'probing' | 'ready' | 'needed'>('probing');
  useEffect(() => {
    let active = true;
    client.getBaseCurrency().then(
      (iso) => { if (active) setBaseGate(iso === null ? 'needed' : 'ready'); },
      () => { if (active) setBaseGate('needed'); },
    );
    return () => { active = false; };
  }, [client]);

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

  /**
   * S3b session (Story 2.8) — lives HERE so it survives step changes (the
   * snapshot must persist across S3b→«Назад»→S3a→forward) and so canAdvance #2
   * can read snapshot.unmapped.  Seeded from the S3a session; re-seeds when the
   * sessionId changes (S3a replace → fresh importStart → all-UNKNOWN).
   */
  const s3b = useS3bSession(client, session.sessionId ?? '', session.snapshot ?? EMPTY_SNAPSHOT);

  /**
   * S3b gate state (Option A): «Далі» is always active at step 2; the press
   * resolves to a BLOCK overlay (≥1 unmapped) or the WORKER takeover (advance).
   */
  const [s3bView, setS3bView] = useState<'mapping' | 'block' | 'worker'>('mapping');
  const [s3bProgress, setS3bProgress] = useState({ done: 0, total: 0 });

  /** Gate #1 (s3a) + gate #2 (s3b, Option A: zero true-UNKNOWN). */
  const canAdvance = () => {
    if (step.id === 's3a') return session.state === 'recognized' || session.state === 'unknown';
    if (step.id === 's3b') return s3b.snapshot.unmapped.length === 0;
    return true;
  };
  const nextEnabled = canAdvance();

  /** Exit-protection: blocker is active iff a worker-side session exists. */
  const blocker = useBlocker(session.sessionId !== null);

  /**
   * ImportSessionContext carries the LIVE snapshot: at step 0 it's S3a's; once a
   * session exists it's the S3b hook's evolving snapshot (so any context
   * consumer sees the latest applied state, and back→forward is consistent).
   */
  const liveSnapshot = session.sessionId !== null ? s3b.snapshot : session.snapshot;
  const importSession = useMemo(
    () => ({ sessionId: session.sessionId, snapshot: liveSnapshot }),
    [session.sessionId, liveSnapshot],
  );

  /**
   * Step-2 «Далі» (Option A): unmapped → loud BlockPanel + jump-to-first, NO
   * advance (fails closed); zero-unmapped → importNext (flushes staged recall),
   * showing the WorkerProgressPanel takeover driven by the real 'generate'
   * progress events, then advance to S3c.
   */
  const advancingRef = useRef(false);
  const onS3bNext = useCallback(async () => {
    if (advancingRef.current) return;
    if (s3b.snapshot.unmapped.length > 0) {
      setS3bView('block'); // loud gate, names the columns; no advance
      return;
    }
    advancingRef.current = true;
    setS3bView('worker');
    setS3bProgress({ done: 0, total: 0 });
    const unsubscribe = client.onEvent((evt) => {
      if (evt.event === 'progress' && evt.phase === 'generate') {
        setS3bProgress({ done: evt.done, total: evt.total });
      }
    });
    try {
      const res = await s3b.next();
      if (res.ok) {
        setS3bView('mapping');
        setStepIndex((i) => i + 1); // → S3c
      } else {
        // Defensive: the gate already guaranteed zero-unmapped, but if the
        // engine still reports unmapped, surface the loud block (fails closed).
        setS3bView('block');
      }
    } finally {
      unsubscribe();
      advancingRef.current = false;
    }
  }, [client, s3b]);

  /** «Назад» from S3b → S3a (step 1), NON-DESTRUCTIVE: no importAbort. The
   *  session + staged mappings live on the worker session and survive; only
   *  S3a's explicit replace/remove aborts. */
  const goBack = useCallback(() => {
    if (isFirst) {
      navigate('/dashboard');
      return;
    }
    setS3bView('mapping');
    setStepIndex((i) => i - 1);
  }, [isFirst, navigate]);

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
              {baseGate !== 'probing' && <S3aSource session={session} />}
            </>
          ) : step.id === 's3b' && session.sessionId !== null ? (
            <>
              <div className="s3-head">
                <div className="f-mono ob-eyebrow">{t('s3bEyebrow')}</div>
                <h1 className="f-disp s3-title">{t('s3bTitle')}</h1>
                <p className="body-p s3-lead">{t('s3bLead')}</p>
              </div>
              <S3bMapping
                session={s3b}
                fileLabel={session.file?.name ?? ''}
                totalRows={session.file?.rows ?? 0}
                gateView={s3bView}
                progress={s3bProgress}
              />
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
          <Key variant="beige" sm onClick={goBack}>
            {t('keyBack')}
          </Key>
          {!isLast ? (
            step.id === 's3b' ? (
              // Option A: «Далі» is ALWAYS active at step 2; the press resolves
              // to the loud block (unmapped) or the worker takeover + advance.
              <Key variant="gold" onClick={() => void onS3bNext()}>
                {t('keyNext')}
              </Key>
            ) : (
              <Key
                variant="gold"
                disabled={!nextEnabled}
                aria-disabled={!nextEnabled}
                onClick={() => nextEnabled && setStepIndex(stepIndex + 1)}
              >
                {t('keyNext')}
              </Key>
            )
          ) : (
            <div style={{ display: 'flex', gap: 'var(--sp-m)' }}>
              <Key variant="beige" onClick={() => setStepIndex(0)}>{t('keyImportMore')}</Key>
              <Key variant="gold" onClick={() => navigate('/dashboard')}>{t('keyToBudget')}</Key>
            </div>
          )}
        </div>
      </main>
      {baseGate === 'needed' && (
        <BaseCurrencyDialog
          onDone={() => setBaseGate('ready')}
          onCancel={() => navigate('/')}
        />
      )}
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
