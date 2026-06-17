import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type {
  ApplyColumnResult,
  DecodeResult,
  EngineClient,
  ImportNextResult,
  Stage2SnapshotDTO,
} from '@abc-budget/engine';
import { EngineClientProvider } from '../engine-client-context';
import { LangProvider } from '../i18n/LangProvider';
import { ImportFlow } from './ImportFlow';

/**
 * Story 2.8 Task 4 — ImportFlow step-2 wiring: gate #2 (Option A) + the two
 * «Назад»→S3a back-nav semantics. The flow runs through a data router with a
 * mocked EngineClient (no Worker).
 */

function makeSnapshot(over?: Partial<Stage2SnapshotDTO>): Stage2SnapshotDTO {
  // 2 columns: c0 mapped (date, guessed), c1 UNKNOWN by default.
  const columns = over?.columns ?? [
    {
      id: 'c0',
      originalName: { text: 'Дата' },
      definition: 'date' as Stage2SnapshotDTO['columns'][number]['definition'],
      params: null,
      recallState: 'guessed' as const,
      sampleCells: [{ value: '01.01' }],
    },
    {
      id: 'c1',
      originalName: { text: 'Сума' },
      definition: null,
      params: null,
      recallState: null,
      sampleCells: [{ value: '-10' }],
    },
  ];
  return {
    columns,
    recognized: over?.recognized ?? { n: 1, m: columns.length },
    lastSaveCollision: over?.lastSaveCollision ?? null,
    unmapped:
      over?.unmapped ??
      columns.filter((c) => c.definition === null).map((c) => ({ id: c.id, name: 'Сума' })),
  };
}

/** A fully-mapped snapshot (gate #2 passes). */
function mappedSnapshot(): Stage2SnapshotDTO {
  return makeSnapshot({
    columns: [
      {
        id: 'c0',
        originalName: { text: 'Дата' },
        definition: 'date' as Stage2SnapshotDTO['columns'][number]['definition'],
        params: null,
        recallState: 'guessed',
        sampleCells: [{ value: '01.01' }],
      },
      {
        id: 'c1',
        originalName: { text: 'Сума' },
        definition: 'amount' as Stage2SnapshotDTO['columns'][number]['definition'],
        params: null,
        recallState: 'confirmed',
        sampleCells: [{ value: '-10' }],
      },
    ],
    unmapped: [],
  });
}

function makeDecodeResult(): DecodeResult {
  return {
    rows: [{ Дата: '01.01.2026', Сума: '-1,00' }],
    issues: [],
    meta: { format: 'csv', headerRow: 0, totalRows: 1, decodedRows: 1 },
  };
}

function makeClient(over?: Record<string, unknown>): EngineClient {
  return {
    ping: vi.fn(async (m: string) => m),
    getVersion: vi.fn(async () => ({ engine: '0.0.0', contract: 3 })),
    decode: vi.fn(async () => makeDecodeResult()),
    importStart: vi.fn(async () => ({ sessionId: 'sess-s3b', stage2: makeSnapshot() })),
    importApplyColumn: vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: mappedSnapshot() })),
    importResetColumn: vi.fn(async () => makeSnapshot()),
    importConfirmRecall: vi.fn(async () => undefined),
    importResolveCollision: vi.fn(async () => undefined),
    importGetRows: vi.fn(),
    importNext: vi.fn(
      async (): Promise<ImportNextResult> => ({
        ok: true,
        result: { rows: [], rowErrors: [], skipped: [], structuralErrors: [] },
      }),
    ),
    importAbort: vi.fn(async () => undefined),
    getBaseCurrency: vi.fn(async () => 'UAH'),
    setBaseCurrency: vi.fn(async () => undefined),
    // v4 categorization surface (S3c mounts its session hook alongside S3b)
    importCategorizedRows: vi.fn(async () => ({ rows: [], total: 0, matchCount: 0 })),
    importConditionFields: vi.fn(async () => []),
    importWhy: vi.fn(async () => ({ manual: null, rules: [], winnerRuleId: null })),
    importRulesList: vi.fn(async () => []),
    rulesCreate: vi.fn(async () => ({ ruleId: 1 })),
    categoriesList: vi.fn(async () => []),
    categoriesCreate: vi.fn(async () => ({ id: 'c', name: 'C', icon: 'other', currency: 'UAH' })),
    // v5 sandbox surface — the S3c session hook probes sandboxState on mount
    // (navigate-away resume); this flow never engages a sandbox, so all LIVE.
    rulesClassify: vi.fn(async () => 'live'),
    rulesSubmitEdit: vi.fn(async () => ({ engaged: false, count: 0 })),
    sandboxState: vi.fn(async () => ({ engaged: false, count: 0 })),
    sandboxApply: vi.fn(async () => undefined),
    sandboxCancel: vi.fn(async () => undefined),
    onEvent: vi.fn(() => () => {}),
    ...over,
  } as unknown as EngineClient;
}

