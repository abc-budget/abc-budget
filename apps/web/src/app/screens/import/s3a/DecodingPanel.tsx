import { Panel, PanelBody, PanelHeader } from '../../../../ui/altus/components';
import { useT } from '../../../i18n/LangProvider';
import './s3a.css';

export interface DecodingPanelProps {
  fileName: string;
  /** Rows decoded so far — straight off the 2.6 progress events ({done,total}). */
  done: number;
  /** Total rows; ≤ 0 (or unknown) → indeterminate sweep until the first event lands. */
  total: number;
}

/** Dot count of the progress track — mirrors the Dashboard gauge's 28-cell plate. */
const CELLS = 28;

/**
 * S3a decoding state — the file-read progress visual (PROGRESS-DURING-DECODE).
 *
 * DEV-DESIGNED (2.7): NO bundle equivalent exists for this state — the visual
 * borrows the bundle's existing language only: the result panels' lamp header
 * (gold = work in progress), the Dashboard gauge's dot-matrix plate for the
 * track, f-mono uppercase counts. HONEST numbers: shows real done/total from
 * progress events; before the first event (total unknown) the track sweeps
 * indeterminately and the copy says "opening the file" — no fake percentages.
 * FLAGGED for the PM pixel pass as the one designed-by-dev surface.
 */
export function DecodingPanel({ fileName, done, total }: DecodingPanelProps) {
  const t = useT();
  const determinate = total > 0;
  const lit = determinate ? Math.min(CELLS, Math.round((done / total) * CELLS)) : 0;
  return (
    <div className="result" data-testid="s3a-decoding">
      <Panel className="decoding">
        <PanelHeader lamp="gold" title={t('s3aDecodingTag')}>
          {determinate && (
            <span className="eyebrow-ink">
              {done} / {total}
            </span>
          )}
        </PanelHeader>
        <PanelBody>
          <div className="dec-file f-mono">{fileName}</div>
          <div
            className={'dec-track' + (determinate ? '' : ' indet')}
            role="progressbar"
            aria-label={t('s3aDecodingTag')}
            aria-valuemin={0}
            aria-valuemax={determinate ? total : undefined}
            aria-valuenow={determinate ? done : undefined}
          >
            {Array.from({ length: CELLS }, (_, i) => (
              <span key={i} className={'dec-cell' + (i < lit ? ' lit' : '')} />
            ))}
          </div>
          <div className="dec-count f-mono" aria-live="polite">
            {determinate ? t('s3aDecodingRows', { done, total }) : t('s3aDecodingPrep')}
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
