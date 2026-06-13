import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  ApplyColumnResult,
  EngineClient,
  Stage2ColumnDTO,
  Stage2SnapshotDTO,
} from '@abc-budget/engine';
import { LangProvider } from '../../../i18n/LangProvider';
import type { Lang } from '../../../i18n/i18n';
import { S3bMapping } from './S3bMapping';
import { useS3bSession } from './use-s3b-session';

/**
 * S3bMapping container spec (Task 4) — DTO→MappingColumn adaptation + the
 * split-pane wiring + the menu callbacks → hook methods.  The block/worker
 * views are gate-driven (ImportFlow) so they are passed as props here.
 */

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
    col({ id: 'c0', originalName: { text: 'Дата' }, definition: 'date', recallState: 'guessed', sampleCells: [{ value: '01.01' }] }),
    col({ id: 'c1', originalName: { text: 'Сума' }, definition: null, sampleCells: [{ value: '-10' }] }),
  ];
  return {
    columns,
    recognized: over?.recognized ?? { n: 1, m: columns.length },
    lastSaveCollision: over?.lastSaveCollision ?? null,
    unmapped: over?.unmapped ?? columns.filter((c) => c.definition === null).map((c) => ({ id: c.id, name: 'Сума' })),
  };
}

function makeClient(over?: Partial<EngineClient>): EngineClient {
  return {
    ping: vi.fn(),
    getVersion: vi.fn(),
    decode: vi.fn(),
    importStart: vi.fn(),
    importApplyColumn: vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: snapshot() })),
    importResetColumn: vi.fn(async () => snapshot()),
    importConfirmRecall: vi.fn(async () => undefined),
    importResolveCollision: vi.fn(async () => undefined),
    importGetRows: vi.fn(),
    importNext: vi.fn(),
    importAbort: vi.fn(),
    getBaseCurrency: vi.fn(),
    setBaseCurrency: vi.fn(),
    onEvent: vi.fn(() => () => {}),
    ...over,
  } as unknown as EngineClient;
}

interface Harness {
  client: EngineClient;
  initial?: Stage2SnapshotDTO;
  lang?: Lang;
  view?: 'mapping' | 'block' | 'worker';
  progress?: { done: number; total: number };
}

function Harnessed({ h }: { h: Harness }) {
  const session = useS3bSession(h.client, 'sess-1', h.initial ?? snapshot());
  return (
    <S3bMapping
      session={session}
      fileLabel="export.csv"
      totalRows={120}
      gateView={h.view ?? 'mapping'}
      progress={h.progress ?? { done: 0, total: 0 }}
    />
  );
}

function renderMapping(h: Harness) {
  return render(
    <LangProvider initialLang={h.lang ?? 'uk'}>
      <Harnessed h={h} />
    </LangProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('S3bMapping', () => {
  it('renders the raw mapping table with resolved column names + the status panel', () => {
    renderMapping({ client: makeClient() });
    // raw header names resolved from SerializedMessage {text}
    expect(screen.getAllByText('Дата').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Сума').length).toBeGreaterThan(0);
    // default right pane = StatusPanel (mapping status title)
    expect(screen.getByText(/СТАН ЗІСТАВЛЕННЯ/i)).toBeTruthy();
  });

  it('instant-pick a type → calls importApplyColumn with default params', async () => {
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: snapshot() }));
    renderMapping({ client: makeClient({ importApplyColumn }) });

    // open the UNKNOWN column header (c1 = Сума)
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    // pick "Сума"/amount from the menu — use the menu radio for amount
    const amountItem = screen.getByRole('menuitemradio', { name: /Сума/i });
    fireEvent.click(amountItem);

    await waitFor(() => {
      expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'amount', { currency: 'auto', type: 'auto' });
    });
  });

  it('block gateView → renders the BlockPanel naming the unmapped columns', () => {
    renderMapping({ client: makeClient(), view: 'block' });
    expect(screen.getByText(/Є КОЛОНКИ БЕЗ ТИПУ/i)).toBeTruthy();
    // the unmapped column name appears as a chip
    expect(screen.getByText('Сума', { selector: '.block-chip' })).toBeTruthy();
  });

  it('worker gateView → renders the WorkerProgressPanel with progress', () => {
    renderMapping({ client: makeClient(), view: 'worker', progress: { done: 500, total: 1000 } });
    expect(screen.getByText(/ВЕЛИКИЙ ФАЙЛ/i)).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
  });

  it('apply rejection → renders the RejectionPanel with ALL cell errors', async () => {
    const importApplyColumn = vi.fn(
      async (): Promise<ApplyColumnResult> => ({
        ok: false,
        rejection: {
          errorCount: 2,
          totalCount: 5,
          threshold: 0.3,
          cellErrors: [
            { rowIndex: 0, message: { text: 'bad-1' } },
            { rowIndex: 4, message: { text: 'bad-2' } },
          ],
        },
      }),
    );
    renderMapping({ client: makeClient({ importApplyColumn }) });

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));

    await waitFor(() => {
      expect(screen.getByText(/ПОМИЛКА РОЗБОРУ В КОЛОНЦІ/i)).toBeTruthy();
    });
    const errs = screen.getByTestId('rejection-cell-errors');
    expect(errs.querySelectorAll('.perr-row')).toHaveLength(2);
  });
});
