import { Panel, PanelBody, PanelHeader } from '../../../../ui/altus/components';
import { useT } from '../../../i18n/LangProvider';
import { FileChip } from './FileChip';
import type { FileChipFile } from './FileChip';
import type { RecognizedSummary } from './RecognizedPanel';
import './s3a.css';

export interface UnknownPanelProps {
  file: FileChipFile;
  /** n === 0 here by construction — the container routes n > 0 to RecognizedPanel. */
  recog: RecognizedSummary;
  onReplace: () => void;
  onRemove: () => void;
}

/**
 * S3a unknown state — empty pool / first-ever import (n = 0): all columns
 * untyped, next step is manual mapping (S3b). Presentational port of
 * design-reference/s3a-app.jsx UnknownPanel (gold lamp, 0/M eyebrow,
 * all-unknown savedmap, CRT next-step note — the bilingual `// наступний
 * крок · next step` comment is VERBATIM prototype copy).
 */
export function UnknownPanel({ file, recog, onReplace, onRemove }: UnknownPanelProps) {
  const t = useT();
  return (
    <div className="result" data-testid="s3a-unknown">
      <FileChip file={file} onReplace={onReplace} onRemove={onRemove} />
      <Panel className="unknown">
        <PanelHeader lamp="gold" title={t('s3aUnkTag')}>
          <span className="eyebrow-ink">0 / {recog.m}</span>
        </PanelHeader>
        <PanelBody>
          <div className="unk-title f-disp">{t('s3aUnkTitle')}</div>
          <p className="body-p unk-body">{t('s3aUnkBody')}</p>
          <div className="savedmap">
            <div className="sm-lab f-mono">{t('s3aPoolLab')}</div>
            <div className="sm-rows">
              {recog.cols.map((c, i) => (
                <div key={i} className="sm-row f-mono sm-unk">
                  <span className="sm-name">{c.name}</span>
                  <span className="sm-arrow" aria-hidden="true">→</span>
                  <span className="sm-type sm-type-unk">{t('s3aUnkType')}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="unk-detected crt">
            <span style={{ color: 'var(--gray-warm)' }}>▸ {t('s3aUnkAllCols', { m: recog.m })}</span>
            <br />
            <span style={{ color: 'var(--gold)' }}>→ {t('stepColumns')}</span>{' '}
            <span style={{ color: 'var(--gray-warm)' }}>// наступний крок · next step</span>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