function renderFlow(client: EngineClient) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="screen-root" /> },
      { path: '/import', element: <ImportFlow /> },
      { path: '/dashboard', element: <div data-testid="screen-dashboard" /> },
    ],
    { initialEntries: ['/import'] },
  );
  render(
    <LangProvider initialLang="uk">
      <EngineClientProvider client={client}>
        <RouterProvider router={router} />
      </EngineClientProvider>
    </LangProvider>,
  );
  return router;
}

const nextKey = () => screen.getByRole('button', { name: 'Далі' }) as HTMLButtonElement;
const backKey = () => screen.getByRole('button', { name: 'Назад' }) as HTMLButtonElement;

async function dropFile(name = 'statement.csv') {
  fireEvent.change(await screen.findByTestId('s3a-file-input'), {
    target: { files: [new File(['a,b\n1,2'], name, { type: 'text/csv' })] },
  });
}

/** Advance S3a → S3b. */
async function reachS3b(client: EngineClient) {
  const router = renderFlow(client);
  await dropFile();
  await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
  fireEvent.click(nextKey());
  await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());
  return router;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ImportFlow — gate #2 (Option A, fails closed)', () => {
  it('«Далі» is always active at S3b (Option A)', async () => {
    await reachS3b(makeClient());
    expect(nextKey().disabled).toBe(false);
  });

  it('≥1 UNKNOWN → press «Далі» → loud BlockPanel names the column, NO advance', async () => {
    await reachS3b(makeClient()); // c1 (Сума) is UNKNOWN
    fireEvent.click(nextKey());
    // block panel appears, the unmapped column is named, importNext NOT called
    expect(screen.getByText(/Є КОЛОНКИ БЕЗ ТИПУ/i)).toBeTruthy();
    expect(screen.getByText('Сума', { selector: '.block-chip' })).toBeTruthy();
    // still on step 2
    expect(screen.getByText('КРОК 2 / 4')).toBeTruthy();
  });

  it('all-UNKNOWN → BlockPanel names every column', async () => {
    const client = makeClient({
      importStart: vi.fn(async () => ({
        sessionId: 'sess-allunk',
        stage2: makeSnapshot({
          columns: [
            { id: 'c0', originalName: { text: 'A' }, definition: null, params: null, recallState: null, sampleCells: [] },
            { id: 'c1', originalName: { text: 'B' }, definition: null, params: null, recallState: null, sampleCells: [] },
          ],
          recognized: { n: 0, m: 2 },
          unmapped: [
            { id: 'c0', name: 'A' },
            { id: 'c1', name: 'B' },
          ],
        }),
      })),
    });
    const router = renderFlow(client);
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-unknown')).toBeTruthy());
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());
    fireEvent.click(nextKey());
    expect(screen.getByText('A', { selector: '.block-chip' })).toBeTruthy();
    expect(screen.getByText('B', { selector: '.block-chip' })).toBeTruthy();
    expect(client.importNext).not.toHaveBeenCalled();
    void router;
  });

  // EP-2 epic-close FINDING-EP-1: the gate's «ДІЯ» must be REACHABLE — clicking
  // «Перейти до першої» from the block view must return to mapping AND open the
  // first unmapped column's type-menu, from which the user can map it. The 2.8
  // matrix only asserted the gate BLOCKS + NAMES columns, never that the jump
  // affordance WORKS — so a dead no-op slipped through. This is the missing
  // behavioral test-with-teeth.
  it('block view → «Перейти до першої» returns to mapping with the first unmapped column menu OPEN + mappable (FINDING-EP-1)', async () => {
    const client = makeClient();
    await reachS3b(client); // c1 (Сума) is UNKNOWN
    fireEvent.click(nextKey()); // → loud block view
    expect(screen.getByText(/Є КОЛОНКИ БЕЗ ТИПУ/i)).toBeTruthy();

    // The gate's remediation button — the whole point of the finding.
    fireEvent.click(screen.getByRole('button', { name: 'Перейти до першої' }));

    // Block overlay dismissed → back to the mapping view…
    expect(screen.queryByText(/Є КОЛОНКИ БЕЗ ТИПУ/i)).toBeNull();
    // …with the first unmapped column's type-menu OPEN (the affordance WORKS).
    const typeOptions = await screen.findAllByRole('menuitemradio');
    expect(typeOptions.length).toBeGreaterThan(0);

    // And the user can actually MAP it from there (e.g. → Опис/description).
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Опис' }));
    await waitFor(() => expect(client.importApplyColumn).toHaveBeenCalled());
    const lastCall = (client.importApplyColumn as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(lastCall?.[1]).toBe('c1');
    expect(lastCall?.[2]).toBe('description');
  });

  it('zero-UNKNOWN → press «Далі» → importNext → advance to S3c', async () => {
    const importNext = vi.fn(
      async (): Promise<ImportNextResult> => ({
        ok: true,
        result: { rows: [], rowErrors: [], skipped: [], structuralErrors: [] },
      }),
    );
    const client = makeClient({
      importStart: vi.fn(async () => ({ sessionId: 'sess-mapped', stage2: mappedSnapshot() })),
      importNext,
    });
    const router = renderFlow(client);
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());

    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
    expect(importNext).toHaveBeenCalledExactlyOnceWith('sess-mapped');
    void router;
  });

  it('recalled-only (all guessed) → advances with no mandatory action (decision #2)', async () => {
    const importNext = vi.fn(
      async (): Promise<ImportNextResult> => ({
        ok: true,
        result: { rows: [], rowErrors: [], skipped: [], structuralErrors: [] },
      }),
    );
    const guessedOnly = makeSnapshot({
      columns: [
        {
          id: 'c0',
          originalName: { text: 'Дата' },
          definition: 'date' as Stage2SnapshotDTO['columns'][number]['definition'],
          params: null,
          recallState: 'guessed',
          sampleCells: [],
        },
        {
          id: 'c1',
          originalName: { text: 'Сума' },
          definition: 'amount' as Stage2SnapshotDTO['columns'][number]['definition'],
          params: null,
          recallState: 'guessed',
          sampleCells: [],
        },
      ],
      unmapped: [],
    });
    const client = makeClient({
      importStart: vi.fn(async () => ({ sessionId: 'sess-guessed', stage2: guessedOnly })),
      importNext,
    });
    const router = renderFlow(client);
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
    expect(importNext).toHaveBeenCalledOnce();
    void router;
  });

  it('zero-UNKNOWN advance → WorkerProgressPanel renders live importNext progress before completing', async () => {
    let listener:
      | ((evt: { event: string; jobId: string; phase: string; done: number; total: number }) => void)
      | null = null;
    let resolveNext!: (v: ImportNextResult) => void;
    const importNext = vi.fn(
      () => new Promise<ImportNextResult>((res) => {
          resolveNext = res;
        }),
    );
    const client = makeClient({
      importStart: vi.fn(async () => ({ sessionId: 'sess-big', stage2: mappedSnapshot() })),
      importNext,
      onEvent: vi.fn((cb: typeof listener) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
    });
    const router = renderFlow(client);
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());

    fireEvent.click(nextKey()); // advance → worker takeover, importNext in flight
    await waitFor(() => expect(screen.getByText(/ВЕЛИКИЙ ФАЙЛ/i)).toBeTruthy());
    // a live 'generate' progress event drives the honest gauge
    listener!({ event: 'progress', jobId: 'j', phase: 'generate', done: 3000, total: 10000 });
    await waitFor(() => expect(screen.getByText(/30%/)).toBeTruthy());

    resolveNext({ ok: true, result: { rows: [], rowErrors: [], skipped: [], structuralErrors: [] } });
    await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
    void router;
  });

  it('zero-UNKNOWN → advance renders the S3c categorize surface (the slot wiring)', async () => {
    const client = makeClient({
      importStart: vi.fn(async () => ({ sessionId: 'sess-s3c', stage2: mappedSnapshot() })),
      importCategorizedRows: vi.fn(async () => ({
        rows: [
          {
            rowIndex: 0,
            date: '2026-03-14',
            amount: -10,
            currency: 'UAH',
            description: 'АТБ',
            counterparty: null,
            account: null,
            bankCategory: null,
            mcc: 5411,
            categoryId: 'g',
            isManual: 0 as const,
            ruleId: 1,
          },
        ],
        total: 1,
        matchCount: 1,
      })),
      importConditionFields: vi.fn(async () => [{ field: 'desc', valueKind: 'text' as const, operators: ['contains'] }]),
      categoriesList: vi.fn(async () => [{ id: 'g', name: 'Продукти', icon: 'groceries', currency: 'UAH' }]),
    });
    const router = renderFlow(client);
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());
    fireEvent.click(nextKey());
    // S3c renders after S3b (the stepper advanced + the categorize body mounted)
    await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId('s3c-categorize')).toBeTruthy());
    // it loaded its window against the LIVE session id
    expect(client.importCategorizedRows).toHaveBeenCalledWith('sess-s3c', {
      offset: 0,
      count: 240,
      segment: 'all',
    });
    await waitFor(() => expect(screen.getByText('Продукти')).toBeTruthy());
    void router;
  });

  it('mapping an UNKNOWN column then «Далі» advances (gate clears after apply)', async () => {
    const client = makeClient(); // c1 UNKNOWN; importApplyColumn → mappedSnapshot()
    await reachS3b(client);
    // map c1 via the menu instant-pick
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));
    await waitFor(() => expect(client.importApplyColumn).toHaveBeenCalled());
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
  });
});

