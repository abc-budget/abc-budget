import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type {
  ApplyColumnResult,
  ColumnRejectionDTO,
  EngineClient,
  ImportNextResult,
  Stage2ColumnDTO,
  Stage2SnapshotDTO,
} from '@abc-budget/engine';
import { useS3bSession } from './use-s3b-session';

/**
 * use-s3b-session — Task 4 hook spec (TDD, mock EngineClient).
 *
 * The hook holds the latest Stage2SnapshotDTO (seeded from ImportSessionContext
 * via its args), drives apply/reset/confirmRecall/resolveCollision/next over the
 * EngineClient seam, and derives the gate list + per-column state.
 */

// ── snapshot/column builders ─────────────────────────────────────────────────

function col(over: Partial<Omit<Stage2ColumnDTO, 'definition'>> & { definition?: string | null }): Stage2ColumnDTO {
  return {
    id: 'c0',
    originalName: { text: 'Col' },
    definition: null,
    params: null,
    recallState: null,
    sampleCells: [],
    ...over,
  } as Stage2ColumnDTO;
}

function snapshot(over?: Partial<Stage2SnapshotDTO>): Stage2SnapshotDTO {
  const columns = over?.columns ?? [
    col({ id: 'c0', originalName: { text: 'Date' }, definition: 'date', recallState: 'guessed' }),
    col({ id: 'c1', originalName: { text: 'Amount' }, definition: null }),
  ];
  const unmapped =
    over?.unmapped ??
    columns
      .filter((c) => c.definition === null)
      .map((c) => ({ id: c.id, name: 'text' in c.originalName ? c.originalName.text : c.originalName.key }));
  return {
    columns,
    recognized: over?.recognized ?? { n: 1, m: columns.length },
    lastSaveCollision: over?.lastSaveCollision ?? null,
    unmapped,
  };
}

function rejection(): ColumnRejectionDTO {
  return {
    errorCount: 8,
    totalCount: 10,
    threshold: 0.3,
    cellErrors: [
      { rowIndex: 0, message: { text: 'bad' } },
      { rowIndex: 3, message: { text: 'bad' } },
    ],
  };
}

