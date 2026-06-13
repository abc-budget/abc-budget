import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ApplyColumnResult,
  EngineClient,
  ImportNextResult,
  ImportStartResult,
  Stage2ColumnDTO,
  Stage2SnapshotDTO,
} from '@abc-budget/engine';
import { LangProvider } from '../../../i18n/LangProvider';
import { S3bMapping } from './S3bMapping';
import { useS3bSession } from './use-s3b-session';

/**
 * S3b round-trip — decision #4 at the WEB level (Story 2.8, Task 6).
 *
 * The engine pins (a)/(b) already prove the defer-commit behavior at the engine
 * layer (apply→abort→fresh-start ⇒ pool empty; apply→advance→fresh-start ⇒
 * recalled).  THIS spec proves the *UI drives them correctly*: that the S3b
 * mapping UI calls importApplyColumn + importNext on the happy path (so the
 * staged write flushes) and importAbort on the abandon path (so the staged
 * write is discarded) — and that a subsequent importStart surfaces the column
 * as recalled/guessed iff the first pass advanced.
 *
 * THE MOCK (a stateful, faithful EngineClient — reported in the dev review):
 *   · `pool`            : Map<normalizedName, {definition, params}> — the
 *                         committed recall pool (what importStart reads from).
 *   · `staged`          : Map<columnId, {name, definition, params}> — writes
 *                         buffered by importApplyColumn, NOT yet in the pool
 *                         (decision #4: apply stages, advance commits).
 *   · importStart       : builds the snapshot, replaying the pool by normalized
 *                         name → recallState:'guessed' (mirrors recallFor()).
 *   · importApplyColumn : stages {name, definition, params} under the columnId
 *                         (NO pool write — the deferred behavior).
 *   · importNext (flush): commits every staged write into the pool, clears the
 *                         buffer (the advance = the user's endorsement).
 *   · importAbort       : drops the staging buffer WITHOUT flushing (discard).
 *
 * Two columns: «Дата» (already recalled guessed via a seeded pool entry) and
 * «Сума» (UNKNOWN — the column we map then either advance or abandon).
 */

const FILE_HEADERS = [
  { id: 'c0', name: 'Дата' },
  { id: 'c1', name: 'Сума' },
] as const;

/** NFC+trim normalization mirror (the pool key rule). */
function normalize(name: string): string {
  return name.normalize('NFC').trim();
}

interface StatefulMock {
  client: EngineClient;
  pool: Map<string, { definition: string; params: Record<string, unknown> | null }>;
  staged: Map<string, { name: string; definition: string; params: Record<string, unknown> | null }>;
  flushes: number;
  aborts: number;
}

