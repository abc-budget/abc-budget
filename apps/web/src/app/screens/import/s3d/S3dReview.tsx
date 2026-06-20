/**
 * S3dReview — the review & save screen body (table + summary aside + dedup + saved overlay).
 *
 * Drift-trap bindings (all must be honoured exactly):
 *  1. tiles/dedup/newCount/filter-chip-counts come from session.summary — NEVER recomputed.
 *  2. reason cell = row.reasons rendered via resolveMessage — NO subcode switch.
 *  3. category = session.categoryIndex.get(row.categoryId) → CatIcon + name; null → '—'.
 *  4. label column = row.description (under colDesc header).
 *  5. React key = row.rowIndex; currency = row.currency; date = compact MM-DD from ISO row.date.
 *  6. SavedPanel count = session.rowsCommitted — NOT newCount.
 *  PLUS: dup is state:'ok' + dup:true → mark <tr> with class is-dup, NOT skipped.
 */
import { useLang, useT } from '../../../i18n/LangProvider';
import { resolveMessage } from '../../../i18n/resolve-message';
import { CatIcon } from '../../../../ui/altus/icons';
import { fmtAmount } from '../s3c/money';
import type { ReviewRowDTO } from '@abc-budget/engine';
import type { S3dFilter, S3dSession } from './use-s3d-session';
import './s3d.css';

const PG = 14;
const STATE_LAMP: Record<ReviewRowDTO['state'], string> = { ok: 'green', error: 'orange', skipped: 'gray' };

