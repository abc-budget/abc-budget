import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CategoryDTO, EngineClient, ReviewSummaryDTO, ReviewWindowDTO,
} from '@abc-budget/engine';

export type S3dFilter = 'all' | 'error' | 'skip' | 'both';
export type S3dPhase = 'review' | 'saving' | 'saved';

export interface S3dSession {
  readonly window: ReviewWindowDTO;
  readonly summary: ReviewSummaryDTO;
  readonly rows: readonly ReviewWindowDTO['rows'][number][];
  readonly categoryIndex: Map<string, CategoryDTO>;
  readonly filter: S3dFilter;
  setFilter(f: S3dFilter): void;
  readonly page: number;
  setPage(p: number): void;
  readonly ack: boolean;
  setAck(a: boolean): void;
  readonly phase: S3dPhase;
  readonly hasErrors: boolean;
  readonly canSave: boolean;
  commit(): Promise<void>;
  readonly rowsCommitted: number;
}

const EMPTY_SUMMARY: ReviewSummaryDTO = { total: 0, ok: 0, error: 0, skipped: 0, dup: 0, newCount: 0 };
const EMPTY_WINDOW: ReviewWindowDTO = { summary: EMPTY_SUMMARY, rows: [] };
/** One window covers any realistic statement; the engine returns min(count,total).
 *  summary stays full-set authoritative regardless of the window size. */
const WINDOW_COUNT = 5000;

export function useS3dSession(client: EngineClient, sessionId: string, active = true): S3dSession {
  const [reviewWindow, setReviewWindow] = useState<ReviewWindowDTO>(EMPTY_WINDOW);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [filter, setFilter] = useState<S3dFilter>('all');
  const [page, setPage] = useState(0);
  const [ack, setAck] = useState(false);
  const [phase, setPhase] = useState<S3dPhase>('review');
  const [rowsCommitted, setRowsCommitted] = useState(0);

  // Re-fetch on EVERY active-true transition (S3c upstream edits change the review).
  useEffect(() => {
    if (!active) return;
    if (!sessionId) { setReviewWindow(EMPTY_WINDOW); setCategories([]); return; }
    let live = true;
    setFilter('all'); setPage(0); setAck(false); setPhase('review');
    void (async () => {
      const [win, cats] = await Promise.all([
        client.importReview(sessionId, { offset: 0, count: WINDOW_COUNT }),
        client.categoriesList(),
      ]);
      if (!live) return;
      setReviewWindow(win);
      setCategories(cats);
    })();
    return () => { live = false; };
  }, [client, sessionId, active]);

  const categoryIndex = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const summary = reviewWindow.summary;
  const hasErrors = summary.error > 0;
  const canSave = !hasErrors || ack;

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const commit = useCallback(async () => {
    if ((hasErrors && !ack) || phaseRef.current !== 'review') return;
    setPhase('saving');
    try {
      const res = await client.importCommit(sessionId);
      setRowsCommitted(res.rowsCommitted);
      setPhase('saved');
    } catch (err) {
      setPhase('review'); // fail-loud: session not freed on RatesUnavailableError → retry-able
      throw err;
    }
  }, [client, sessionId, hasErrors, ack]);

  return {
    window: reviewWindow, summary, rows: reviewWindow.rows, categoryIndex,
    filter, setFilter, page, setPage, ack, setAck, phase, hasErrors, canSave, commit, rowsCommitted,
  };
}