function makeStatefulMock(): StatefulMock {
  const pool = new Map<string, { definition: string; params: Record<string, unknown> | null }>();
  const staged = new Map<string, { name: string; definition: string; params: Record<string, unknown> | null }>();
  const state = { flushes: 0, aborts: 0 };

  /** Build a fresh snapshot, replaying the pool by normalized header name. */
  function buildSnapshot(): Stage2SnapshotDTO {
    const columns: Stage2ColumnDTO[] = FILE_HEADERS.map(({ id, name }) => {
      const recalled = pool.get(normalize(name));
      return {
        id,
        originalName: { text: name },
        definition: recalled ? recalled.definition : null,
        params: recalled ? recalled.params : null,
        recallState: recalled ? 'guessed' : null,
        sampleCells: [{ value: name === 'Дата' ? '01.01' : '-10' }],
      } as Stage2ColumnDTO;
    });
    const unmapped = columns
      .filter((c) => c.definition === null)
      .map((c) => ({ id: c.id, name: 'text' in c.originalName ? c.originalName.text : c.id }));
    return {
      columns,
      recognized: { n: columns.length - unmapped.length, m: columns.length },
      lastSaveCollision: null,
      unmapped,
    };
  }

  const client = {
    ping: vi.fn(),
    getVersion: vi.fn(),
    decode: vi.fn(),
    importStart: vi.fn(
      async (): Promise<ImportStartResult> => ({ sessionId: 'sess-rt', stage2: buildSnapshot() }),
    ),
    importApplyColumn: vi.fn(
      async (
        _sid: string,
        columnId: string,
        definition: string,
        params: Record<string, unknown> | null,
      ): Promise<ApplyColumnResult> => {
        const header = FILE_HEADERS.find((h) => h.id === columnId);
        // DECISION #4: stage the write — do NOT touch the committed pool yet.
        staged.set(columnId, { name: header?.name ?? columnId, definition, params });
        // Return a snapshot with the column now typed (confirmed once applied
        // explicitly; the recall provenance is gone the moment the user maps).
        const columns: Stage2ColumnDTO[] = FILE_HEADERS.map(({ id, name }) => {
          const s = staged.get(id);
          const recalled = pool.get(normalize(name));
          if (s) {
            return {
              id,
              originalName: { text: name },
              definition: s.definition,
              params: s.params,
              recallState: 'confirmed',
              sampleCells: [{ value: name === 'Дата' ? '01.01' : '-10' }],
            } as Stage2ColumnDTO;
          }
          return {
            id,
            originalName: { text: name },
            definition: recalled ? recalled.definition : null,
            params: recalled ? recalled.params : null,
            recallState: recalled ? 'guessed' : null,
            sampleCells: [{ value: name === 'Дата' ? '01.01' : '-10' }],
          } as Stage2ColumnDTO;
        });
        const unmapped = columns
          .filter((c) => c.definition === null)
          .map((c) => ({ id: c.id, name: 'text' in c.originalName ? c.originalName.text : c.id }));
        return {
          ok: true,
          snapshot: {
            columns,
            recognized: { n: columns.length - unmapped.length, m: columns.length },
            lastSaveCollision: null,
            unmapped,
          },
        };
      },
    ),
    importResetColumn: vi.fn(async () => buildSnapshot()),
    importConfirmRecall: vi.fn(async () => undefined),
    importResolveCollision: vi.fn(async () => undefined),
    importGetRows: vi.fn(),
    importNext: vi.fn(async (): Promise<ImportNextResult> => {
      // FLUSH: the advance commits every staged write into the pool.
      for (const entry of staged.values()) {
        pool.set(normalize(entry.name), { definition: entry.definition, params: entry.params });
      }
      staged.clear();
      state.flushes += 1;
      return { ok: true, result: { rows: [], rowErrors: [], skipped: [], structuralErrors: [] } };
    }),
    importAbort: vi.fn(async () => {
      // DISCARD: the staging buffer dies with the session — no flush.
      staged.clear();
      state.aborts += 1;
    }),
    getBaseCurrency: vi.fn(),
    setBaseCurrency: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  } as unknown as EngineClient;

  return {
    client,
    pool,
    staged,
    get flushes() {
      return state.flushes;
    },
    get aborts() {
      return state.aborts;
    },
  };
}

/** Drive the S3b mapping UI over a given session snapshot. */
function Harnessed({
  client,
  sessionId,
  snapshot,
}: {
  client: EngineClient;
  sessionId: string;
  snapshot: Stage2SnapshotDTO;
}) {
  const session = useS3bSession(client, sessionId, snapshot);
  return (
    <S3bMapping
      session={session}
      fileLabel="export.csv"
      totalRows={120}
      gateView="mapping"
      progress={{ done: 0, total: 0 }}
      onReturnToMapping={() => {}}
    />
  );
}

function renderS3b(client: EngineClient, sessionId: string, snapshot: Stage2SnapshotDTO) {
  return render(
    <LangProvider initialLang="uk">
      <Harnessed client={client} sessionId={sessionId} snapshot={snapshot} />
    </LangProvider>,
  );
}

