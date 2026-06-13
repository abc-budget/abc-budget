import { useT } from '../../../i18n/LangProvider';
import { Panel, PanelBody, PanelHeader, Key } from '../../../../ui/altus/components';
import './s3b.css';

/** A resolved cell error from ColumnRejectionDTO.cellErrors (message localized). */
export interface RejectionCellError {
  rowIndex: number;
  /** Already-resolved error message text. */
  message: string;
}

/** Plain view-model for a >30% ColumnTransformRejection (from ColumnRejectionDTO). */
export interface RejectionInfo {
  errorCount: number;
  totalCount: number;
  /** Fractional threshold (e.g. 0.3) — rendered as a percentage. */
  threshold: number;
  cellErrors: RejectionCellError[];
}

export interface RejectionPanelProps {
  rejection: RejectionInfo;
  /** The raw column name the rejection is for. */
  columnName: string;
  /** Retry / review action (the container reopens the wizard or dismisses). */
  onRetry: () => void;
}

/**
 * RejectionPanel — the loud >30% ColumnTransformRejection render.
 *
 * Ported from design-reference/s3b-app.jsx :: ParseErrorPanel, generalized to
 * real rejection data.  WHAT/WHY/DO header rows + the FULL cellErrors list
 * (NOT truncated — decision: render every cellError so the user sees the whole
 * blast radius).  The column stays UNKNOWN; the session survives.
 * Pure: props in, onRetry() out.
 */
export function RejectionPanel({ rejection, columnName, onRetry }: RejectionPanelProps) {
  const t = useT();
  const pct = Math.round(rejection.threshold * 100);
  return (
    <Panel className="perrpanel">
      <PanelHeader lamp="orange" title={t('s3bPerrTagCol', { col: columnName })} />
      <PanelBody>
        <div className="crt err-crt">
          <div className="err-line">
            <span className="err-key f-mono">{t('s3bPerrWhat')}</span>
            <span className="f-mono err-v">
              {t('s3bRejWhat', { errors: rejection.errorCount, total: rejection.totalCount })}
            </span>
          </div>
          <div className="err-line">
            <span className="err-key f-mono">{t('s3bPerrWhy')}</span>
            <span className="f-mono err-v">{t('s3bRejWhy', { pct })}</span>
          </div>
          <div className="err-line">
            <span className="err-key f-mono" style={{ color: 'var(--gold)' }}>
              {t('s3bPerrDo')}
            </span>
            <span className="f-mono err-v" style={{ color: 'var(--cream)' }}>
              {t('s3bRejDo')}
            </span>
          </div>
        </div>
        <div className="perr-rows" data-testid="rejection-cell-errors">
          {rejection.cellErrors.map((ce, i) => (
            <div key={i} className="perr-row f-mono">
              <span className="perr-n">{t('s3bRejRow', { row: ce.rowIndex + 1 })}</span>
              <span className="perr-bad">{ce.message}</span>
            </div>
          ))}
        </div>
        <Key
          variant="orange"
          sm
          onClick={onRetry}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M16 16 L21 21" />
            </svg>
          }
        >
          {t('s3bPerrReview')}
        </Key>
      </PanelBody>
    </Panel>
  );
}
