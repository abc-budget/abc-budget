import { useCallback, useRef, useState } from 'react';
import type { EngineClient, Stage2SnapshotDTO } from '@abc-budget/engine';
import type { FileChipFile } from './FileChip';

/**
 * S3a session state machine (Story 2.7, Task 3) — owns the file → decode →
 * importStart lifecycle over the EngineClient seam (the client arrives as an
 * argument; tests inject a mock, production injects the worker-backed client).
 *
 * States: idle | decoding | recognized | unknown | error.
 *
 * PROGRESS-DURING-DECODE: the hook subscribes to onEvent BEFORE calling
 * decode().  The transport keeps the decode call's jobId internal (jobId =
 * the wire request id, never returned to the caller), so correlation is
 * by-construction: S3a allows ONE decode at a time (the decoding guard below),
 * therefore the first 'decode'-phase progress event observed inside the window
 * IS ours — its jobId is bound and any other jobId is ignored thereafter.
 *
 * FATAL vs note decode issues: 'file-unreadable' and 'no-data' abort the flow
 * (error state, HC-7 loud); every other DecodeAction ('skipped-row',
 * 'kept-raw', 'padded-row', 'truncated-row', 'recovered-quote',
 * 'renamed-column') is a per-row/per-column NOTE — the decoder already
 * recovered, the flow proceeds (the notes surface in S3d's log at 2.10).
 *
 * Second file while decoding: IGNORED (not abort-and-restart) — one decode at
 * a time keeps the progress correlation exact and the abort semantics trivial;
 * the drop zone is not even rendered while decoding, so the guard only fends
 * off programmatic/race double-calls.
 */

export type S3aState = 'idle' | 'decoding' | 'recognized' | 'unknown' | 'error';

/** Why the decode failed — the container localizes ЩО/ЧОМУ/ДІЯ from the kind. */
export interface S3aError {
  readonly kind: 'file-unreadable' | 'no-data' | 'generic';
}

export interface S3aSession {
  state: S3aState;
  /** Transient file view-model (lean source, 2.6 — nothing persists at 2.7). */
  file: FileChipFile | null;
  /** Live decode progress off the 2.6 events ({0,0} until the first event). */
  progress: { done: number; total: number };
  snapshot: Stage2SnapshotDTO | null;
  sessionId: string | null;
  error: S3aError | null;
  /** decode meta.otherSheets ([] when none) — surfaces as a neutral note. */
  otherSheets: string[];
  onFile: (file: File) => void;
  onSample: () => void;
  replace: () => void;
  remove: () => void;
  retry: () => void;
  /** Abort (if a session exists) + reset; resolves AFTER the abort — the
   *  useBlocker Leave path awaits it before proceeding. */
  abandon: () => Promise<void>;
}

export const SAMPLE_STATEMENT_URL = '/sample-statement.csv';
const SAMPLE_STATEMENT_NAME = 'sample-statement.csv';

/** Prototype humanSize verbatim (s3a-i18n.jsx) — latin units, locale-free. */
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

const FATAL_ACTIONS = new Set(['file-unreadable', 'no-data']);

/** Blob.arrayBuffer where available (browsers); FileReader fallback (jsdom). */
function readFileBytes(f: File): Promise<ArrayBuffer> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('file read failed'));
    reader.readAsArrayBuffer(f);
  });
}

export function useS3aSession(client: EngineClient): S3aSession {
  const [state, setState] = useState<S3aState>('idle');
  const [file, setFile] = useState<FileChipFile | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [snapshot, setSnapshot] = useState<Stage2SnapshotDTO | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<S3aError | null>(null);
  const [otherSheets, setOtherSheets] = useState<string[]>([]);

  /** The decoding guard + the abort target survive across render closures. */
  const decodingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    setState('idle');
    setFile(null);
    setProgress({ done: 0, total: 0 });
    setSnapshot(null);
    setSessionId(null);
    sessionIdRef.current = null;
    setError(null);
    setOtherSheets([]);
  }, []);

  const ingest = useCallback(
    async (name: string, getBytes: () => Promise<ArrayBuffer>) => {
      if (decodingRef.current) return; // guard: second file while decoding → ignored
      decodingRef.current = true;
      setState('decoding');
      setFile({ name, sizeLabel: '', rows: 0 });
      setProgress({ done: 0, total: 0 });
      setSnapshot(null);
      setError(null);
      setOtherSheets([]);

      // PROGRESS-DURING-DECODE: subscribe BEFORE decode; bind the first
      // 'decode'-phase jobId observed (the only in-flight decode is ours).
      let boundJobId: string | null = null;
      const unsubscribe = client.onEvent((evt) => {
        if (evt.event !== 'progress' || evt.phase !== 'decode') return;
        boundJobId ??= evt.jobId;
        if (evt.jobId === boundJobId) setProgress({ done: evt.done, total: evt.total });
      });

      try {
        const bytes = await getBytes();
        const sizeLabel = humanSize(bytes.byteLength);
        setFile({ name, sizeLabel, rows: 0 });
        const decoded = await client.decode(bytes, name);
        const fatal = decoded.issues.find((i) => FATAL_ACTIONS.has(i.action));
        if (fatal) {
          setError({ kind: fatal.action as S3aError['kind'] });
          setState('error');
          return;
        }
        const { sessionId: sid, stage2 } = await client.importStart(decoded.rows);
        setFile({ name, sizeLabel, rows: decoded.meta.decodedRows });
        setOtherSheets(decoded.meta.otherSheets ?? []);
        setSessionId(sid);
        sessionIdRef.current = sid;
        setSnapshot(stage2);
        setState(stage2.recognized.n > 0 ? 'recognized' : 'unknown');
      } catch {
        // arrayBuffer/fetch/decode/importStart rejection — LOUD generic error
        setError({ kind: 'generic' });
        setState('error');
      } finally {
        decodingRef.current = false;
        unsubscribe();
      }
    },
    [client],
  );

  const onFile = useCallback(
    (f: File) => {
      void ingest(f.name, () => readFileBytes(f));
    },
    [ingest],
  );

  const onSample = useCallback(() => {
    void ingest(SAMPLE_STATEMENT_NAME, async () => {
      const res = await fetch(SAMPLE_STATEMENT_URL);
      if (!res.ok) throw new Error(`sample fetch failed: ${res.status}`);
      return res.arrayBuffer();
    });
  }, [ingest]);

  const abandon = useCallback(async () => {
    const sid = sessionIdRef.current;
    sessionIdRef.current = null;
    try {
      if (sid !== null) await client.importAbort(sid);
    } finally {
      reset();
    }
  }, [client, reset]);

  const replace = useCallback(() => void abandon(), [abandon]);
  const remove = useCallback(() => void abandon(), [abandon]);
  /** Error state never holds a session — a plain reset suffices. */
  const retry = useCallback(() => reset(), [reset]);

  return { state, file, progress, snapshot, sessionId, error, otherSheets, onFile, onSample, replace, remove, retry, abandon };
}
