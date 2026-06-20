import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { LangProvider } from '../../../i18n/LangProvider';
import { S3dReview } from './S3dReview';
import { reviewRow, summary, CATS } from './fixtures';
import type { S3dSession } from './use-s3d-session';

afterEach(cleanup);

function fakeSession(over: Partial<S3dSession> = {}): S3dSession {
  return {
    window: { summary: summary(), rows: [reviewRow()] },
    summary: summary(), rows: [reviewRow()],
    categoryIndex: new Map(CATS.map((c) => [c.id, c])),
    filter: 'all', setFilter: () => {}, page: 0, setPage: () => {},
    ack: false, setAck: () => {}, phase: 'review', hasErrors: false, canSave: true,
    commit: async () => {}, rowsCommitted: 0,
    ...over,
  };
}
function renderS3d(session: S3dSession) {
  render(<LangProvider><S3dReview session={session} /></LangProvider>);
}

describe('S3dReview', () => {
  it('tiles come from window.summary, NOT a recompute of rows (drift-trap 1)', () => {
    // summary says 5 ok / 2 error but rows has only 1 row → tiles must show the summary.
    renderS3d(fakeSession({
      summary: summary({ total: 9, ok: 5, error: 2, skipped: 1, dup: 1, newCount: 4 }),
      rows: [reviewRow()],
      hasErrors: true,
    }));
    expect(screen.getByTestId('stat-ok').textContent).toContain('5');
    expect(screen.getByTestId('stat-error').textContent).toContain('2');
    expect(screen.getByTestId('stat-dup').textContent).toContain('1');
    expect(screen.getByTestId('sum-new').textContent).toContain('4'); // newCount, not rows.length
  });

  it('renders the reason from row.reasons via resolveMessage (drift-trap 2 — no subcode switch)', () => {
    const errRow = reviewRow({ rowIndex: 3, state: 'error', categoryId: null, amount: null, currency: null,
      reasons: [{ text: 'Could not parse date "31/13/2026"' }] });
    renderS3d(fakeSession({ summary: summary({ total: 1, ok: 0, error: 1, newCount: 0 }), rows: [errRow], hasErrors: true }));
    expect(screen.getByText('Could not parse date "31/13/2026"')).toBeTruthy();
  });

  it('category resolves through categoryIndex; null → catNone (drift-trap 3)', () => {
    renderS3d(fakeSession({ rows: [reviewRow({ categoryId: 'groceries' }), reviewRow({ rowIndex: 1, categoryId: null })],
      summary: summary({ total: 2, ok: 2, newCount: 2 }) }));
    expect(screen.getByText('Groceries')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0); // catNone cell
  });

  it('label column shows description (drift-trap 4); a dup ok-row is marked is-dup not skipped', () => {
    const dupRow = reviewRow({ rowIndex: 2, description: 'NETFLIX', dup: true, state: 'ok' });
    const { container } = render(<LangProvider><S3dReview session={fakeSession({
      rows: [dupRow], summary: summary({ total: 1, ok: 1, dup: 1, newCount: 0 }) })} /></LangProvider>);
    expect(screen.getByText('NETFLIX')).toBeTruthy();
    expect(container.querySelector('.rev-row.is-dup')).toBeTruthy();
    expect(container.querySelector('.rev-row.st-skipped')).toBeNull(); // dup is NOT skipped
  });

  it('filter chips show counts from summary (drift-trap 1)', () => {
    renderS3d(fakeSession({ summary: summary({ total: 9, ok: 5, error: 2, skipped: 1, dup: 1, newCount: 4 }),
      rows: [reviewRow()], hasErrors: true }));
    // the "Only errors · 2" + "Only skipped · 1" chips read from summary
    expect(screen.getByText(/· 2/)).toBeTruthy();
    expect(screen.getByText(/· 1/)).toBeTruthy();
  });

  it('saved phase renders SavedPanel using rowsCommitted (drift-trap 6), NOT newCount', () => {
    renderS3d(fakeSession({ phase: 'saved', rowsCommitted: 7,
      summary: summary({ total: 10, ok: 8, dup: 2, newCount: 8 }) }));
    expect(screen.getByText(/7/)).toBeTruthy(); // rowsCommitted in the saved body
  });
});
