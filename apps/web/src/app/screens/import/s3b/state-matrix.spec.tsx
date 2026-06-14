import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
 * S3b state matrix — the QA-facing inventory (Story 2.8, Task 6).
 *
 * Every reachable S3b state, driven through the REAL S3bMapping container over
 * the use-s3b-session hook (the EngineClient is mocked at the interface — no
 * Worker), asserted in uk AND en.  This is the one file QA reads to know what
 * exists at S3b and what each state SAYS in each language.
 *
 * 12 states × 2 languages = 24 cells.  Table-driven where the state is a pure
 * snapshot render; the interactive states (manual map, «More» wizard, confirm,
 * undo, collision, rejection) are grouped below with their bespoke setup but
 * still asserted per-language via describe.each.
 *
 * | #  | state                | distinguishing element                              |
 * |----|----------------------|-----------------------------------------------------|
 * | 1  | first-import         | all UNKNOWN headers (▸ unknown); BlockPanel reachable|
 * | 2  | recall-prefilled     | ◇ guessed glyph on a recalled column; gate passes    |
 * | 3  | manual instant map   | pick a type → importApplyColumn → header confirmed   |
 * | 4  | «More» param config  | ConfigWizard STEP 2 · PARAMETERS + the help panel    |
 * | 5  | confirm-recalled     | ◇ guessed → confirmed (importConfirmRecall)          |
 * | 6  | undo/reconfigure     | «Undo» → reset to UNKNOWN; «Reconfigure» → wizard     |
 * | 7  | collision (loud)     | colh-collision badge + collision-banner (role=alert) |
 * | 8  | >30% rejection       | RejectionPanel · ALL cellErrors · column UNKNOWN     |
 * | 9  | loud UNKNOWN gate    | BlockPanel names the unmapped columns (Option A)     |
 * | 10 | IGNORE & TIME handled| ignore/time columns NOT in unmapped → gate passes    |
 * | 11 | worker-progress      | WorkerProgressPanel determinate render (done/total)  |
 * | 12 | «Назад»→S3a          | non-destructive back-nav (proven at the flow level)  |
 */

// ── Snapshot fixtures ────────────────────────────────────────────────────────

function col(over: Partial<Omit<Stage2ColumnDTO, 'definition'>> & { definition?: string | null }): Stage2ColumnDTO {
  return {
    id: 'c0',
    originalName: { text: 'Col' },
    definition: null,
    params: null,
    recallState: null,
    sampleCells: [{ value: 'v' }],
    ...over,
  } as Stage2ColumnDTO;
}

function snap(columns: Stage2ColumnDTO[], over?: Partial<Stage2SnapshotDTO>): Stage2SnapshotDTO {
  const unmapped =
    over?.unmapped ??
    columns
      .filter((c) => c.definition === null || c.definition === 'unknown')
      .map((c) => ({ id: c.id, name: 'text' in c.originalName ? c.originalName.text : c.id }));
  return {
    columns,
    recognized: over?.recognized ?? { n: columns.length - unmapped.length, m: columns.length },
    lastSaveCollision: over?.lastSaveCollision ?? null,
    unmapped,
  };
}

/** first-import: a 2-column pool with both UNKNOWN. */
const FIRST_IMPORT = snap([
  col({ id: 'c0', originalName: { text: 'Дата' }, definition: null, sampleCells: [{ value: '01.01' }] }),
  col({ id: 'c1', originalName: { text: 'Сума' }, definition: null, sampleCells: [{ value: '-10' }] }),
]);

/** recall-prefilled: both columns recalled GUESSED → gate passes (unmapped:[]). */
const RECALL_PREFILLED = snap([
  col({ id: 'c0', originalName: { text: 'Дата' }, definition: 'date', recallState: 'guessed', sampleCells: [{ value: '01.01' }] }),
  col({ id: 'c1', originalName: { text: 'Сума' }, definition: 'amount', recallState: 'guessed', sampleCells: [{ value: '-10' }] }),
]);

/** IGNORE & TIME handled: an ignore + a time column → both pass the gate. */
const IGNORE_TIME = snap([
  col({ id: 'c0', originalName: { text: 'Службове' }, definition: 'ignore', recallState: null, sampleCells: [{ value: 'x' }] }),
  col({ id: 'c1', originalName: { text: 'Час' }, definition: 'time', recallState: 'confirmed', sampleCells: [{ value: '12:00' }] }),
]);

// ── Engine-client mock ───────────────────────────────────────────────────────

