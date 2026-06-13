import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type {
  DecodeResult,
  EngineClient,
  EngineEventPayload,
  Stage2SnapshotDTO,
} from '@abc-budget/engine';
import { useS3aSession } from './use-s3a-session';

// ── Mock client (the EngineClient seam — no '../engine' module, no Worker) ────

type Listener = (event: EngineEventPayload) => void;

function makeSnapshot(n: number, m: number): Stage2SnapshotDTO {
  return {
    columns: Array.from({ length: m }, (_, i) => ({
      id: `c${i}`,
      originalName: { text: `Колонка ${i}` },
      definition: i < n ? ('date' as Stage2SnapshotDTO['columns'][number]['definition']) : null,
      params: null,
      recallState: i < n ? ('guessed' as const) : null,
      sampleCells: [],
    })),
    recognized: { n, m },
    lastSaveCollision: null,
    unmapped: [],
  };
}

function makeDecodeResult(over?: Partial<DecodeResult>): DecodeResult {
  return {
    rows: [{ Дата: '01.01.2026', Сума: '-10,00' }],
    issues: [],
    meta: {
      format: 'csv',
      headerRow: 0,
      totalRows: 12,
      decodedRows: 12,
    },
    ...over,
  };
}

function makeClient(over?: Partial<EngineClient>) {
  const listeners = new Set<Listener>();
  const client = {
    ping: vi.fn(async (m: string) => m),
    getVersion: vi.fn(async () => ({ engine: '0.0.0', contract: 3 })),
    decode: vi.fn(async () => makeDecodeResult()),
    importStart: vi.fn(async () => ({ sessionId: 'sess-1', stage2: makeSnapshot(2, 3) })),
    importApplyColumn: vi.fn(),
    importResetColumn: vi.fn(),
    importConfirmRecall: vi.fn(),
    importResolveCollision: vi.fn(),
    importGetRows: vi.fn(),
    importNext: vi.fn(),
    importAbort: vi.fn(async () => undefined),
    getBaseCurrency: vi.fn(async () => 'UAH'),
    setBaseCurrency: vi.fn(async () => undefined),
    onEvent: vi.fn((cb: Listener) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    }),
    ...over,
  } as unknown as EngineClient;
  const emit = (event: EngineEventPayload) => {
    for (const cb of listeners) cb(event);
  };
  return { client, emit, listeners };
}

const csvFile = (name = 'statement.csv', content = 'a,b\n1,2') =>
  new File([content], name, { type: 'text/csv' });

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ── Transitions ───────────────────────────────────────────────────────────────

describe('useS3aSession — onFile happy path', () => {
  it('starts idle with an empty surface', () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useS3aSession(client));
    expect(result.current.state).toBe('idle');
    expect(result.current.file).toBeNull();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.sessionId).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.otherSheets).toEqual([]);
  });

  it('onFile → decoding immediately, then recognized (n>0) with sessionId + snapshot + honest row count', async () => {
    const dec = deferred<DecodeResult>();
    const { client } = makeClient({ decode: vi.fn(() => dec.promise) });
    const { result } = renderHook(() => useS3aSession(client));

    act(() => result.current.onFile(csvFile('statement-june.csv')));
    expect(result.current.state).toBe('decoding');
    expect(result.current.file?.name).toBe('statement-june.csv');

    await act(async () => dec.resolve(makeDecodeResult({ meta: { format: 'csv', headerRow: 0, totalRows: 30, decodedRows: 30 } })));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    expect(result.current.sessionId).toBe('sess-1');
    expect(result.current.snapshot?.recognized).toEqual({ n: 2, m: 3 });
    expect(result.current.file?.rows).toBe(30);
    expect(client.importStart).toHaveBeenCalledWith(makeDecodeResult().rows);
  });

  it('n === 0 → unknown', async () => {
    const { client } = makeClient({
      importStart: vi.fn(async () => ({ sessionId: 'sess-0', stage2: makeSnapshot(0, 5) })),
    });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(result.current.state).toBe('unknown'));
    expect(result.current.sessionId).toBe('sess-0');
  });

  it('decode meta.otherSheets surfaces on the hook (empty array when absent)', async () => {
    const { client } = makeClient({
      decode: vi.fn(async () =>
        makeDecodeResult({
          meta: { format: 'xlsx', headerRow: 0, totalRows: 5, decodedRows: 5, sheet: 'Виписка', otherSheets: ['Курси', 'Нотатки'] },
        }),
      ),
    });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile('book.xlsx')));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    expect(result.current.otherSheets).toEqual(['Курси', 'Нотатки']);
  });

  it('file sizeLabel is human-readable from the decoded byte length', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useS3aSession(client));
    const big = csvFile('big.csv', 'x'.repeat(48200));
    await act(async () => result.current.onFile(big));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    expect(result.current.file?.sizeLabel).toBe('47 KB');
  });
});

