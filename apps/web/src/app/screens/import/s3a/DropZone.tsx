import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Key, Lamp } from '../../../../ui/altus/components';
import { useT } from '../../../i18n/LangProvider';
import './s3a.css';

export interface DropZoneProps {
  /** A file was dropped or picked (FEAT-001 path 1). */
  onFile: (file: File) => void;
  /** The bundled-sample path (FEAT-001 path 2). */
  onSample: () => void;
}

/**
 * S3a idle state — drag-and-drop zone + pick button + sample link.
 * Presentational port of design-reference/s3a-app.jsx DropZone:
 * props in, callbacks out; the container owns decode/session work.
 */
export function DropZone({ onFile, onSample }: DropZoneProps) {
  const t = useT();
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (files && files[0]) onFile(files[0]);
  };

  return (
    <div
      className={'dropzone' + (drag ? ' over' : '')}
      data-testid="s3a-dropzone"
      onDragOver={(e: DragEvent) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e: DragEvent) => {
        e.preventDefault();
        setDrag(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xls,.xlsx,text/csv"
        style={{ display: 'none' }}
        data-testid="s3a-file-input"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <span className="dz-plate">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 18 A4 4 0 0 1 6.5 10 A5.5 5.5 0 0 1 17.5 9.2 A3.8 3.8 0 0 1 17.5 18" />
          <path d="M12 11 V20 M8.5 16.5 L12 20 L15.5 16.5" stroke="var(--orange-deep)" />
        </svg>
      </span>
      <div className="dz-title f-disp">{t('s3aDropTitle')}</div>
      <div className="dz-or f-mono">{t('s3aDropOr')}</div>
      <Key
        variant="green"
        onClick={() => inputRef.current?.click()}
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 16 V19 A1 1 0 0 0 5 20 H19 A1 1 0 0 0 20 19 V16" />
            <path d="M12 4 V15 M8 8 L12 4 L16 8" />
          </svg>
        }
      >
        {t('s3aPick')}
      </Key>
      <div className="dz-formats f-mono">{t('s3aFormats')}</div>
      <div className="dz-local">
        <Lamp tone="green" />
        <span className="f-mono">{t('s3aLocalOnly')}</span>
      </div>
      <button type="button" className="dz-sample f-mono" onClick={onSample}>
        ↳ {t('s3aSample')}
      </button>
    </div>
  );
}
