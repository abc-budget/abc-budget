import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type {
  ApplyColumnResult,
  CommitResultDTO,
  DecodeResult,
  EngineClient,
  ImportNextResult,
  ReviewWindowDTO,
  Stage2SnapshotDTO,
} from '@abc-budget/engine';
import { EngineClientProvider } from '../engine-client-context';
import { LangProvider } from '../i18n/LangProvider';
import { ImportFlow } from './ImportFlow';

/**
 * Story 5.4 Task 5 — ImportFlow S3d wiring: phase-aware footer + S3dReview renders
 * at step 4. Drives the flow through all 4 steps using a mocked EngineClient (no Worker).
 */

function makeSnapshot(over?: Partial<Stage2SnapshotDTO>): Stage2SnapshotDTO {
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
      definition: 'amount' as Stage2SnapshotDTO['columns'][number]['definition'],
      params: null,
      recallState: 'confirmed' as const,
      sampleCells: [{ value: '-10' }],
    },
  ];
  return {
    columns,
    recognized: over?.recognized ?? { n: 2, m: columns.length },
    lastSaveCollision: over?.lastSaveCollision ?? null,
    unmapped: over?.unmapped ?? [],
  };
}

function makeDecodeResult(): DecodeResult {
  return {
    rows: [{ Дата: '01.01.2026', Сума: '-1,00' }],
    issues: [],
    meta: { format: 'csv', headerRow: 0, totalRows: 1, decodedRows: 1 },
  };
}

function makeReviewWindow(over?: Partial<ReviewWindowDTO>): ReviewWindowDTO {
  return {
    summary: {
      total: 2,
      ok: 2,
      error: 0,
      skipped: 0,
      dup: 0,
      newCount: 2,
      ...(over?.summary ?? {}),
    },
    rows: over?.rows ?? [
      {
        rowIndex: 0,
        state: 'ok',
        dup: false,
        date: '2026-01-01',
        description: 'АТБ',
        amount: -100,
        currency: 'UAH',
        categoryId: null,
        reasons: [],
      },
      {
        rowIndex: 1,
        state: 'ok',
        dup: false,
        date: '2026-01-02',
        description: 'Сільпо',
        amount: -200,
        currency: 'UAH',
        categoryId: null,
        reasons: [],
      },
    ],
  };
}

function makeCommitResult(rowsCommitted = 2): CommitResultDTO {
  return { sessionId: 'sess-s3d', rowsCommitted };
}

function makeClient(over?: Record<string, unknown>): EngineClient {
  return {
    ping: vi.fn(async (m: string) => m),
    getVersion: vi.fn(async () => ({ engine: '0.0.0', contract: 8 })),
    decode: vi.fn(async () => makeDecodeResult()),
    importStart: vi.fn(async () => ({ sessionId: 'sess-s3d', stage2: makeSnapshot() })),
    importApplyColumn: vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: makeSnapshot() })),
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
    importCommit: vi.fn(async () => makeCommitResult()),
    importReview: vi.fn(async () => makeReviewWindow()),
    getBaseCurrency: vi.fn(async () => 'UAH'),
    setBaseCurrency: vi.fn(async () => undefined),
    // v4 categorization surface (S3c mounts alongside S3b)
    importCategorizedRows: vi.fn(async () => ({ rows: [], total: 0, matchCount: 0, remainderCount: 0 })),
    importConditionFields: vi.fn(async () => []),
    importWhy: vi.fn(async () => ({ manual: null, rules: [], winnerRuleId: null })),
    importRulesList: vi.fn(async () => []),
    rulesCreate: vi.fn(async () => ({ ruleId: 1 })),
    categoriesList: vi.fn(async () => []),
    categoriesCreate: vi.fn(async () => ({ id: 'c', name: 'C', icon: 'other', currency: 'UAH' })),
    // v5 sandbox surface
    rulesClassify: vi.fn(async () => 'live'),
    rulesSubmitEdit: vi.fn(async () => ({ engaged: false, count: 0 })),
    sandboxState: vi.fn(async () => ({ engaged: false, count: 0 })),
    sandboxApply: vi.fn(async () => undefined),
    sandboxCancel: vi.fn(async () => undefined),
    // v6 auto-other + typicality surface
    importRemainderMagnitude: vi.fn(async () => ({
      opCount: 0, totalOpCount: 0, baseCurrency: 'UAH', baseTotal: 0, pending: [], approx: false, lastRemainderCategoryId: null,
    })),
    importAssignRemainder: vi.fn(async () => undefined),
    importTypicality: vi.fn(async () => ({ flags: [] })),
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