// ── PROGRESS-DURING-DECODE ───────────────────────────────────────────────────

describe('useS3aSession — progress wiring (PROGRESS-DURING-DECODE)', () => {
  it('subscribes via onEvent BEFORE decode is called', async () => {
    const order: string[] = [];
    const dec = deferred<DecodeResult>();
    const { client } = makeClient({
      onEvent: vi.fn(() => {
        order.push('subscribe');
        return () => order.push('unsubscribe');
      }),
      decode: vi.fn(() => {
        order.push('decode');
        return dec.promise;
      }),
    });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(order).toContain('decode'));
    expect(order.slice(0, 2)).toEqual(['subscribe', 'decode']);
    await act(async () => dec.resolve(makeDecodeResult()));
    await waitFor(() => expect(order).toContain('unsubscribe'));
  });

  it('progress events for the in-flight decode update {done,total}; foreign jobIds are ignored after binding', async () => {
    const dec = deferred<DecodeResult>();
    const { client, emit } = makeClient({ decode: vi.fn(() => dec.promise) });
    const { result } = renderHook(() => useS3aSession(client));
    act(() => result.current.onFile(csvFile()));

    act(() => emit({ event: 'progress', jobId: '7', phase: 'decode', done: 100, total: 1000 }));
    expect(result.current.progress).toEqual({ done: 100, total: 1000 });

    // the binding: first observed decode-phase jobId wins; others are ignored
    act(() => emit({ event: 'progress', jobId: '99', phase: 'decode', done: 1, total: 2 }));
    expect(result.current.progress).toEqual({ done: 100, total: 1000 });

    act(() => emit({ event: 'progress', jobId: '7', phase: 'decode', done: 1000, total: 1000 }));
    expect(result.current.progress).toEqual({ done: 1000, total: 1000 });

    await act(async () => dec.resolve(makeDecodeResult()));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
  });

  it('non-decode phases and non-progress events never touch progress', async () => {
    const dec = deferred<DecodeResult>();
    const { client, emit } = makeClient({ decode: vi.fn(() => dec.promise) });
    const { result } = renderHook(() => useS3aSession(client));
    act(() => result.current.onFile(csvFile()));
    act(() => {
      emit({ event: 'progress', jobId: '7', phase: 'generate', done: 5, total: 10 });
      emit({ event: 'blocked' });
    });
    expect(result.current.progress).toEqual({ done: 0, total: 0 });
    await act(async () => dec.resolve(makeDecodeResult()));
  });
});

// ── Errors (HC-7 loud) ───────────────────────────────────────────────────────