/** ISO date → compact MM-DD; null → '—'. */
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}-${m[3]}` : iso;
}

/* ── Stat tile ──────────────────────────────────────────────────────────────── */
function Stat({ n, label, tone, testid }: { n: number; label: string; tone: string; testid: string }) {
  return (
    <div className={'stat tone-' + tone} data-testid={testid}>
      <span className="stat-n f-mono">{n}</span>
      <span className="stat-lab f-mono">{label}</span>
    </div>
  );
}

/* ── Dedup bar ──────────────────────────────────────────────────────────────── */
function DedupBar({ newCount, dup }: { newCount: number; dup: number }) {
  const t = useT();
  const total = newCount + dup;
  const pctNew = total ? Math.round((newCount / total) * 100) : 100;
  return (
    <div className="dedup">
      <div className="dedup-head">
        <span className="logchip">SYNC/</span>
        <h3>{t('s3dDedupTitle')}</h3>
      </div>
      <div className="dedup-body">
        {dup > 0 ? (
          <>
            <div className="dedup-bar">
              <div className="dd-new" style={{ width: pctNew + '%' }}>
                <span className="lamp green" />
                <span className="f-mono">{newCount} {t('s3dDedupNew')}</span>
              </div>
              <div className="dd-dup" style={{ width: (100 - pctNew) + '%' }}>
                <span className="lamp gray" />
                <span className="f-mono">{dup} {t('s3dDedupDup')}</span>
              </div>
            </div>
            <p className="dedup-note f-mono">▸ {t('s3dDedupNote')}</p>
          </>
        ) : (
          <div className="dedup-clean f-mono">
            <span className="lamp green" />
            {t('s3dNoDedup')}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Review table row ───────────────────────────────────────────────────────── */
function ReviewRow({
  row,
  categoryIndex,
}: {
  row: ReviewRowDTO;
  categoryIndex: Map<string, { id: string; name: string; icon: string; currency: string }>;
}) {
  const { lang } = useLang();
  const t = useT();
  const problem = row.state !== 'ok';
  const reason =
    problem && row.reasons && row.reasons.length > 0
      ? row.reasons.map((m) => resolveMessage(m, lang)).join('; ')
      : null;
  const cat = row.categoryId != null ? categoryIndex.get(row.categoryId) : undefined;
  const stLabel =
    row.state === 'ok' ? t('s3dStOk') : row.state === 'error' ? t('s3dStError') : t('s3dStSkipped');

  return (
    <tr className={'rev-row st-' + row.state + (row.dup ? ' is-dup' : '')}>
      <td className="rv-state">
        <span className="rv-lampwrap" title={reason ?? t('s3dStOk')}>
          <span className={'lamp ' + STATE_LAMP[row.state]} />
          <span className="rv-st-lab f-mono">{stLabel}</span>
        </span>
      </td>
      <td className="rv-date f-mono">{fmtDate(row.date)}</td>
      <td className="rv-desc f-mono">{row.description ?? '—'}</td>
      <td className="rv-amt f-mono amount">
        {row.amount == null || row.currency == null ? '—' : fmtAmount(row.amount, row.currency)}
      </td>
      <td className="rv-cat f-mono">
        {cat ? (
          <span className="catcell-inline">
            <CatIcon id={cat.icon} size={15} color="var(--ebony)" /> {cat.name}
          </span>
        ) : (
          t('s3dCatNone')
        )}
      </td>
      {problem && (
        <td className="rv-reason">
          <div className="reason-log">
            <span className="reason-lab f-mono">{t('s3dReasonLab')}</span>
            <span className="reason-txt f-mono">{reason}</span>
          </div>
        </td>
      )}
    </tr>
  );
}

/* ── Review table ───────────────────────────────────────────────────────────── */
function ReviewTable({
  session,
}: {
  session: S3dSession;
}) {
  const t = useT();
  // Drift-trap 1: filter chip counts come from session.summary, not recomputed from rows.
  const { summary } = session;

  const FILTERS: Array<[S3dFilter, string]> = [
    ['all', t('s3dFAll')],
    ['error', t('s3dFError') + ' · ' + summary.error],
    ['skip', t('s3dFSkip') + ' · ' + summary.skipped],
    ['both', t('s3dFBoth') + ' · ' + (summary.error + summary.skipped)],
  ];

  // Client-side filter + paginate over session.rows
  const shown = session.rows.filter((r) =>
    session.filter === 'all'
      ? true
      : session.filter === 'error'
        ? r.state === 'error'
        : session.filter === 'skip'
          ? r.state === 'skipped'
          : r.state === 'error' || r.state === 'skipped',
  );
  const pages = Math.max(1, Math.ceil(shown.length / PG));
  const pg = Math.min(session.page, pages - 1);
  const view = shown.slice(pg * PG, pg * PG + PG);
  const anyProblem = view.some((r) => r.state !== 'ok');

  return (
    <div className="panel revpanel">
      <div className="panel-h">
        <div className="lhs">
          <span className="logchip">REV/</span>
          <h3>{t('impReviewTitle')}</h3>
        </div>
        <span className="eyebrow-ink">{t('s3dShowing', { n: view.length, m: shown.length })}</span>
      </div>
      <div className="rev-toolbar">
        <span className="rt-lab f-mono">{t('s3dShowRows')}</span>
        <div className="rt-seg">
          {FILTERS.map(([k, lab]) => (
            <button
              key={k}
              className={'rt-btn f-mono' + (session.filter === k ? ' on' : '')}
              onClick={() => { session.setFilter(k); session.setPage(0); }}
            >
              {lab}
            </button>
          ))}
        </div>
      </div>
      <div className="revscroll">
        <table className="revtable">
          <thead>
            <tr>
              <th>{t('s3dColState')}</th>
              <th>{t('s3dColDate')}</th>
              {/* Drift-trap 4: label column = description, always colDesc header */}
              <th>{t('s3dColDesc')}</th>
              <th className="th-amt">{t('s3dColAmount')}</th>
              <th>{t('s3dColCat')}</th>
              {anyProblem && <th>{t('s3dReasonLab').replace('// ', '')}</th>}
            </tr>
          </thead>
          <tbody>
            {/* Drift-trap 5: React key = row.rowIndex */}
            {view.map((r) => (
              <ReviewRow key={r.rowIndex} row={r} categoryIndex={session.categoryIndex} />
            ))}
          </tbody>
        </table>
      </div>
      <div className="rev-foot">
        <div className="privacy-note f-mono">{t('s3dPrivacyNote')}</div>
        <div className="rev-pager">
          <button
            className="pgkey"
            disabled={pg <= 0}
            onClick={() => session.setPage(pg - 1)}
            aria-label="prev"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 5 L8 12 L15 19" />
            </svg>
          </button>
          <span className="pg-disp f-mono">{pg + 1} / {pages}</span>
          <button
            className="pgkey"
            disabled={pg >= pages - 1}
            onClick={() => session.setPage(pg + 1)}
            aria-label="next"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5 L16 12 L9 19" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Summary aside ──────────────────────────────────────────────────────────── */
function SummaryAside({ session }: { session: S3dSession }) {
  const t = useT();
  // Drift-trap 1: tiles bound to session.summary
  const { summary } = session;
  return (
    <aside className="split-side">
      <div className="panel sumpanel">
        <div className="panel-h">
          <div className="lhs">
            <span className="logchip">RPT/</span>
            <h3>{t('s3dSumTitle')}</h3>
          </div>
        </div>
        <div className="sum-body">
          <div className={'sum-banner ' + (session.hasErrors ? 'warn' : 'ok')}>
            <span className={'lamp ' + (session.hasErrors ? 'orange' : 'green')} />
            <span className="f-mono">{session.hasErrors ? t('s3dErrTag') : t('s3dOkTag')}</span>
          </div>
          <div className="stat-grid">
            <Stat n={summary.ok} label={t('s3dSumOk')} tone="ok" testid="stat-ok" />
            <Stat n={summary.error} label={t('s3dSumError')} tone="error" testid="stat-error" />
            <Stat n={summary.skipped} label={t('s3dSumSkipped')} tone="skip" testid="stat-skipped" />
            <Stat n={summary.dup} label={t('s3dSumDup')} tone="dup" testid="stat-dup" />
          </div>
          {/* Drift-trap 1: sum-new = session.summary.newCount */}
          <div className="sum-new f-mono" data-testid="sum-new">
            <span className="lamp green" />
            {summary.newCount} {t('s3dSumNew')}
          </div>
        </div>
        <DedupBar newCount={summary.newCount} dup={summary.dup} />
      </div>
    </aside>
  );
}

/* ── Saved overlay ──────────────────────────────────────────────────────────── */
function SavedPanel({ session }: { session: S3dSession }) {
  const t = useT();
  // Drift-trap 6: count = session.rowsCommitted — NOT newCount
  return (
    <div className="saved-wrap">
      <div className="panel saved">
        <div className="saved-lamp"><span className="lamp green" /></div>
        <h2 className="f-disp saved-title">{t('s3dSavedTitle')}</h2>
        <p className="body-p saved-body">{t('s3dSavedBody', { n: session.rowsCommitted })}</p>
        <div className="saved-keys">
          <button className="key beige sm">{t('s3dSavedAnother')}</button>
          <button className="key green sm">{t('s3dSavedGoto')}</button>
        </div>
      </div>
    </div>
  );
}

/* ── S3dReview (the exported container) ─────────────────────────────────────── */
export function S3dReview({ session }: { session: S3dSession }) {
  const t = useT();

  if (session.phase === 'saved') {
    return <SavedPanel session={session} />;
  }

  return (
    <>
      <div className="split">
        <div className="mainpanel">
          <ReviewTable session={session} />
        </div>
        <SummaryAside session={session} />
      </div>
      <footer className="s3d-foot">
        {session.hasErrors && (
          <label className="ack-check f-mono">
            <input
              type="checkbox"
              checked={session.ack}
              onChange={(e) => session.setAck(e.target.checked)}
            />
            <span className="ack-box" />
            {t('s3dAckErrors')}
            <span className="ack-note f-mono">
              {' '}({t('s3dErrBlock', { n: session.summary.error })})
            </span>
          </label>
        )}
        <button
          className="key green sm"
          disabled={!session.canSave || session.phase === 'saving'}
          onClick={() => { void session.commit(); }}
        >
          {session.phase === 'saving' ? t('s3dSaving') : t('s3dSaveCount', { n: session.summary.newCount })}
        </button>
      </footer>
      {session.hasErrors && !session.ack && (
        <div className="address-note f-mono">▸ {t('s3dAddressErrors')}</div>
      )}
    </>
  );
}
