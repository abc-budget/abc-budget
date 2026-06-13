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
  onReturnToMapping?: () => void;
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
      onReturnToMapping={h.onReturnToMapping ?? (() => {})}
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

// ── Task 5: the flows + loud surfaces ────────────────────────────────────────

describe('S3bMapping — instant apply flow (Task 5)', () => {
  it('instant-pick a no-param type (description) → importApplyColumn with null params, header → confirmed', async () => {
    const confirmed = snapshot({
      columns: [
        col({ id: 'c0', originalName: { text: 'Дата' }, definition: 'date', recallState: 'guessed', sampleCells: [{ value: '01.01' }] }),
        col({ id: 'c1', originalName: { text: 'Сума' }, definition: 'description', recallState: 'confirmed', sampleCells: [{ value: '-10' }] }),
      ],
      unmapped: [],
    });
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: confirmed }));
    renderMapping({ client: makeClient({ importApplyColumn }) });

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Опис/i }));

    await waitFor(() => {
      expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'description', null);
    });
    // header now reads confirmed for c1
    await waitFor(() => {
      const c1 = screen.getByText('Сума', { selector: '.colh-rawname' }).closest('.colh');
      expect(c1?.className).toContain('confirmed');
    });
  });

  it('instant-pick a param type (amount) → importApplyColumn with paramDefaults', async () => {
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: snapshot({ unmapped: [] }) }));
    renderMapping({ client: makeClient({ importApplyColumn }) });

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));

    await waitFor(() => {
      expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'amount', { currency: 'auto', type: 'auto' });
    });
  });
});

describe('S3bMapping — «More» 2-step flow (Task 5)', () => {
  it('open the wizard → real vendored help md renders for the selected type', async () => {
    renderMapping({ client: makeClient() });
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Більше/i }));
    // step 1 → the picker; default selected type is amount. Advance to step 2.
    fireEvent.click(screen.getByRole('button', { name: /Далі/i }));
    // the cfg-helpdoc renders the REAL vendored markdown for amount — assert a
    // known phrase appears (the doc is non-empty embedded content).
    await waitFor(() => {
      const doc = document.querySelector('.cfg-helpdoc');
      expect(doc).toBeTruthy();
      expect((doc?.textContent ?? '').length).toBeGreaterThan(40);
    });
  });

  it('currency {code} path: pick «Фікс. код…», type ISO → engine gets {code:"USD"}', async () => {
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: snapshot({ unmapped: [] }) }));
    renderMapping({ client: makeClient({ importApplyColumn }) });

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Більше/i }));
    fireEvent.click(screen.getByRole('button', { name: /Далі/i })); // → step 2, type=amount

    // pick the currency "code" option (segmented radio), then type the ISO code
    fireEvent.click(screen.getByRole('radio', { name: /Фікс\. код/i }));
    const iso = await screen.findByPlaceholderText('USD');
    fireEvent.change(iso, { target: { value: 'usd' } });

    fireEvent.click(screen.getByRole('button', { name: /Застосувати/i }));
    await waitFor(() => {
      expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'amount', {
        currency: { code: 'USD' },
        type: 'auto',
      });
    });
  });

  it('date custom pattern → engine gets {format:{custom}}', async () => {
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: snapshot({ unmapped: [] }) }));
    renderMapping({ client: makeClient({ importApplyColumn }) });

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Більше/i }));
    // step 1: pick the date type radio, then advance
    fireEvent.click(screen.getByRole('radio', { name: /Дата/i }));
    fireEvent.click(screen.getByRole('button', { name: /Далі/i }));
    // step 2: pick custom format, type a pattern
    fireEvent.click(screen.getByRole('radio', { name: /Власний/i }));
    const pat = await screen.findByPlaceholderText('YYYY-MM-DD');
    fireEvent.change(pat, { target: { value: 'dd.MM.yyyy' } });

    fireEvent.click(screen.getByRole('button', { name: /Застосувати/i }));
    await waitFor(() => {
      expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'date', {
        format: { custom: 'dd.MM.yyyy' },
      });
    });
  });
});