describe('useS3aSession — decode errors', () => {
  it('file-unreadable issue → error state with the issue kind; importStart never called', async () => {
    const { client } = makeClient({
      decode: vi.fn(async () =>
        makeDecodeResult({
          rows: [],
          issues: [{ row: -1, what: 'file unreadable', why: 'SheetJS failed', action: 'file-unreadable' }],
        }),
      ),
    });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile('broken.xlsx')));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toEqual({ kind: 'file-unreadable' });
    expect(result.current.file?.name).toBe('broken.xlsx');
    expect(client.importStart).not.toHaveBeenCalled();
  });

  it('no-data issue → error state, kind no-data', async () => {
    const { client } = makeClient({
      decode: vi.fn(async () =>
        makeDecodeResult({ rows: [], issues: [{ row: -1, what: 'no data', why: 'zero rows', action: 'no-data' }] }),
      ),
    });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile('empty.csv', '')));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toEqual({ kind: 'no-data' });
  });

  it('note-level issues (skipped-row etc.) are NOT fatal — flow proceeds', async () => {
    const { client } = makeClient({
      decode: vi.fn(async () =>
        makeDecodeResult({
          issues: [
            { row: 3, what: 'row skipped', why: 'ragged', action: 'skipped-row' },
            { row: 5, what: 'renamed', why: 'duplicate header', action: 'renamed-column' },
          ],
        }),
      ),
    });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    expect(result.current.error).toBeNull();
  });

  it('decode rejection (worker died mid-job) → error state, kind generic', async () => {
    const { client } = makeClient({ decode: vi.fn(async () => Promise.reject(new Error('boom'))) });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toEqual({ kind: 'generic' });
  });

  it('retry() → back to idle, error cleared', async () => {
    const { client } = makeClient({ decode: vi.fn(async () => Promise.reject(new Error('boom'))) });
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(result.current.state).toBe('error'));
    await act(async () => result.current.retry());
    expect(result.current.state).toBe('idle');
    expect(result.current.error).toBeNull();
    expect(result.current.file).toBeNull();
    // no session existed — abort is a session affair only
    expect(client.importAbort).not.toHaveBeenCalled();
  });
});

// ── Replace / remove / guard ─────────────────────────────────────────────────

describe('useS3aSession — replace/remove/abandon + the decoding guard', () => {
  it('remove() aborts the active session (exact sessionId) and returns to idle', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    await act(async () => result.current.remove());
    expect(client.importAbort).toHaveBeenCalledExactlyOnceWith('sess-1');
    expect(result.current.state).toBe('idle');
    expect(result.current.sessionId).toBeNull();
    expect(result.current.snapshot).toBeNull();
    expect(result.current.file).toBeNull();
  });

  it('replace() takes the same abort path', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    await act(async () => result.current.replace());
    expect(client.importAbort).toHaveBeenCalledExactlyOnceWith('sess-1');
    expect(result.current.state).toBe('idle');
  });

  it('abandon() resolves after the abort completes (the useBlocker Leave path awaits it)', async () => {
    const { client } = makeClient();
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onFile(csvFile()));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    await act(async () => {
      await result.current.abandon();
    });
    expect(client.importAbort).toHaveBeenCalledExactlyOnceWith('sess-1');
    expect(result.current.state).toBe('idle');
  });

  it('a second onFile while decoding is IGNORED (one decode at a time)', async () => {
    const dec = deferred<DecodeResult>();
    const decode = vi.fn(() => dec.promise);
    const { client } = makeClient({ decode });
    const { result } = renderHook(() => useS3aSession(client));
    act(() => result.current.onFile(csvFile('first.csv')));
    await act(async () => result.current.onFile(csvFile('second.csv')));
    await waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
    expect(decode).toHaveBeenCalledTimes(1);
    expect(result.current.file?.name).toBe('first.csv');
    await act(async () => dec.resolve(makeDecodeResult()));
    await waitFor(() => expect(result.current.state).toBe('recognized'));
  });
});

// ── Sample path (FEAT-001 path 2) ────────────────────────────────────────────

describe('useS3aSession — onSample', () => {
  it('fetches /sample-statement.csv and runs the SAME decode→importStart path', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2').buffer as ArrayBuffer;
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes }));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = makeClient();
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onSample());
    await waitFor(() => expect(result.current.state).toBe('recognized'));
    expect(fetchMock).toHaveBeenCalledWith('/sample-statement.csv');
    expect(client.decode).toHaveBeenCalledWith(bytes, 'sample-statement.csv');
    expect(result.current.file?.name).toBe('sample-statement.csv');
  });

  it('a failed sample fetch is LOUD — error state, generic kind', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const { client } = makeClient();
    const { result } = renderHook(() => useS3aSession(client));
    await act(async () => result.current.onSample());
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error).toEqual({ kind: 'generic' });
    expect(client.decode).not.toHaveBeenCalled();
  });
});
