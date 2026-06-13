import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { DecodeResult, EngineClient, Stage2SnapshotDTO } from '@abc-budget/engine';
import { EngineClientProvider } from '../../../engine-client-context';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { ImportFlow } from '../../ImportFlow';

/**
 * S3a state matrix — the QA-facing inventory (Story 2.7, Task 5).
 *
 * Every reachable S3a state, driven through the REAL ImportFlow (router +
 * provider seams; the EngineClient is mocked at the interface — no Worker),
 * asserted in uk AND en: 8 states × 2 languages = 16 cells, table-driven.
 * Each cell asserts the state's DISTINGUISHING element in that language —
 * this file is the one place QA reads to know what exists and what it says.
 *
 * | # | state              | distinguishing element                          |
 * |---|--------------------|-------------------------------------------------|
 * | 1 | idle               | DropZone title + local-only lamp                |
 * | 2 | decoding           | DecodingPanel with live done/total rows         |
 * | 3 | recognized full    | «all M recognized» title, NO partial line       |
 * | 4 | recognized partial | «N of M» title + gold partial line (k untyped)  |
 * | 5 | unknown            | first-import title + «all untyped» CRT line     |
 * | 6 | read error         | ЩО/ЧОМУ/ДІЯ rows + retry key                    |
 * | 7 | sample path        | fetch-mocked sample → recognized                |
 * | 8 | first-run gate     | base-currency dialog BEFORE any file work       |
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
    importStart: vi.fn(async () => ({ sessionId: 'sess-matrix', stage2: makeSnapshot(3, 3) })),
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

function renderFlow(client: EngineClient, lang: Lang) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <div data-testid="screen-root" /> },
      { path: '/import', element: <ImportFlow /> },
      { path: '/dashboard', element: <div data-testid="screen-dashboard" /> },
    ],
    { initialEntries: ['/import'] },
  );
  render(
    <LangProvider initialLang={lang}>
      <EngineClientProvider client={client}>
        <RouterProvider router={router} />
      </EngineClientProvider>
    </LangProvider>,
  );
  return router;
}

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

/** Distinguishing copy per language — EXACT catalog renderings. */
const STR = {
  uk: {
    dropTitle: 'Перетягніть файл сюди',
    localOnly: 'ЛОКАЛЬНО · ФАЙЛ НЕ ПОКИДАЄ ПРИСТРІЙ',
    decodingRows: '1200 / 10000 рядків',
    recogAll: 'Усі 3 колонок розпізнано',
    recogSome: 'Розпізнано 2 з 5 колонок',
    partialLine: '3 ще без типу — зіставите їх на наступному кроці.',
    unkTitle: 'Перший імпорт — правил ще немає',
    unkAllCols: '▸ 4 колонок · усі без типу',
    errWhat: 'ЩО:',
    errWhy: 'ЧОМУ:',
    errDo: 'ДІЯ:',
    errWhatV: 'Файл не вдалося відкрити',
    errDoV: 'Перевірте, що це експорт виписки, і спробуйте інший файл.',
    retryKey: 'Обрати інший файл',
    sampleLink: '↳ Спробувати на прикладі',
    baseTitle: 'Базова валюта',
  },
  en: {
    dropTitle: 'Drop the file here',
    localOnly: 'LOCAL · THE FILE NEVER LEAVES THIS DEVICE',
    decodingRows: '1200 / 10000 rows',
    recogAll: 'All 3 columns recognized',
    recogSome: 'Recognized 2 of 5 columns',
    partialLine: '3 still untyped — you’ll map them on the next step.',
    unkTitle: 'First import — no rules yet',
    unkAllCols: '▸ 4 columns · all untyped',
    errWhat: 'WHAT:',
    errWhy: 'WHY:',
    errDo: 'DO:',
    errWhatV: 'The file could not be opened',
    errDoV: 'Make sure it’s a statement export and try another file.',
    retryKey: 'Choose another file',
    sampleLink: '↳ Try a sample',
    baseTitle: 'Base currency',
  },
} as const;

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe.each(['uk', 'en'] as const)('S3a state matrix [%s]', (lang) => {
  const s = STR[lang];

  it('1 · idle — DropZone with title, local-only lamp, sample link; no other state rendered', async () => {
    renderFlow(makeClient(), lang);
    expect(await screen.findByTestId('s3a-dropzone')).toBeTruthy();
    expect(screen.getByText(s.dropTitle)).toBeTruthy();
    expect(screen.getByText(s.localOnly)).toBeTruthy();
    expect(screen.getByRole('button', { name: s.sampleLink })).toBeTruthy();
    expect(screen.queryByTestId('s3a-decoding')).toBeNull();
    expect(screen.queryByTestId('s3a-recognized')).toBeNull();
    expect(screen.queryByTestId('s3a-unknown')).toBeNull();
    expect(screen.queryByTestId('s3a-error')).toBeNull();
  });

  it('2 · decoding — progress VISIBLE: an intermediate event renders honest done/total', async () => {
    const dec = deferred<DecodeResult>();
    let listener:
      | ((evt: { event: string; jobId: string; phase: string; done: number; total: number }) => void)
      | null = null;
    renderFlow(
      makeClient({
        decode: vi.fn(() => dec.promise),
        onEvent: vi.fn((cb: typeof listener) => {
          listener = cb;
          return () => {
            listener = null;
          };
        }),
      }),
      lang,
    );
    await dropFile('big.csv');
    await waitFor(() => expect(screen.getByTestId('s3a-decoding')).toBeTruthy());
    listener!({ event: 'progress', jobId: 'j1', phase: 'decode', done: 1200, total: 10000 });
    await waitFor(() => expect(screen.getByText(s.decodingRows)).toBeTruthy());
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });

  it('3 · recognized full (n=m) — the all-recognized title, NO partial line', async () => {
    renderFlow(
      makeClient({ importStart: vi.fn(async () => ({ sessionId: 's1', stage2: makeSnapshot(3, 3) })) }),
      lang,
    );
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    expect(screen.getByText(s.recogAll)).toBeTruthy();
    expect(screen.queryByTestId('s3a-partial')).toBeNull();
  });

  it('4 · recognized partial (0<n<m) — N-of-M title + the gold partial line', async () => {
    renderFlow(
      makeClient({ importStart: vi.fn(async () => ({ sessionId: 's1', stage2: makeSnapshot(2, 5) })) }),
      lang,
    );
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    expect(screen.getByText(s.recogSome)).toBeTruthy();
    expect(screen.getByTestId('s3a-partial').textContent).toContain(s.partialLine);
  });

  it('5 · unknown (n=0) — first-import title + the all-untyped CRT line', async () => {
    renderFlow(
      makeClient({ importStart: vi.fn(async () => ({ sessionId: 's0', stage2: makeSnapshot(0, 4) })) }),
      lang,
    );
    await dropFile();
    await waitFor(() => expect(screen.getByTestId('s3a-unknown')).toBeTruthy());
    expect(screen.getByText(s.unkTitle)).toBeTruthy();
    expect(screen.getByText(s.unkAllCols)).toBeTruthy();
    expect(screen.queryByTestId('s3a-recognized')).toBeNull();
  });

  it('6 · read error — ЩО/ЧОМУ/ДІЯ rows + the retry key', async () => {
    renderFlow(makeClient({ decode: vi.fn(async () => Promise.reject(new Error('boom'))) }), lang);
    await dropFile('broken.pdf');
    await waitFor(() => expect(screen.getByTestId('s3a-error')).toBeTruthy());
    expect(screen.getByText(s.errWhat)).toBeTruthy();
    expect(screen.getByText(s.errWhy)).toBeTruthy();
    expect(screen.getByText(s.errDo)).toBeTruthy();
    expect(screen.getByText(s.errWhatV)).toBeTruthy();
    expect(screen.getByText(s.errDoV)).toBeTruthy();
    expect(screen.getByRole('button', { name: s.retryKey })).toBeTruthy();
  });

  it('7 · sample path — the ↳ link fetches the bundled asset → recognized', async () => {
    const bytes = new TextEncoder().encode('a,b\n1,2').buffer as ArrayBuffer;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => bytes })));
    const client = makeClient();
    renderFlow(client, lang);
    fireEvent.click(await screen.findByRole('button', { name: s.sampleLink }));
    await waitFor(() => expect(screen.getByTestId('s3a-recognized')).toBeTruthy());
    expect(client.decode).toHaveBeenCalledWith(bytes, 'sample-statement.csv');
  });

  it('8 · first-run gate — the base-currency dialog BEFORE any file work', async () => {
    renderFlow(makeClient({ getBaseCurrency: vi.fn(async () => null) }), lang);
    // probe in flight: no file input yet — the gate precedes file work
    expect(screen.queryByTestId('s3a-file-input')).toBeNull();
    const dialog = await screen.findByRole('dialog', { name: s.baseTitle });
    expect(dialog.classList.contains('modal-scrim')).toBe(true);
  });
});
