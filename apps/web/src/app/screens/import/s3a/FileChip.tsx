import { Chip } from '../../../../ui/altus/components';
import { useT } from '../../../i18n/LangProvider';
import './s3a.css';

/** Transient file view-model — name + size label + decoded row estimate (lean source, 2.6). */
export interface FileChipFile {
  name: string;
  sizeLabel: string;
  rows: number;
}

export interface FileChipProps {
  file: FileChipFile;
  onReplace: () => void;
  onRemove: () => void;
}

/**
 * Shared file card across the resolved states.
 * Presentational port of design-reference/s3a-app.jsx FileChip.
 */
export function FileChip({ file, onReplace, onRemove }: FileChipProps) {
  const t = useT();
  return (
    <div className="filechip" data-testid="s3a-filechip">
      <span className="fc-ic">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 3 H14 L18 7 V21 H6 Z" />
          <path d="M14 3 V7 H18" />
          <path d="M8.5 12 H15.5 M8.5 15 H15.5 M8.5 18 H13" />
        </svg>
      </span>
      <div className="fc-meta">
        <div className="fc-name f-mono">{file.name}</div>
        <div className="fc-sub f-mono">
          {file.sizeLabel} · {file.rows} {t('s3aRowsEst')}
        </div>
      </div>
      <div className="fc-actions">
        <Chip onClick={onReplace}>{t('s3aReplace')}</Chip>
        <Chip className="chip fc-x" onClick={onRemove} aria-label={t('s3aRemove')}>
          ✕
        </Chip>
      </div>
    </div>
  );
}