function makeClient(over?: Partial<EngineClient>): EngineClient {
  return {
    ping: vi.fn(),
    getVersion: vi.fn(),
    decode: vi.fn(),
    importStart: vi.fn(),
    importApplyColumn: vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: FIRST_IMPORT })),
    importResetColumn: vi.fn(async () => FIRST_IMPORT),
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
  client?: EngineClient;
  initial: Stage2SnapshotDTO;
  view?: 'mapping' | 'block' | 'worker';
  progress?: { done: number; total: number };
}

function Harnessed({ h }: { h: Harness }) {
  const session = useS3bSession(h.client ?? makeClient(), 'sess-1', h.initial);
  return (
    <S3bMapping
      session={session}
      fileLabel="export.csv"
      totalRows={120}
      gateView={h.view ?? 'mapping'}
      progress={h.progress ?? { done: 0, total: 0 }}
      onReturnToMapping={() => {}}
    />
  );
}

function renderMatrix(lang: Lang, h: Harness) {
  return render(
    <LangProvider initialLang={lang}>
      <Harnessed h={h} />
    </LangProvider>,
  );
}

/** Open a column's menu by its raw header name. */
function openMenu(rawName: string) {
  fireEvent.click(screen.getByText(rawName, { selector: '.colh-rawname' }));
}

/** The colh button wrapping a given raw header name. */
function header(rawName: string): HTMLElement {
  return screen.getByText(rawName, { selector: '.colh-rawname' }).closest('.colh') as HTMLElement;
}

// ── Distinguishing copy per language (EXACT catalog renderings) ──────────────