describe('S3bMapping — re-click a mapped column (Task 5)', () => {
  it('«Відмінити» → importResetColumn (undo + unstage)', async () => {
    const importResetColumn = vi.fn(async () => snapshot());
    renderMapping({ client: makeClient({ importResetColumn }) });
    // c0 is mapped (date, guessed) → open its menu
    fireEvent.click(screen.getByText('Дата', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Скасувати/i }));
    await waitFor(() => expect(importResetColumn).toHaveBeenCalledWith('sess-1', 'c0'));
  });

  it('«Налаштувати» → opens the ConfigWizard at step 2', async () => {
    renderMapping({ client: makeClient() });
    fireEvent.click(screen.getByText('Дата', { selector: '.colh-rawname' }));
    // exact «Налаштувати» (the cm-more «Більше… (налаштувати)» also matches a loose regex)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Налаштувати' }));
    // step-2 indicator visible
    await waitFor(() => expect(screen.getByText(/КРОК 2 · ПАРАМЕТРИ/i)).toBeTruthy());
  });

  it('«Підтвердити» on a guessed column → importConfirmRecall + optimistic ◇ clear', async () => {
    const importConfirmRecall = vi.fn(async () => undefined);
    renderMapping({ client: makeClient({ importConfirmRecall }) });
    fireEvent.click(screen.getByText('Дата', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Підтвердити/i }));
    await waitFor(() => expect(importConfirmRecall).toHaveBeenCalledWith('sess-1', 'c0'));
    // optimistic: c0 header flips to confirmed (◇ guessed glyph gone)
    await waitFor(() => {
      const c0 = screen.getByText('Дата', { selector: '.colh-rawname' }).closest('.colh');
      expect(c0?.className).toContain('confirmed');
    });
  });
});

describe('S3bMapping — LOUD collision surface (decision #5, Task 5)', () => {
  /** A snapshot whose c1 is mapped (amount, guessed) and whose save collided. */
  function collidedSnapshot(): Stage2SnapshotDTO {
    return snapshot({
      columns: [
        col({ id: 'c0', originalName: { text: 'Дата' }, definition: 'date', recallState: 'guessed', sampleCells: [{ value: '01.01' }] }),
        col({ id: 'c1', originalName: { text: 'Сума' }, definition: 'amount', recallState: 'guessed', sampleCells: [{ value: '-10' }] }),
      ],
      unmapped: [],
      lastSaveCollision: {
        kind: 'params-change',
        existing: { definition: 'amount', params: null },
        incoming: { definition: 'amount', params: null },
      } as Stage2SnapshotDTO['lastSaveCollision'],
    });
  }

  it('apply that raises a collision → LOUD column badge + StatusPanel banner (distinct, not a dot)', async () => {
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: collidedSnapshot() }));
    renderMapping({ client: makeClient({ importApplyColumn }) });

    // map c1 (Сума) → the returned snapshot carries lastSaveCollision
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));

    await waitFor(() => {
      // loud column badge (distinct element + role=alert), on c1's header
      const badge = screen.getByTestId('colh-collision');
      expect(badge).toBeTruthy();
      expect(badge.getAttribute('role')).toBe('alert');
      // StatusPanel loud banner (distinct block + role=alert)
      const banner = screen.getByTestId('collision-banner');
      expect(banner.getAttribute('role')).toBe('alert');
    });
  });

  it('the loud affordance PERSISTS across re-render until resolved, and the column still passes the gate', async () => {
    const h: Harness = { client: makeClient({ importApplyColumn: vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: collidedSnapshot() })) }) };
    const { rerender } = render(
      <LangProvider initialLang="uk">
        <Harnessed h={h} />
      </LangProvider>,
    );

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));
    await waitFor(() => expect(screen.getByTestId('collision-banner')).toBeTruthy());

    // re-render the SAME stateful harness (hook state preserved) → affordance
    // stays (persistent, not a transient toast that fades).
    rerender(
      <LangProvider initialLang="uk">
        <Harnessed h={h} />
      </LangProvider>,
    );
    expect(screen.getByTestId('colh-collision')).toBeTruthy();
    expect(screen.getByTestId('collision-banner')).toBeTruthy();

    // the collided column is typed → it is NOT in the unmapped gate list
    // (collidedSnapshot has unmapped:[]) — no block view is forced.
    expect(screen.queryByText(/Є КОЛОНКИ БЕЗ ТИПУ/i)).toBeNull();
  });

  it('resolveCollision(confirm) clears the loud affordance', async () => {
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: collidedSnapshot() }));
    const importResolveCollision = vi.fn(async () => undefined);
    renderMapping({ client: makeClient({ importApplyColumn, importResolveCollision }) });

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));
    await waitFor(() => expect(screen.getByTestId('collision-banner')).toBeTruthy());

    // click the banner's confirm → resolveCollision(true) → optimistic clear
    fireEvent.click(screen.getByRole('button', { name: /Оновити правило/i }));
    await waitFor(() => expect(importResolveCollision).toHaveBeenCalledWith('sess-1', true));
    await waitFor(() => {
      expect(screen.queryByTestId('collision-banner')).toBeNull();
      expect(screen.queryByTestId('colh-collision')).toBeNull();
    });
  });

  it('resolveCollision(decline) clears the affordance (keeps stored — no clobber proven at the engine)', async () => {
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: collidedSnapshot() }));
    const importResolveCollision = vi.fn(async () => undefined);
    renderMapping({ client: makeClient({ importApplyColumn, importResolveCollision }) });

    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));
    await waitFor(() => expect(screen.getByTestId('collision-banner')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /Лишити збережене/i }));
    await waitFor(() => expect(importResolveCollision).toHaveBeenCalledWith('sess-1', false));
    await waitFor(() => expect(screen.queryByTestId('collision-banner')).toBeNull());
  });
});