/** Advance through S3a → S3b → S3c → S3d (step 4). */
async function reachS3d(client: EngineClient) {
  const router = renderFlow(client);
  // S3a: drop file, wait for recognized, click Next
  await dropFile();
  await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
  fireEvent.click(nextKey());
  // S3b: wait for mapping panel, click Next (all columns mapped → importNext)
  await waitFor(() => expect(screen.getByTestId('s3b-mapping')).toBeTruthy());
  fireEvent.click(nextKey());
  // S3c: wait for КРОК 3/4, click Next
  await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
  // S3c needs remainderCount === 0 to enable Next
  await waitFor(() => {
    const btn = screen.getByRole('button', { name: 'Далі' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
  fireEvent.click(nextKey());
  // S3d: wait for step 4
  await waitFor(() => expect(screen.getByText('КРОК 4 / 4')).toBeTruthy());
  return router;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('ImportFlow — S3d wiring (Task 5)', () => {
  it('reaching step 4 renders S3dReview (the screen-import shell is present)', async () => {
    const client = makeClient();
    await reachS3d(client);
    expect(screen.getByTestId('screen-import')).toBeTruthy();
    // The review panel or summary panel should be visible (s3d body renders)
    await waitFor(() => expect(client.importReview).toHaveBeenCalledWith('sess-s3d', { offset: 0, count: 5000 }));
  });

  it('save button (Зберегти N) calls importCommit and transitions to the saved panel', async () => {
    const importCommit = vi.fn(async () => makeCommitResult(2));
    const client = makeClient({ importCommit });
    await reachS3d(client);

    // Wait for importReview to complete and the Save button to appear
    const saveBtn = await screen.findByRole('button', { name: /Зберегти|Save/ });
    expect(saveBtn).toBeTruthy();
    // With no errors, button should be enabled
    expect((saveBtn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(saveBtn);
    await waitFor(() => expect(importCommit).toHaveBeenCalled());
    // After commit, saved phase: «До бюджету» and «Імпортувати ще» appear in footer
    await waitFor(() => expect(screen.getByRole('button', { name: /До бюджету|To budget/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /Імпортувати ще|Import another/ })).toBeTruthy();
  });

  it('saved phase shows «До бюджету» which navigates to /dashboard', async () => {
    const client = makeClient();
    const router = await reachS3d(client);

    const saveBtn = await screen.findByRole('button', { name: /Зберегти|Save/ });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: /До бюджету|To budget/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /До бюджету|To budget/ }));
    await waitFor(() => expect(screen.getByTestId('screen-dashboard')).toBeTruthy());
    void router;
  });

  it('saved phase shows «Імпортувати ще» which resets to step 1', async () => {
    const client = makeClient();
    await reachS3d(client);

    const saveBtn = await screen.findByRole('button', { name: /Зберегти|Save/ });
    fireEvent.click(saveBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: /Імпортувати ще|Import another/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Імпортувати ще|Import another/ }));
    await waitFor(() => expect(screen.getByText('КРОК 1 / 4')).toBeTruthy());
  });

  it('with errors present, save button is disabled until ack checkbox is toggled', async () => {
    const reviewWithErrors = makeReviewWindow({
      summary: { total: 3, ok: 1, error: 2, skipped: 0, dup: 0, newCount: 1 },
      rows: [
        {
          rowIndex: 0,
          state: 'ok',
          dup: false,
          date: '2026-01-01',
          description: 'АТБ',
          amount: -100,
          currency: 'UAH',
          categoryId: null,
          reasons: [],
        },
        {
          rowIndex: 1,
          state: 'error',
          dup: false,
          date: '2026-01-02',
          description: 'Помилка',
          amount: -200,
          currency: 'UAH',
          categoryId: null,
          reasons: [{ key: 'MISSING_RATE', params: {} }],
        },
        {
          rowIndex: 2,
          state: 'error',
          dup: false,
          date: '2026-01-03',
          description: 'Помилка 2',
          amount: -300,
          currency: 'UAH',
          categoryId: null,
          reasons: [{ key: 'MISSING_RATE', params: {} }],
        },
      ],
    });
    const client = makeClient({
      importReview: vi.fn(async () => reviewWithErrors),
    });
    await reachS3d(client);

    // Wait for importReview to settle and save button to appear
    await waitFor(() => expect(client.importReview).toHaveBeenCalled());

    // Save button is disabled (errors present, ack not checked)
    const saveBtn = await screen.findByRole('button', { name: /Зберегти|Save/ });
    expect((saveBtn as HTMLButtonElement).disabled).toBe(true);

    // The ack checkbox appears in the footer (· separator distinguishes it)
    const ackCheck = screen.getByRole('checkbox') as HTMLInputElement;
    expect(ackCheck).toBeTruthy();
    expect(ackCheck.checked).toBe(false);

    // Toggle the ack checkbox
    fireEvent.click(ackCheck);
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Зберегти|Save/ }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it('«Назад» from S3d (review phase) returns to S3c', async () => {
    const client = makeClient();
    await reachS3d(client);

    // Back button should be present in review phase
    const back = backKey();
    expect(back).toBeTruthy();
    fireEvent.click(back);
    await waitFor(() => expect(screen.getByText('КРОК 3 / 4')).toBeTruthy());
  });
});