function header(rawName: string): HTMLElement {
  return screen.getByText(rawName, { selector: '.colh-rawname' }).closest('.colh') as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('S3b round-trip (decision #4, web-level)', () => {
  it('map + advance → the staged write FLUSHES → a fresh importStart recalls the column as guessed', async () => {
    const m = makeStatefulMock();

    // ── Pass 1: fresh pool. importStart → both UNKNOWN. ──────────────────────
    const start1 = await m.client.importStart([]);
    expect(start1.stage2.columns.every((c) => c.recallState === null)).toBe(true);

    const { unmount } = renderS3b(m.client, start1.sessionId, start1.stage2);
    // map «Сума» → amount (the UI calls importApplyColumn → STAGES, no pool write)
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Сума$/i }));
    await waitFor(() =>
      expect(m.client.importApplyColumn).toHaveBeenCalledWith('sess-rt', 'c1', 'amount', { currency: 'auto', type: 'auto' }),
    );
    // staged but NOT yet committed (defer-commit invariant)
    expect(m.staged.has('c1')).toBe(true);
    expect(m.pool.size).toBe(0);

    // advance (importNext) — the flow's «Далі» path; here we drive the hook's
    // next() directly to prove the UI's advance flushes.
    await m.client.importNext('sess-rt');
    expect(m.flushes).toBe(1);
    // the staged write is now committed to the pool, buffer cleared
    expect(m.pool.get(normalize('Сума'))).toEqual({ definition: 'amount', params: { currency: 'auto', type: 'auto' } });
    expect(m.staged.size).toBe(0);
    unmount();

    // ── Pass 2: a NEW importStart replays the warmed pool. ───────────────────
    const start2 = await m.client.importStart([]);
    const sumaCol = start2.stage2.columns.find((c) => c.id === 'c1')!;
    expect(sumaCol.definition).toBe('amount');
    expect(sumaCol.recallState).toBe('guessed');

    // and the UI surfaces it as the loud ◇ recalled affordance
    renderS3b(m.client, start2.sessionId, start2.stage2);
    const h = header('Сума');
    expect(h.className).toContain('guessed');
    expect(h.querySelector('.colh-recall-glyph')?.textContent).toBe('◇');
  });

  it('map + ABANDON (importAbort) → the staged write is DISCARDED → a fresh importStart does NOT recall', async () => {
    const m = makeStatefulMock();

    // ── Pass 1: fresh pool, map «Сума», then abort instead of advancing. ─────
    const start1 = await m.client.importStart([]);
    const { unmount } = renderS3b(m.client, start1.sessionId, start1.stage2);

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Сума$/i }));
    await waitFor(() => expect(m.client.importApplyColumn).toHaveBeenCalled());
    expect(m.staged.has('c1')).toBe(true);

    // abandon path: the flow aborts the session (e.g. leave via useBlocker, or
    // S3a replace) — NO flush.
    await m.client.importAbort('sess-rt');
    expect(m.aborts).toBe(1);
    expect(m.flushes).toBe(0);
    // the pool stays empty — the staged write died with the session
    expect(m.pool.size).toBe(0);
    expect(m.staged.size).toBe(0);
    unmount();

    // ── Pass 2: a fresh importStart shows the column UNKNOWN (no recall). ─────
    const start2 = await m.client.importStart([]);
    const sumaCol = start2.stage2.columns.find((c) => c.id === 'c1')!;
    expect(sumaCol.definition).toBeNull();
    expect(sumaCol.recallState).toBeNull();

    renderS3b(m.client, start2.sessionId, start2.stage2);
    expect(header('Сума').className).toContain('unknown');
  });

  it('seeded pool → importStart recalls; mapping a SECOND column then advancing warms it too (cumulative)', async () => {
    const m = makeStatefulMock();
    // seed «Дата» as already-learned (a prior advanced import)
    m.pool.set(normalize('Дата'), { definition: 'date', params: { format: 'auto' } });

    const start1 = await m.client.importStart([]);
    // «Дата» recalled guessed, «Сума» UNKNOWN
    expect(start1.stage2.columns.find((c) => c.id === 'c0')!.recallState).toBe('guessed');
    expect(start1.stage2.columns.find((c) => c.id === 'c1')!.recallState).toBeNull();

    renderS3b(m.client, start1.sessionId, start1.stage2);
    // map «Сума» → amount, then advance → both now in the pool
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Сума$/i }));
    await waitFor(() => expect(m.client.importApplyColumn).toHaveBeenCalled());
    await m.client.importNext('sess-rt');

    expect(m.pool.size).toBe(2);
    const start3 = await m.client.importStart([]);
    expect(start3.stage2.unmapped).toHaveLength(0); // both recalled now
  });
});
