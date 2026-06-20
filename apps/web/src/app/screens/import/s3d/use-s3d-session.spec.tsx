import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor, act } from '@testing-library/react';
import { useS3dSession } from './use-s3d-session';
import { makeClient, reviewWindow, summary } from './fixtures';

afterEach(cleanup);

describe('useS3dSession', () => {
  it('does NOT fetch until active', () => {
    const client = makeClient();
    renderHook(() => useS3dSession(client, 'sess-d', false));
    expect(client.importReview).not.toHaveBeenCalled();
  });

  it('loads ONE window + categories on active; summary comes from the wire', async () => {
    const client = makeClient({
      importReview: vi.fn(async () => reviewWindow({ summary: summary({ total: 9, ok: 5, error: 2, skipped: 1, dup: 1, newCount: 4 }) })),
    });
    const { result } = renderHook(() => useS3dSession(client, 'sess-d', true));
    await waitFor(() => expect(result.current.summary.total).toBe(9));
    expect(client.importReview).toHaveBeenCalledWith('sess-d', { offset: 0, count: 5000 });
    expect(result.current.summary).toEqual({ total: 9, ok: 5, error: 2, skipped: 1, dup: 1, newCount: 4 });
    expect(result.current.categoryIndex.get('groceries')?.name).toBe('Groceries');
    expect(result.current.hasErrors).toBe(true);
    expect(result.current.canSave).toBe(false); // errors present, unacked
  });

  it('ack toggles canSave when errors present', async () => {
    const client = makeClient({ importReview: vi.fn(async () => reviewWindow({ summary: summary({ total: 1, ok: 0, error: 1, skipped: 0, dup: 0, newCount: 0 }) })) });
    const { result } = renderHook(() => useS3dSession(client, 'sess-d', true));
    await waitFor(() => expect(result.current.hasErrors).toBe(true));
    expect(result.current.canSave).toBe(false);
    act(() => result.current.setAck(true));
    expect(result.current.canSave).toBe(true);
  });

  it('commit() drives review→saving→saved and exposes rowsCommitted from the wire', async () => {
    const client = makeClient({ importCommit: vi.fn(async () => ({ sessionId: 'sess-d', rowsCommitted: 7 })) });
    const { result } = renderHook(() => useS3dSession(client, 'sess-d', true));
    await waitFor(() => expect(result.current.summary.total).toBe(1));
    await act(async () => { await result.current.commit(); });
    expect(client.importCommit).toHaveBeenCalledWith('sess-d');
    expect(result.current.phase).toBe('saved');
    expect(result.current.rowsCommitted).toBe(7);
  });

  it('commit failure resets to review and rethrows (fail-loud, retry-able)', async () => {
    const client = makeClient({ importCommit: vi.fn(async () => { throw new Error('RatesUnavailableError'); }) });
    const { result } = renderHook(() => useS3dSession(client, 'sess-d', true));
    await waitFor(() => expect(result.current.summary.total).toBe(1));
    await act(async () => { await expect(result.current.commit()).rejects.toThrow('RatesUnavailableError'); });
    expect(result.current.phase).toBe('review');
  });
});