const STR = {
  uk: {
    statusTitle: 'СТАН ЗІСТАВЛЕННЯ',
    unknown: 'не визначено',
    unknownShort: 'без типу',
    guessed: 'з правил',
    confirmedState: 'підтв.',
    pickType: 'Оберіть тип колонки',
    amountLabel: 'Сума',
    descriptionLabel: 'Опис',
    more: /Більше/i,
    cfgStep2: 'КРОК 2 · ПАРАМЕТРИ',
    next: /Далі/i,
    confirmAction: /Підтвердити/i,
    undoAction: /Скасувати/i,
    reconfigureAction: 'Налаштувати',
    collBadge: 'правило ≠ · підтвердьте/змініть',
    blockTag: /Є КОЛОНКИ БЕЗ ТИПУ/i,
    rejTag: /ПОМИЛКА РОЗБОРУ В КОЛОНЦІ/i,
    workerTag: /ВЕЛИКИЙ ФАЙЛ/i,
    ignoredState: 'ігнор.',
    timeLabel: 'Час',
  },
  en: {
    statusTitle: 'MAPPING STATUS',
    unknown: 'unknown',
    unknownShort: 'no type',
    guessed: 'from rules',
    confirmedState: 'set',
    pickType: 'Pick a column type',
    amountLabel: 'Amount',
    descriptionLabel: 'Description',
    more: /More/i,
    cfgStep2: 'STEP 2 · PARAMETERS',
    next: /Next/i,
    confirmAction: /Confirm/i,
    undoAction: /Undo/i,
    reconfigureAction: 'Reconfigure',
    collBadge: 'saved rule’s params differ · confirm/adjust',
    blockTag: /COLUMNS WITHOUT A TYPE/i,
    rejTag: /PARSE ERROR IN COLUMN/i,
    workerTag: /LARGE FILE/i,
    ignoredState: 'ignored',
    timeLabel: 'Time',
  },
} as const;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe.each(['uk', 'en'] as const)('S3b state matrix [%s]', (lang) => {
  const s = STR[lang];

  it('1 · first-import — all columns UNKNOWN; status pane shows the mapping title', () => {
    renderMatrix(lang, { initial: FIRST_IMPORT });
    // both headers in the loud unknown state (the «▸ unknown» line)
    expect(header('Дата').className).toContain('unknown');
    expect(header('Сума').className).toContain('unknown');
    expect(screen.getAllByText(`▸ ${s.unknown}`).length).toBe(2);
    // default right pane = StatusPanel
    expect(screen.getByText(s.statusTitle)).toBeTruthy();
  });

  it('1b · first-import — the loud UNKNOWN gate (BlockPanel) is reachable, naming the columns', () => {
    renderMatrix(lang, { initial: FIRST_IMPORT, view: 'block' });
    expect(screen.getByText(s.blockTag)).toBeTruthy();
    expect(screen.getByText('Дата', { selector: '.block-chip' })).toBeTruthy();
    expect(screen.getByText('Сума', { selector: '.block-chip' })).toBeTruthy();
  });

  it('2 · recall-prefilled — a recalled column shows the ◇ guessed glyph (loud, distinct)', () => {
    renderMatrix(lang, { initial: RECALL_PREFILLED });
    const h = header('Дата');
    expect(h.className).toContain('guessed');
    // the ◇ recall affordance is its own distinct element (item 3), not a dot
    expect(h.querySelector('.colh-recall-glyph')?.textContent).toBe('◇');
    expect(within(h).getByText(s.guessed)).toBeTruthy();
  });

  it('2b · recall-prefilled — passes the gate (all guessed → no unmapped columns)', () => {
    // unmapped is empty (decision #2: recalled columns are typed-as-guessed),
    // so the gate would advance, not block.
    expect(RECALL_PREFILLED.unmapped).toHaveLength(0);
    renderMatrix(lang, { initial: RECALL_PREFILLED });
    expect(screen.queryByText(s.blockTag)).toBeNull();
  });

  it('3 · manual instant map — pick a type → importApplyColumn → header confirmed', async () => {
    const confirmed = snap(
      [
        col({ id: 'c0', originalName: { text: 'Дата' }, definition: 'date', recallState: 'guessed', sampleCells: [{ value: '01.01' }] }),
        col({ id: 'c1', originalName: { text: 'Сума' }, definition: 'description', recallState: 'confirmed', sampleCells: [{ value: '-10' }] }),
      ],
      { unmapped: [] },
    );
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: confirmed }));
    renderMatrix(lang, { client: makeClient({ importApplyColumn }), initial: FIRST_IMPORT });

    openMenu('Сума');
    expect(screen.getByText(s.pickType)).toBeTruthy(); // the menu opened
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${s.descriptionLabel}$`, 'i') }));

    await waitFor(() => expect(importApplyColumn).toHaveBeenCalledWith('sess-1', 'c1', 'description', null));
    await waitFor(() => expect(header('Сума').className).toContain('confirmed'));
  });

  it('4 · «More» param config — ConfigWizard reaches STEP 2 with the help panel', async () => {
    renderMatrix(lang, { initial: FIRST_IMPORT });
    openMenu('Сума');
    fireEvent.click(screen.getByRole('menuitem', { name: s.more }));
    // step 1 → picker; advance to step 2
    fireEvent.click(screen.getByRole('button', { name: s.next }));
    await waitFor(() => expect(screen.getByText(s.cfgStep2)).toBeTruthy());
    // the embedded help doc renders non-empty markdown for the selected type
    await waitFor(() => {
      const doc = document.querySelector('.cfg-helpdoc');
      expect(doc).toBeTruthy();
      expect((doc?.textContent ?? '').length).toBeGreaterThan(40);
    });
  });

  it('5 · confirm-recalled — «Confirm» on a guessed column flips ◇ → confirmed', async () => {
    const importConfirmRecall = vi.fn(async () => undefined);
    renderMatrix(lang, { client: makeClient({ importConfirmRecall }), initial: RECALL_PREFILLED });
    openMenu('Дата');
    fireEvent.click(screen.getByRole('menuitem', { name: s.confirmAction }));
    await waitFor(() => expect(importConfirmRecall).toHaveBeenCalledWith('sess-1', 'c0'));
    // optimistic flip: the ◇ glyph is gone, the header reads confirmed
    await waitFor(() => {
      const h = header('Дата');
      expect(h.className).toContain('confirmed');
      expect(h.querySelector('.colh-recall-glyph')).toBeNull();
    });
  });

  it('6 · undo — «Undo» on a mapped column resets it to UNKNOWN', async () => {
    const importResetColumn = vi.fn(async () => FIRST_IMPORT);
    renderMatrix(lang, { client: makeClient({ importResetColumn }), initial: RECALL_PREFILLED });
    openMenu('Дата');
    fireEvent.click(screen.getByRole('menuitem', { name: s.undoAction }));
    await waitFor(() => expect(importResetColumn).toHaveBeenCalledWith('sess-1', 'c0'));
    await waitFor(() => expect(header('Дата').className).toContain('unknown'));
  });

  it('6b · reconfigure — «Reconfigure» on a mapped column reopens the wizard at STEP 2', async () => {
    renderMatrix(lang, { initial: RECALL_PREFILLED });
    openMenu('Дата');
    fireEvent.click(screen.getByRole('menuitem', { name: s.reconfigureAction }));
    await waitFor(() => expect(screen.getByText(s.cfgStep2)).toBeTruthy());
  });

  it('7 · collision (loud) — apply that collides → colh badge + StatusPanel banner (role=alert)', async () => {
    const collided = snap(
      [
        col({ id: 'c0', originalName: { text: 'Дата' }, definition: 'date', recallState: 'guessed', sampleCells: [{ value: '01.01' }] }),
        col({ id: 'c1', originalName: { text: 'Сума' }, definition: 'amount', recallState: 'guessed', sampleCells: [{ value: '-10' }] }),
      ],
      {
        unmapped: [],
        lastSaveCollision: {
          kind: 'params-change',
          existing: { definition: 'amount', params: null },
          incoming: { definition: 'amount', params: null },
        } as Stage2SnapshotDTO['lastSaveCollision'],
      },
    );
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => ({ ok: true, snapshot: collided }));
    renderMatrix(lang, { client: makeClient({ importApplyColumn }), initial: FIRST_IMPORT });

    openMenu('Сума');
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${s.amountLabel}$`, 'i') }));

    await waitFor(() => {
      const badge = screen.getByTestId('colh-collision');
      expect(badge.getAttribute('role')).toBe('alert');
      expect(badge.textContent).toContain(s.collBadge);
      expect(screen.getByTestId('collision-banner').getAttribute('role')).toBe('alert');
    });
  });

  it('8 · >30% rejection — RejectionPanel shows ALL cellErrors; the column stays UNKNOWN; session alive', async () => {
    const rejection: ApplyColumnResult = {
      ok: false,
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
    const importApplyColumn = vi.fn(async (): Promise<ApplyColumnResult> => rejection);
    renderMatrix(lang, { client: makeClient({ importApplyColumn }), initial: FIRST_IMPORT });

    openMenu('Сума');
    fireEvent.click(screen.getByRole('menuitemradio', { name: new RegExp(`^${s.amountLabel}$`, 'i') }));

    await waitFor(() => expect(screen.getByText(s.rejTag)).toBeTruthy());
    // ALL four errors rendered (loud, not truncated)
    expect(screen.getByTestId('rejection-cell-errors').querySelectorAll('.perr-row')).toHaveLength(4);
    // the column stays UNKNOWN (snapshot unchanged on rejection)
    expect(header('Сума').className).toContain('unknown');
  });

  it('9 · loud UNKNOWN gate (Option A) — BlockPanel names every unmapped column, no advance', () => {
    renderMatrix(lang, { initial: FIRST_IMPORT, view: 'block' });
    expect(screen.getByText(s.blockTag)).toBeTruthy();
    const chips = document.querySelectorAll('.block-chip');
    expect(chips).toHaveLength(2);
    expect(screen.getByText('Дата', { selector: '.block-chip' })).toBeTruthy();
    expect(screen.getByText('Сума', { selector: '.block-chip' })).toBeTruthy();
  });

  it('10 · IGNORE & TIME handled — neither is counted unknown; gate passes (no block)', () => {
    expect(IGNORE_TIME.unmapped).toHaveLength(0);
    renderMatrix(lang, { initial: IGNORE_TIME });
    // the ignore column reads the ignored state, the time column its type label
    expect(header('Службове').className).toContain('ignored');
    expect(within(header('Службове')).getByText(s.ignoredState)).toBeTruthy();
    expect(header('Час').className).toContain('confirmed');
    expect(within(header('Час')).getAllByText(s.timeLabel).length).toBeGreaterThan(0);
    // gate would pass — no BlockPanel forced
    expect(screen.queryByText(s.blockTag)).toBeNull();
  });

  it('11 · worker-progress — the determinate WorkerProgressPanel renders the live done/total', () => {
    renderMatrix(lang, { initial: RECALL_PREFILLED, view: 'worker', progress: { done: 3000, total: 10000 } });
    expect(screen.getByText(s.workerTag)).toBeTruthy();
    expect(screen.getByText('30%')).toBeTruthy();
    const bar = screen.getByRole('progressbar', { name: /.+/ });
    expect(bar.getAttribute('aria-valuenow')).toBe('3000');
    expect(bar.getAttribute('aria-valuemax')).toBe('10000');
  });

  it('12 · «Назад»→S3a — the back affordance is non-destructive (flow-level pin lives in ImportFlow.s3b.spec)', () => {
    // S3bMapping itself owns no «Назад» (the footer key lives in ImportFlow, and
    // the non-destructive semantics are pinned in ImportFlow.s3b.spec.tsx case
    // (i): back→forward preserves the mapping, no importAbort, no re-importStart).
    // This cell documents the state's presence in the matrix; the container
    // renders cleanly with a mapped session ready to be navigated away from.
    renderMatrix(lang, { initial: RECALL_PREFILLED });
    expect(screen.getByTestId('s3b-mapping')).toBeTruthy();
    expect(screen.getByText(s.statusTitle)).toBeTruthy();
  });
});