describe('S3bMapping — >30% rejection keeps the session alive (Task 5)', () => {
  it('rejection on one column → column UNKNOWN + ALL cellErrors shown; a sibling apply still works', async () => {
    let call = 0;
    const rejection = {
      ok: false as const,
      rejection: {
        errorCount: 4,
        totalCount: 10,
        threshold: 0.3,
        cellErrors: [
          { rowIndex: 0, message: { text: 'bad-0' } },
          { rowIndex: 2, message: { text: 'bad-2' } },
          { rowIndex: 5, message: { text: 'bad-5' } },
          { rowIndex: 9, message: { text: 'bad-9' } },
        ],
      },
    };
    const okSnap = snapshot({
      columns: [
        col({ id: 'c0', originalName: { text: 'Дата' }, definition: 'date', recallState: 'confirmed', sampleCells: [{ value: '01.01' }] }),
        col({ id: 'c1', originalName: { text: 'Сума' }, definition: null, sampleCells: [{ value: '-10' }] }),
      ],
      unmapped: [{ id: 'c1', name: 'Сума' }],
    });
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => {
      call += 1;
      // first apply (on c1/amount) is rejected; the sibling apply (on c0) succeeds
      return call === 1 ? rejection : { ok: true, snapshot: okSnap };
    });
    renderMapping({ client: makeClient({ importApplyColumn }) });

    // apply amount on c1 → rejected
    fireEvent.click(screen.getByText('Сума', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Сума/i }));
    await waitFor(() => expect(screen.getByText(/ПОМИЛКА РОЗБОРУ В КОЛОНЦІ/i)).toBeTruthy());

    // ALL four cellErrors are rendered (not truncated)
    expect(screen.getByTestId('rejection-cell-errors').querySelectorAll('.perr-row')).toHaveLength(4);
    // c1 stays UNKNOWN
    const c1 = screen.getByText('Сума', { selector: '.colh-rawname' }).closest('.colh');
    expect(c1?.className).toContain('unknown');

    // SESSION ALIVE: a sibling apply (reconfigure c0) still reaches the engine
    fireEvent.click(screen.getByText('Дата', { selector: '.colh-rawname' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^Опис$/i }));
    await waitFor(() => {
      expect(importApplyColumn).toHaveBeenCalledTimes(2);
      expect(importApplyColumn).toHaveBeenLastCalledWith('sess-1', 'c0', 'description', null);
    });
  });
});