describe('ImportFlow — «Назад»→S3a (item 2 semantics)', () => {
  it('(i) S3b→back→S3a→forward→S3b preserves applied columns (no abort, no new importStart)', async () => {
    const client = makeClient();
    await reachS3b(client);

    // map c1 so the snapshot evolves
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));
    await waitFor(() => expect(client.importApplyColumn).toHaveBeenCalled());

    // «Назад» → S3a (NO abort, NO modal — same step-stack navigation)
    fireEvent.click(backKey());
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    expect(client.importAbort).not.toHaveBeenCalled();

    // forward again → S3b shows the SAME (mapped) state; no second importStart
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());
    expect(client.importStart).toHaveBeenCalledOnce();
    // the previously-mapped column passes the gate now (advance works)
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
  });

  it('(ii) S3b→back→S3a→replace file → importAbort → new importStart → S3b all-UNKNOWN', async () => {
    let startCount = 0;
    const client = makeClient({
      importStart: vi.fn(async () => {
        startCount += 1;
        // first session has c1 UNKNOWN; the replaced session is all-UNKNOWN
        return startCount === 1
          ? { sessionId: 'sess-1', stage2: makeSnapshot() }
          : {
              sessionId: 'sess-2',
              stage2: makeSnapshot({
                columns: [
                  { id: 'x0', originalName: { text: 'P' }, definition: null, params: null, recallState: null, sampleCells: [] },
                  { id: 'x1', originalName: { text: 'Q' }, definition: null, params: null, recallState: null, sampleCells: [] },
                ],
                recognized: { n: 0, m: 2 },
                unmapped: [
                  { id: 'x0', name: 'P' },
                  { id: 'x1', name: 'Q' },
                ],
              }),
            };
      }),
    });
    await reachS3b(client);

    // back to S3a (non-destructive)
    fireEvent.click(backKey());
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());

    // replace the file → S3a aborts the old session + starts a fresh one
    fireEvent.click(screen.getByRole('button', { name: 'Замінити' }));
    await waitFor(() => expect(client.importAbort).toHaveBeenCalledWith('sess-1'));
    await dropFile('other.csv');
    await waitFor(() => expect(screen.getByTestId('s3a-unknown')).toBeTruthy());
    expect(startCount).toBe(2);

    // forward → the fresh S3b starts all-UNKNOWN (staged mappings discarded)
    fireEvent.click(nextKey());
    await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());
    fireEvent.click(nextKey());
    expect(screen.getByText('P', { selector: '.block-chip' })).toBeTruthy();
    expect(screen.getByText('Q', { selector: '.block-chip' })).toBeTruthy();
  });

  it('S3b «Назад» shows NO leave-confirm modal (it is internal step nav, not a flow exit)', async () => {
    await reachS3b(makeClient());
    fireEvent.click(backKey());
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
  });
});
