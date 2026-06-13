import { Key, Panel, PanelBody, PanelHeader } from '../../../../ui/altus/components';
import { useT } from '../../../i18n/LangProvider';
import './s3a.css';

/**
 * The ЩО/ЧОМУ/ДІЯ rows, decode-issue-driven: the container maps engine decode
 * issues to localized copy and passes the RESULT — this component never sees
 * issue keys. The s3aErrWhatV/errWhyV/errDoV catalog entries are the
 * container's generic-read-failure defaults.
 */
export interface DecodeErrorView {
  what: string;
  why: string;
  action: string;
}

export interface ErrorPanelProps {
  /** The failing file, if one was selected (sizeLabel optional — a 0-byte file has none useful). */
  file: { name: string; sizeLabel?: string } | null;
  error: DecodeErrorView;
  onRetry: () => void;
}

/**
 * S3a error state — the file could not be read (HC-7: fail LOUD).
 * Presentational port of design-reference/s3a-app.jsx ErrorPanel:
 * orange lamp, file line, CRT ЩО/ЧОМУ/ДІЯ readout, retry key.
 */
export function ErrorPanel({ file, error, onRetry }: ErrorPanelProps) {
  const t = useT();
  return (
    <div className="result" data-testid="s3a-error">
      <Panel className="errpanel">
        <PanelHeader lamp="orange" title={t('s3aErrTag')} />
        <PanelBody>
          {file && (
            <div className="err-file f-mono">
              ✕ {file.name}
              {file.sizeLabel ? ' · ' + file.sizeLabel : ''}
            </div>
          )}
          <div className="crt err-crt">
            <div className="err-line">
              <span className="err-key f-mono">{t('s3aErrWhat')}</span>
              <span className="f-mono err-v">{error.what}</span>
            </div>
            <div className="err-line">
              <span className="err-key f-mono">{t('s3aErrWhy')}</span>
              <span className="f-mono err-v">{error.why}</span>
            </div>
            <div className="err-line">
              <span className="err-key f-mono" style={{ color: 'var(--gold)' }}>{t('s3aErrDo')}</span>
              <span className="f-mono err-v" style={{ color: 'var(--cream)' }}>{error.action}</span>
            </div>
          </div>
          <Key
            variant="orange"
            onClick={onRetry}
            icon={
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 7 A8 8 0 1 1 4 13" />
                <path d="M4 3 V7 H8" />
              </svg>
            }
          >
            {t('s3aTryAgain')}
          </Key>
        </PanelBody>
      </Panel>
    </div>
  );
}
