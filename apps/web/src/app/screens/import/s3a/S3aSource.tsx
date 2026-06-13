import type { SerializedMessage, Stage2SnapshotDTO } from '@abc-budget/engine';
import { useT } from '../../../i18n/LangProvider';
import { DecodingPanel } from './DecodingPanel';
import { DropZone } from './DropZone';
import { ErrorPanel } from './ErrorPanel';
import type { DecodeErrorView } from './ErrorPanel';
import { RecognizedPanel } from './RecognizedPanel';
import type { RecognizedSummary } from './RecognizedPanel';
import { UnknownPanel } from './UnknownPanel';
import type { S3aError, S3aSession } from './use-s3a-session';
import './s3a.css';

export interface S3aSourceProps {
  /** The session lives in ImportFlow (it must survive step changes — the
   *  context hands {sessionId, snapshot} to S3b at 2.8); S3a only renders it. */
  session: S3aSession;
}

/** Column names off the wire are Native text messages; keys never reach here. */
const nameOf = (m: SerializedMessage): string => ('text' in m ? m.text : m.key);

function toRecognizedSummary(snapshot: Stage2SnapshotDTO): RecognizedSummary {
  return {
    n: snapshot.recognized.n,
    m: snapshot.recognized.m,
    cols: snapshot.columns.map((c) => ({ name: nameOf(c.originalName), definition: c.definition })),
  };
}

/**
 * S3a container — maps useS3aSession state to the Task-2 presentational
 * components. Partial vs full recognized is RecognizedPanel's own n<m logic;
 * unknown (n=0) routes to UnknownPanel. The ЩО/ЧОМУ/ДІЯ rows derive from the
 * FATAL issue kind here (the hook stays language-free), with the catalog's
 * generic *V defaults as the fallback.
 */
export function S3aSource({ session }: S3aSourceProps) {
  const t = useT();
  const { state, file, progress, snapshot, error, otherSheets } = session;

  const errorView = (e: S3aError | null): DecodeErrorView => ({
    what: t('s3aErrWhatV'),
    why:
      e?.kind === 'no-data'
        ? t('s3aErrWhyNoData')
        : e?.kind === 'file-unreadable'
          ? t('s3aErrWhyUnreadable')
          : t('s3aErrWhyV'),
    action: t('s3aErrDoV'),
  });

  const recog = snapshot ? toRecognizedSummary(snapshot) : null;

  return (
    <div data-testid="s3a-source">
      {state === 'idle' && <DropZone onFile={session.onFile} onSample={session.onSample} />}
      {state === 'decoding' && file && (
        <DecodingPanel fileName={file.name} done={progress.done} total={progress.total} />
      )}
      {state === 'recognized' && file && recog && (
        <RecognizedPanel file={file} recog={recog} onReplace={session.replace} onRemove={session.remove} />
      )}
      {state === 'unknown' && file && recog && (
        <UnknownPanel file={file} recog={recog} onReplace={session.replace} onRemove={session.remove} />
      )}
      {state === 'error' && (
        <ErrorPanel
          file={file ? { name: file.name, sizeLabel: file.sizeLabel || undefined } : null}
          error={errorView(error)}
          onRetry={session.retry}
        />
      )}
      {(state === 'recognized' || state === 'unknown') && otherSheets.length > 0 && (
        <div className="othersheets-note f-mono" data-testid="s3a-othersheets">
          ▸ {t('s3aOtherSheets', { names: otherSheets.join(', ') })}
        </div>
      )}
    </div>
  );
}
