import { useLang, useT } from '../../../i18n/LangProvider';
import { Panel, PanelBody, PanelHeader } from '../../../../ui/altus/components';
import './s3b.css';

export interface WorkerProgressPanelProps {
  /** Rows processed so far — straight off importNext's progress events. */
  done: number;
  /** Total rows; ≤ 0 (unknown) → indeterminate until the first event lands. */
  total: number;
}

/** Gauge cell count — matches the bundle's worker-gauge plate. */
const CELLS = 36;

/**
 * WorkerProgressPanel — the importNext takeover on large files.
 *
 * REUSE-vs-PORT (decision): this REUSES the 2.7 DecodingPanel's HONEST
 * determinate primitive (real done/total off the worker progress events,
 * monotone, a progressbar role with aria-valuenow) and PORTS only the bundle's
 * WorkerPanel *chrome* (the brand mark, the dot-matrix worker-gauge, the
 * pct + rows readout, the copy).  The bundle's WorkerPanel drives its bar from
 * a `setInterval(... +2 every 90ms)` FAKE timer — that is explicitly NOT
 * ported (HC-10: no progress theatre).  Everything here is driven from props.
 * Pure: props in, no callbacks.
 */
export function WorkerProgressPanel({ done, total }: WorkerProgressPanelProps) {
  const t = useT();
  const { lang } = useLang();
  const determinate = total > 0;
  const pct = determinate ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const lit = determinate ? Math.min(CELLS, Math.round((done / total) * CELLS)) : 0;
  const locale = lang === 'uk' ? 'uk-UA' : 'en-US';

  return (
    <Panel className="workerpanel">
      <PanelHeader lamp="gold" title={t('s3bWorkerTag')} />
      <PanelBody>
        <div className="worker-b">
          <div className="worker-title f-disp">{t('s3bWorkerTitle')}</div>
          <p className="body-p worker-body">{t('s3bWorkerBody')}</p>
          <div
            className={`worker-gauge${determinate ? '' : ' indet'}`}
            role="progressbar"
            aria-label={t('s3bWorkerTitle')}
            aria-valuemin={0}
            aria-valuemax={determinate ? total : undefined}
            aria-valuenow={determinate ? done : undefined}
          >
            {Array.from({ length: CELLS }, (_, i) => (
              <span key={i} className={`wcell${i < lit ? ' lit' : ''}`} />
            ))}
          </div>
          <div className="worker-read f-mono" aria-live="polite">
            <span className="worker-pct">{pct}%</span>
            <span>
              {done.toLocaleString(locale)} / {total.toLocaleString(locale)} {t('s3bWorkerRows')}
            </span>
          </div>
          <div className="worker-hint f-mono">{t('s3bWorkerHint')}</div>
        </div>
      </PanelBody>
    </Panel>
  );
}