function makeClient(over?: Partial<EngineClient>): EngineClient {
  return {
    ping: vi.fn(async (m: string) => m),
    getVersion: vi.fn(async () => ({ engine: '0.0.0', contract: 3 })),
    decode: vi.fn(),
    importStart: vi.fn(),
    importApplyColumn: vi.fn(),
    importResetColumn: vi.fn(),
    importConfirmRecall: vi.fn(async () => undefined),
    importResolveCollision: vi.fn(),
    importGetRows: vi.fn(),
    importNext: vi.fn(),
    importAbort: vi.fn(async () => undefined),
    getBaseCurrency: vi.fn(async () => 'UAH'),
    setBaseCurrency: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => {}),
    ...over,
  } as unknown as EngineClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useS3bSession', () => {
  it('seeds the snapshot + derives unmappedIds and per-column state', () => {
    const client = makeClient();
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    expect(result.current.snapshot.columns).toHaveLength(2);
    expect(result.current.unmappedIds).toEqual(['c1']);
    expect(result.current.recognized).toEqual({ n: 1, m: 2 });
    expect(result.current.stateOf('c0')).toBe('guessed');
    expect(result.current.stateOf('c1')).toBe('unknown');
  });

  it('apply ok → updates snapshot, builds engine params, clears any rejection', async () => {
    const applied = snapshot({
      columns: [
        col({ id: 'c0', originalName: { text: 'Date' }, definition: 'date', recallState: 'guessed' }),
        col({ id: 'c1', originalName: { text: 'Amount' }, definition: 'amount', recallState: 'confirmed' }),
      ],
      unmapped: [],
    });
    const importApplyColumn = vi.fn(
      async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: applied }),
    );
    const client = makeClient({ importApplyColumn });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    await act(async () => {
      await result.current.apply('c1', 'amount', { currency: 'auto', type: 'auto' });
    });

    expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'amount', {
      currency: 'auto',
      type: 'auto',
    });
    expect(result.current.unmappedIds).toEqual([]);
    expect(result.current.stateOf('c1')).toBe('confirmed');
    expect(result.current.rejection).toBeNull();
  });

  it('apply rejection → stores rejection keyed by columnId, column stays UNKNOWN', async () => {
    const rej = rejection();
    const importApplyColumn = vi.fn(
      async (): Promise<ApplyColumnResult> => ({ ok: false, rejection: rej }),
    );
    const client = makeClient({ importApplyColumn });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    await act(async () => {
      await result.current.apply('c1', 'amount', { currency: 'auto', type: 'auto' });
    });

    expect(result.current.rejection).toEqual({ columnId: 'c1', rejection: rej });
    expect(result.current.unmappedIds).toEqual(['c1']); // unchanged
    expect(result.current.stateOf('c1')).toBe('unknown');
  });

  it('applyInstant → applies with paramDefaults for the type', async () => {
    const importApplyColumn = vi.fn(
      async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: snapshot({ unmapped: [] }) }),
    );
    const client = makeClient({ importApplyColumn });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    await act(async () => {
      await result.current.applyInstant('c1', 'amount');
    });
    // amount's default UI values → engine params {currency:'auto', type:'auto'}
    expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'amount', {
      currency: 'auto',
      type: 'auto',
    });
  });

  it('applyInstant for a no-param type passes null params', async () => {
    const importApplyColumn = vi.fn(
      async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: snapshot({ unmapped: [] }) }),
    );
    const client = makeClient({ importApplyColumn });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    await act(async () => {
      await result.current.applyInstant('c1', 'description');
    });
    expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'description', null);
  });

  it('reset → importResetColumn → new snapshot + clears rejection for that column', async () => {
    const rej = rejection();
    const applyReject = vi.fn(
      async (): Promise<ApplyColumnResult> => ({ ok: false, rejection: rej }),
    );
    const reset = snapshot();
    const importResetColumn = vi.fn(async (): Promise<Stage2SnapshotDTO> => reset);
    const client = makeClient({ importApplyColumn: applyReject, importResetColumn });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    await act(async () => {
      await result.current.apply('c1', 'amount', { currency: 'auto', type: 'auto' });
    });
    expect(result.current.rejection).not.toBeNull();

    await act(async () => {
      await result.current.reset('c1');
    });
    expect(importResetColumn).toHaveBeenCalledWith('sess-1', 'c1');
    expect(result.current.rejection).toBeNull();
  });

  it('confirmRecall → optimistic local flip guessed→confirmed, reconciled by next snapshot', async () => {
    const importConfirmRecall = vi.fn(async () => undefined);
    const client = makeClient({ importConfirmRecall });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    expect(result.current.stateOf('c0')).toBe('guessed');

    await act(async () => {
      await result.current.confirmRecall('c0');
    });
    expect(importConfirmRecall).toHaveBeenCalledWith('sess-1', 'c0');
    // optimistic: the column reads as confirmed even though the engine returned void
    expect(result.current.stateOf('c0')).toBe('confirmed');
  });

  it('resolveCollision → importResolveCollision then refreshes snapshot via reset of a column', async () => {
    const withCollision = snapshot({
      lastSaveCollision: {
        kind: 'params-change',
        existing: { definition: 'amount', params: null },
        incoming: { definition: 'amount', params: null },
      } as Stage2SnapshotDTO['lastSaveCollision'],
    });
    const cleared = snapshot({ lastSaveCollision: null });
    const importResolveCollision = vi.fn(async () => undefined);
    const importResetColumn = vi.fn(async (): Promise<Stage2SnapshotDTO> => cleared);
    const client = makeClient({ importResolveCollision, importResetColumn });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', withCollision));

    expect(result.current.lastSaveCollision).not.toBeNull();

    await act(async () => {
      await result.current.resolveCollision(true);
    });
    expect(importResolveCollision).toHaveBeenCalledWith('sess-1', true);
    expect(result.current.lastSaveCollision).toBeNull();
  });

  it('next ok → returns the generate result for advance', async () => {
    const importNext = vi.fn(
      async (): Promise<ImportNextResult> => ({
        ok: true,
        result: { rows: [], rowErrors: [], skipped: [], structuralErrors: [] },
      }),
    );
    const client = makeClient({ importNext });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot({ unmapped: [] })));

    let res: Awaited<ReturnType<typeof result.current.next>> | undefined;
    await act(async () => {
      res = await result.current.next();
    });
    expect(importNext).toHaveBeenCalledWith('sess-1');
    expect(res?.ok).toBe(true);
  });

  it('next unmapped → returns the unmapped list (no advance)', async () => {
    const importNext = vi.fn(
      async (): Promise<ImportNextResult> => ({
        ok: false,
        unmapped: { unmappedColumns: [{ id: 'c1', name: 'Amount' }] },
      }),
    );
    const client = makeClient({ importNext });
    const { result } = renderHook(() => useS3bSession(client, 'sess-1', snapshot()));

    let res: Awaited<ReturnType<typeof result.current.next>> | undefined;
    await act(async () => {
      res = await result.current.next();
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.unmapped.unmappedColumns).toHaveLength(1);
  });

  it('re-seeds when the sessionId changes (S3a replace → fresh all-UNKNOWN)', async () => {
    const first = snapshot();
    const second = snapshot({
      columns: [
        col({ id: 'x0', originalName: { text: 'A' }, definition: null }),
        col({ id: 'x1', originalName: { text: 'B' }, definition: null }),
      ],
    });
    const client = makeClient();
    const { result, rerender } = renderHook(
      ({ sid, snap }: { sid: string; snap: Stage2SnapshotDTO }) => useS3bSession(client, sid, snap),
      { initialProps: { sid: 'sess-1', snap: first } },
    );
    expect(result.current.unmappedIds).toEqual(['c1']);

    rerender({ sid: 'sess-2', snap: second });
    await waitFor(() => {
      expect(result.current.unmappedIds).toEqual(['x0', 'x1']);
    });
  });

  it('does NOT clobber the live snapshot when the same sessionId re-renders (back→forward keeps applied state)', async () => {
    const seed = snapshot();
    const applied = snapshot({
      columns: [
        col({ id: 'c0', originalName: { text: 'Date' }, definition: 'date', recallState: 'guessed' }),
        col({ id: 'c1', originalName: { text: 'Amount' }, definition: 'amount', recallState: 'confirmed' }),
      ],
      unmapped: [],
    });
    const importApplyColumn = vi.fn(
      async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: applied }),
    );
    const client = makeClient({ importApplyColumn });
    const { result, rerender } = renderHook(
      ({ snap }: { snap: Stage2SnapshotDTO }) => useS3bSession(client, 'sess-1', snap),
      { initialProps: { snap: seed } },
    );

    await act(async () => {
      await result.current.apply('c1', 'amount', { currency: 'auto', type: 'auto' });
    });
    expect(result.current.unmappedIds).toEqual([]);

    // Same sessionId re-render (the seed prop is identity-stable) must NOT reset.
    rerender({ snap: seed });
    expect(result.current.unmappedIds).toEqual([]);
    expect(result.current.stateOf('c1')).toBe('confirmed');
  });
});
