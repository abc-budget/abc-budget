import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { DecodeResult, EngineClient, Stage2SnapshotDTO } from '@abc-budget/engine';
import { localeToCurrency } from '@abc-budget/engine';
import { EngineClientProvider } from '../engine-client-context';
import { LangProvider } from '../i18n/LangProvider';
import { ImportFlow } from './ImportFlow';

/**
 * Gate #1 + useBlocker exit-protection (2.7). The flow renders inside a
 * data router (useBlocker needs one); the EngineClient arrives via the
 * provider seam — no '../engine' module, no Worker.
 */

function makeSnapshot(n: number, m: number): Stage2SnapshotDTO {
  return {
    columns: Array.from({ length: m }, (_, i) => ({
      id: `c${i}`,
      originalName: { text: `Колонка ${i + 1}` },
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
    importStart: vi.fn(async () => ({ sessionId: 'sess-flow', stage2: makeSnapshot(1, 2) })),
    importApplyColumn: vi.fn(),
    importResetColumn: vi.fn(),
    importConfirmRecall: vi.fn(),
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

/** Async since Task 4: the base-currency probe gates the S3a body — the file
 *  input only exists once getBaseCurrency() resolved (non-null here). */
async function dropFile(name = 'statement.csv') {
  fireEvent.change(await screen.findByTestId('s3a-file-input'), {
    target: { files: [new File(['a,b\n1,2'], name, { type: 'text/csv' })] },
  });
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('ImportFlow — the canAdvance matrix (gate #1, FEAT-009)', () => {
  it('idle → Далі disabled (visual + inert)', () => {
    renderFlow(makeClient());
    expect(nextKey().disabled).toBe(true);
    expect(nextKey().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(nextKey());
    expect(screen.getByText('КРОК 1 / 4')).toBeTruthy();
  });

  it('decoding → Далі stays disabled (progress render included)', async () => {
    const dec = deferred<DecodeResult>();
    renderFlow(makeClient({ decode: vi.fn(() => dec.promise) }));
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-decoding')).toBeTruthy());
    expect(nextKey().disabled).toBe(true);
  });

  it('error → Далі stays disabled; retry returns to idle (still disabled)', async () => {
    renderFlow(makeClient({ decode: vi.fn(async () => Promise.reject(new Error('boom'))) }));
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-error')).toBeTruthy());
    expect(nextKey().disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Обрати інший файл' }));
    expect(screen.getByTestId('s3a-dropzone')).toBeTruthy();
    expect(nextKey().disabled).toBe(true);
  });

  it('recognized (n>0) → Далі enabled and advances to S3b', async () => {
    renderFlow(makeClient());
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    expect(nextKey().disabled).toBe(false);
    fireEvent.click(nextKey());
    expect(screen.getByText('КРОК 2 / 4')).toBeTruthy();
  });

  it('unknown (n=0) → equally a legitimate proceed path', async () => {
    renderFlow(
      makeClient({ importStart: vi.fn(async () => ({ sessionId: 's0', stage2: makeSnapshot(0, 3) })) }),
    );
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-unknown')).toBeTruthy());
    expect(nextKey().disabled).toBe(false);
    fireEvent.click(nextKey());
    expect(screen.getByText('КРОК 2 / 4')).toBeTruthy();
  });
});

describe('ImportFlow — transitions through the real components', () => {
  it('drop → decoding (live progress render from an onEvent emission) → recognized', async () => {
    const dec = deferred<DecodeResult>();
    let listener: ((evt: { event: string; jobId: string; phase: string; done: number; total: number }) => void) | null =
      null;
    const client = makeClient({
      decode: vi.fn(() => dec.promise),
      onEvent: vi.fn((cb: typeof listener) => {
        listener = cb;
        return () => {
          listener = null;
        };
      }),
    });
    renderFlow(client);
    await dropFile('big.csv');
    await waitFor(() => expect(screen.getByTestId('s3a-decoding')).toBeTruthy());
    // PROGRESS-DURING-DECODE: an intermediate event renders honest numbers
    listener!({ event: 'progress', jobId: '5', phase: 'decode', done: 1200, total: 10000 });
    await waitFor(() => expect(screen.getByText('1200 / 10000 рядків')).toBeTruthy());
    dec.resolve(makeDecodeResult());
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
  });

  it('remove → importAbort(sessionId) → back to the drop zone', async () => {
    const client = makeClient();
    renderFlow(client);
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати' }));
    await waitFor(() => expect(screen.getByTestId('s3a-dropzone')).toBeTruthy());
    expect(client.importAbort).toHaveBeenCalledExactlyOnceWith('sess-flow');
  });

  it('sample link → fetch → the same recognized path', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2').buffer as ArrayBuffer;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes })));
    const client = makeClient();
    renderFlow(client);
    fireEvent.click(await screen.findByRole('button', { name: '↳ Спробувати на прикладі' }));
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    expect(client.decode).toHaveBeenCalledWith(bytes, 'sample-statement.csv');
    vi.unstubAllGlobals();
  });
});

describe('ImportFlow — useBlocker exit-protection', () => {
  async function startSession(client: EngineClient) {
    const router = renderFlow(client);
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    return router;
  }

  it('no session → Назад leaves to /dashboard with NO modal', () => {
    renderFlow(makeClient());
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('screen-dashboard')).toBeTruthy();
  });

  it('active session → navigation is blocked behind the confirm modal', async () => {
    await startSession(makeClient());
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(screen.getByRole('dialog', { name: 'Перервати імпорт?' })).toBeTruthy();
    expect(screen.queryByTestId('screen-dashboard')).toBeNull(); // still on /import
  });

  it('«Залишитись» resets the blocker — modal closes, flow intact', async () => {
    const client = makeClient();
    await startSession(client);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(screen.getByRole('button', { name: 'Залишитись' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByTestId('s3a-recognized')).toBeTruthy();
    expect(client.importAbort).not.toHaveBeenCalled();
  });

  it('«Перервати й вийти» → importAbort(sessionId) THEN proceed to /dashboard', async () => {
    const client = makeClient();
    await startSession(client);
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перервати й вийти' }));
    await waitFor(() => expect(screen.getByTestId('screen-dashboard')).toBeTruthy());
    expect(client.importAbort).toHaveBeenCalledExactlyOnceWith('sess-flow');
  });
});

describe('ImportFlow — session context for S3b (2.8 seam)', () => {
  it('s3b placeholder still renders after advancing (the context provider wraps the steps)', async () => {
    renderFlow(makeClient());
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    fireEvent.click(nextKey());
    expect(screen.getByText('Колонки')).toBeTruthy();
  });
});

describe('ImportFlow — cold-start base-currency gate (Task 4, ENT-019)', () => {
  const unsetClient = (over?: Record<string, unknown>) =>
    makeClient({ getBaseCurrency: vi.fn(async () => null), ...over });

  it('unset → the dialog gates BEFORE any file work (no file input until the probe; then scrim over an inert S3a)', async () => {
    renderFlow(unsetClient());
    // probe in flight: the S3a body is withheld — no interactive DropZone yet
    expect(screen.queryByTestId('s3a-file-input')).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: 'Базова валюта' });
    // the dialog IS the scrim element — it covers the S3a rendered behind it
    expect(dialog.classList.contains('modal-scrim')).toBe(true);
    expect(screen.getByTestId('s3a-dropzone')).toBeTruthy();
  });

  it('set → no dialog, straight to S3a', async () => {
    renderFlow(makeClient()); // getBaseCurrency → 'UAH'
    await screen.findByTestId('s3a-dropzone');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('confirm → setBaseCurrency(selected iso) → dialog closes → S3a active', async () => {
    const langSpy = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US');
    const client = unsetClient();
    renderFlow(client);
    await screen.findByRole('dialog', { name: 'Базова валюта' });
    fireEvent.click(screen.getByRole('button', { name: 'Далі ▸' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.setBaseCurrency).toHaveBeenCalledExactlyOnceWith('USD');
    // S3a is live: a drop now walks the normal path
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    langSpy.mockRestore();
  });

  it("cancel → navigate('/') (Onboarding pre-data); nothing persisted", async () => {
    const client = unsetClient();
    const router = renderFlow(client);
    await screen.findByRole('dialog', { name: 'Базова валюта' });
    fireEvent.click(screen.getByRole('button', { name: 'Скасувати' }));
    await waitFor(() => expect(screen.getByTestId('screen-root')).toBeTruthy());
    expect(router.state.location.pathname).toBe('/');
    expect(client.setBaseCurrency).not.toHaveBeenCalled();
  });

  it('LOCKOUT PIN (decision 3): sv-SE → SEK (REAL localeToCurrency, outside the curated 8) preselects in the LOWER optgroup and first-run completes end-to-end', async () => {
    expect(localeToCurrency('sv-SE')).toBe('SEK'); // the real mapping, not a fixture
    const langSpy = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('sv-SE');
    const client = unsetClient();
    renderFlow(client);
    await screen.findByRole('dialog', { name: 'Базова валюта' });
    const select = screen.getByTestId('s3a-basecur-select') as HTMLSelectElement;
    expect(select.value).toBe('SEK');
    const opt = select.querySelector('option[value="SEK"]')!;
    expect((opt.closest('optgroup') as HTMLOptGroupElement).label).toBe('Усі валюти'); // the LOWER group
    fireEvent.click(screen.getByRole('button', { name: 'Далі ▸' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(client.setBaseCurrency).toHaveBeenCalledExactlyOnceWith('SEK');
    // no lockout: the flow completes — S3a accepts a file and reaches a proceed state
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    langSpy.mockRestore();
  });
});
