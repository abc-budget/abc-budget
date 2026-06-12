import { useEffect, useState } from 'react';
import type { EngineClient } from '@abc-budget/engine';
import { Key } from '../../ui/altus/components';
import { useT } from '../i18n/LangProvider';
import type { EngineBootStatus } from '../../engine';

/**
 * EngineStatusBanner — chrome-level surface for the three LOUD engine states
 * (Story 2.6; the full UI states matrix is 2.7/2.8's):
 *
 *   blocked            — engine-DB onblocked (multi-tab): "close other tabs".
 *   contract-mismatch  — hello/helloAck disagree (half-updated PWA cache):
 *                        triggers the SW UPDATE CHECK through registerSW's
 *                        updateSW (decision 2 refinement — NEVER a bare
 *                        location.reload, so the stale half gets REPLACED).
 *   worker-died        — transport drained; respawn is automatic (lazy, on the
 *                        next call) — the banner is the loud notice.
 *
 * Presentational: everything is injected (client / readiness / updateSW) —
 * the component only subscribes and renders. Mounted in the app shell (App.tsx).
 *
 * State priority: contract-mismatch > blocked > worker-died (a mismatch or a
 * blocked DB is never masked by a subsequent death notice).
 */

export type EngineBannerState = 'blocked' | 'contract-mismatch' | 'worker-died';

/** registerSW's return — triggers the SW update check (+ reload when applied). */
export type UpdateSWFn = (reloadPage?: boolean) => Promise<void> | void;

const PRIORITY: Record<EngineBannerState, number> = {
  'contract-mismatch': 3,
  blocked: 2,
  'worker-died': 1,
};

function escalate(prev: EngineBannerState | null, next: EngineBannerState): EngineBannerState {
  return prev !== null && PRIORITY[prev] > PRIORITY[next] ? prev : next;
}

export interface EngineStatusBannerProps {
  client: Pick<EngineClient, 'onEvent'>;
  ready: Promise<EngineBootStatus>;
  updateSW: UpdateSWFn;
}

export function EngineStatusBanner({ client, ready, updateSW }: EngineStatusBannerProps) {
  const t = useT();
  const [state, setState] = useState<EngineBannerState | null>(null);

  useEffect(() => {
    let disposed = false;

    const unsubscribe = client.onEvent((evt) => {
      if (disposed) return;
      if (evt.event === 'blocked') setState((s) => escalate(s, 'blocked'));
      else if (evt.event === 'dead') setState((s) => escalate(s, 'worker-died'));
    });

    void ready.then((status) => {
      if (disposed || status.state !== 'contract-mismatch') return;
      setState((s) => escalate(s, 'contract-mismatch'));
      // Decision 2 refinement: a mismatch implies a half-updated PWA cache —
      // kick the SW update check immediately so the stale half gets replaced.
      void updateSW(false);
    });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [client, ready, updateSW]);

  if (state === null) return null;

  const copy = {
    blocked: { title: t('engBlockedTitle'), body: t('engBlockedBody') },
    'contract-mismatch': { title: t('engMismatchTitle'), body: t('engMismatchBody') },
    'worker-died': { title: t('engDiedTitle'), body: t('engDiedBody') },
  }[state];

  return (
    <div
      role="alert"
      data-testid="engine-status-banner"
      data-state={state}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '12px 20px',
        background: 'var(--cream)',
        borderBottom: '3px solid var(--orange)',
      }}
    >
      <span className="logchip" style={{ flexShrink: 0 }}>ENG</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ margin: 0, fontFamily: 'var(--f-mono)', fontWeight: 600, fontSize: 13 }}>
          {copy.title}
        </p>
        <p style={{ margin: '2px 0 0', fontFamily: 'var(--f-mono)', fontWeight: 500, fontSize: 12, opacity: 0.8 }}>
          {copy.body}
        </p>
      </div>
      {state === 'contract-mismatch' && (
        <Key variant="orange" sm onClick={() => void updateSW(true)}>
          {t('engMismatchReload')}
        </Key>
      )}
    </div>
  );
}
