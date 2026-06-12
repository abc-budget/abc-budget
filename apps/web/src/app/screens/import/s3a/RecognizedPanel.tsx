import { Lamp, Panel, PanelBody, PanelHeader } from '../../../../ui/altus/components';
import { useLang, useT } from '../../../i18n/LangProvider';
import { columnTypeLabel } from '../../../i18n/column-type-label';
import { FileChip } from './FileChip';
import type { FileChipFile } from './FileChip';
import './s3a.css';

/**
 * One savedmap row: column name → recalled definition (a plain string off the
 * Stage2 snapshot DTO — the engine enum never crosses the NFR-003 fence) or
 * null/'unknown' for an untyped column.
 */
export interface SavedMapColumn {
  name: string;
  definition: string | null;
}

/** N-of-M recall summary (mirrors Stage2SnapshotDTO.recognized + columns). */
export interface RecognizedSummary {
  n: number;
  m: number;
  cols: SavedMapColumn[];
}

export interface RecognizedPanelProps {
  file: FileChipFile;
  recog: RecognizedSummary;
  onReplace: () => void;
  onRemove: () => void;
}

const isTyped = (definition: string | null): definition is string =>
  definition !== null && definition !== 'unknown';

/**
 * S3a recognized state (n > 0) — per-column recall from the learned pool.
 * Presentational port of design-reference/s3a-app.jsx RecognizedPanel:
 * green-lamp header + N/M eyebrow, recogTitle (all vs some), gold partial
 * line iff n < m, savedmap rows with the «recalled» tag, the FEAT-018 dedup
 * reassurance block (informational copy — no fake numbers), proceed note.
 */
export function RecognizedPanel({ file, recog, onReplace, onRemove }: RecognizedPanelProps) {
  const t = useT();
  const { lang } = useLang();
  const partial = recog.n < recog.m;
  return (
    <div className="result" data-testid="s3a-recognized">
      <FileChip file={file} onReplace={onReplace} onRemove={onRemove} />
      <Panel className="recog">
        <PanelHeader lamp="green" title={t('s3aRecogTag')}>
          <span className="eyebrow-ink">
            {recog.n} / {recog.m}
          </span>
        </PanelHeader>
        <PanelBody>
          <div className="recog-title f-disp">
            {partial
              ? t('s3aRecogTitleSome', { n: recog.n, m: recog.m })
              : t('s3aRecogTitleAll', { m: recog.m })}
          </div>
          <p className="body-p recog-body">{t('s3aRecogBody')}</p>
          {partial && (
            <div className="recog-partial f-mono" data-testid="s3a-partial">
              <Lamp tone="gold" />
              {t('s3aRecogPartial', { k: recog.m - recog.n })}
            </div>
          )}

          <div className="savedmap">
            <div className="sm-lab f-mono">{t('s3aPoolLab')}</div>
            <div className="sm-rows">
              {recog.cols.map((c, i) => (
                <div key={i} className={'sm-row f-mono' + (isTyped(c.definition) ? '' : ' sm-unk')}>
                  <span className="sm-name">{c.name}</span>
                  <span className="sm-arrow" aria-hidden="true">→</span>
                  {isTyped(c.definition) ? (
                    <span className="sm-type">
                      {columnTypeLabel(c.definition, lang)}
                      <span className="sm-tag">{t('s3aRecalled')}</span>
                    </span>
                  ) : (
                    <span className="sm-type sm-type-unk">{t('s3aUnkType')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="dedup">
            <span className="dedup-ic">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7 A8 8 0 0 1 18 4.5 L20 6.5 M20 2 V6.5 H15.5" />
                <path d="M20 17 A8 8 0 0 1 6 19.5 L4 17.5 M4 22 V17.5 H8.5" />
                <path d="M9 12 L11 14 L15 10" />
              </svg>
            </span>
            <div>
              <div className="dedup-title f-disp">{t('s3aDedupTitle')}</div>
              <p className="body-p dedup-body">{t('s3aDedupBody')}</p>
            </div>
          </div>

          <div className="proceed-note f-mono">▸ {t('s3aProceedNote')}</div>
        </PanelBody>
      </Panel>
    </div>
  );
}
