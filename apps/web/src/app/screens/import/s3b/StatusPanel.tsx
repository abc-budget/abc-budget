import { useLang, useT } from '../../../i18n/LangProvider';
import { columnTypeLabel } from '../../../i18n/column-type-label';
import { Panel, PanelBody, PanelHeader } from '../../../../ui/altus/components';
import { MarkdownHelp } from './MarkdownHelp';
import { infoHelp } from './help-docs';
import { columnState } from './types';
import type { MappingColumn } from './types';
import './s3b.css';

export interface StatusPanelProps {
  columns: MappingColumn[];
  /** Jump to (scroll/open) a column by id. */
  onJump: (columnId: string) => void;
  /**
   * The LOUD save-collision affordance (decision #5), rendered at the top of the
   * panel when a collision is active.  The container passes a <CollisionBanner>;
   * null when there is no collision.  Persistent until resolved.
   */
  collisionBanner?: React.ReactNode;
}

/**
 * StatusPanel — the default right pane.
 *
 * Ported from design-reference/s3b-app.jsx :: StatusPanel.  Renders:
 *   · the `info` step-intro <details> (MarkdownHelp over infoHelp(lang) — info
 *     is not a definition, so it has its own accessor)
 *   · a progress bar (handled = total − unknown, over total)
 *   · the legend (confirmed green / guessed gold / unknown orange counts)
 *   · the per-column status list (jump on click)
 *   · the recall note
 * The prototype's hardcoded CUR_NORM "currency normalization" demo block is
 * NOT ported — it had no engine data source (it was sample-only chrome).
 * Pure: props in, onJump(columnId) out.
 */
export function StatusPanel({ columns, onJump, collisionBanner = null }: StatusPanelProps) {
  const t = useT();
  const { lang } = useLang();

  const total = columns.length;
  const states = columns.map((c) => columnState(c));
  const unknown = states.filter((s) => s === 'unknown').length;
  const guessed = states.filter((s) => s === 'guessed').length;
  const ignored = states.filter((s) => s === 'ignored').length;
  const confirmed = total - unknown - guessed - ignored;
  const pct = total === 0 ? 0 : Math.round(((total - unknown) / total) * 100);

  return (
    <Panel className="statuspanel">
      <PanelHeader logchip="MAP/" title={t('s3bStatusTitle')}>
        <span className="eyebrow-ink">
          {total - unknown}/{total}
        </span>
      </PanelHeader>
      <PanelBody>
        {collisionBanner}
        <details className="step-intro">
          <summary className="step-intro-sum f-mono">
            <span className="si-ic" aria-hidden="true">
              ℹ
            </span>
            {t('s3bHelpIntro')}
          </summary>
          <div className="step-intro-body">
            <MarkdownHelp md={infoHelp(lang)} />
          </div>
        </details>

        <div
          className="statusbar"
          role="progressbar"
          aria-label={t('s3bStatusTitle')}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={total - unknown}
        >
          <div className="statusbar-fill" style={{ width: `${pct}%` }} />
        </div>

        <div className="status-legend">
          <span className="sl">
            <span className="dot dot-green" aria-hidden="true" />
            {confirmed} {t('s3bConfirmed')}
          </span>
          <span className="sl">
            <span className="dot dot-gold" aria-hidden="true" />
            {guessed} {t('s3bGuessedN')}
          </span>
          <span className="sl">
            <span className="dot dot-orange" aria-hidden="true" />
            {unknown} {t('s3bUnknown')}
          </span>
        </div>

        <div className="status-list">
          {columns.map((col) => {
            const state = columnState(col);
            return (
              <button
                type="button"
                key={col.id}
                className={`status-row ${state}`}
                onClick={() => onJump(col.id)}
              >
                <span className="sr-dot" aria-hidden="true" />
                <span className="sr-raw f-mono">{col.rawName}</span>
                <span className="sr-arrow" aria-hidden="true">
                  →
                </span>
                <span className="sr-type f-disp">
                  {state === 'unknown' ? t('s3bUnknown') : columnTypeLabel(col.definition!, lang)}
                </span>
              </button>
            );
          })}
        </div>

        <div className="recall-note f-mono">◇ {t('s3bRecallNote')}</div>
      </PanelBody>
    </Panel>
  );
}
