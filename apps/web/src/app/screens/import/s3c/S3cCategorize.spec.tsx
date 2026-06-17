import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CategorizedWindowDTO,
  CategoryDTO,
  EngineClient,
  RuleSummaryDTO,
  WhyTreeDTO,
} from '@abc-budget/engine';
import { LangProvider } from '../../../i18n/LangProvider';
import { LangToggle } from '../../../../ui/altus/components/LangToggle';
import { useLang } from '../../../i18n/LangProvider';
import { mccTitle } from '../../../mcc/mcc-lookup';
import { S3cCategorize } from './S3cCategorize';
import { useS3cSession } from './use-s3c-session';
import { cat, FIELDS, row, rule, whyTree } from './fixtures';

/**
 * S3cCategorize container spec (Task 4) — the screen composes the Task-3
 * components over the live hook; this proves the wiring: live rows render, a
 * created rule re-categorizes the OPS, the rules tab reads first-match-wins, a
 * category-cell click opens LOG/, the LangToggle re-localizes the MCC column
 * while operation content stays verbatim (HC-6), and rows are keyed on rowIndex.
 */

function win(over: Partial<CategorizedWindowDTO> = {}): CategorizedWindowDTO {
  return {
    rows: [
      row({ rowIndex: 0, description: 'АТБ МАРКЕТ', categoryId: 'groceries' }),
      row({ rowIndex: 1, description: 'НОВА ПОШТА', categoryId: null }),
    ],
    total: 2,
    matchCount: 2,
    ...over,
  };
}

const CATS: CategoryDTO[] = [cat(), cat({ id: 'dining', name: 'Кафе', icon: 'dining' })];

function makeClient(over?: Partial<EngineClient>): EngineClient {
  return {
    ping: vi.fn(),
    getVersion: vi.fn(),
    decode: vi.fn(),
    importStart: vi.fn(),
    importApplyColumn: vi.fn(),
    importResetColumn: vi.fn(),
    importConfirmRecall: vi.fn(),
    importResolveCollision: vi.fn(),
    importGetRows: vi.fn(),
    importNext: vi.fn(),
    importAbort: vi.fn(),
    getBaseCurrency: vi.fn(),
    setBaseCurrency: vi.fn(),
    importCategorizedRows: vi.fn(async (): Promise<CategorizedWindowDTO> => win()),
    importConditionFields: vi.fn(async () => FIELDS),
    importWhy: vi.fn(async (): Promise<WhyTreeDTO> => whyTree()),
    importRulesList: vi.fn(async (): Promise<RuleSummaryDTO[]> => [rule()]),
    rulesCreate: vi.fn(async () => ({ ruleId: 9 })),
    categoriesList: vi.fn(async () => CATS),
    categoriesCreate: vi.fn(async () => cat({ id: 'newcat', name: 'Нова' })),
    onEvent: vi.fn(() => () => {}),
    ...over,
  } as unknown as EngineClient;
}

function Harnessed({ client }: { client: EngineClient }) {
  const session = useS3cSession(client, 'sess-c');
  const { lang, setLang } = useLang();
  return (
    <>
      <LangToggle lang={lang} onChange={setLang} />
      <S3cCategorize session={session} />
    </>
  );
}

function renderScreen(client: EngineClient, lang: 'uk' | 'en' = 'uk') {
  return render(
    <LangProvider initialLang={lang}>
      <Harnessed client={client} />
    </LangProvider>,
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('S3cCategorize', () => {
  it('renders the import rows with live categories (CatChip names)', async () => {
    renderScreen(makeClient());
    await waitFor(() => expect(screen.getByTestId('s3c-categorize')).toBeTruthy());
    // categorized row shows the live category name
    expect(await screen.findByText('Продукти')).toBeTruthy();
    // content is verbatim user data
    expect(screen.getByText('АТБ МАРКЕТ')).toBeTruthy();
    expect(screen.getByText('НОВА ПОШТА')).toBeTruthy();
  });

  it('creating a rule (draft → pick category → Save) calls rulesCreate and the OPS re-renders', async () => {
    let saved = false;
    const importCategorizedRows = vi.fn(async (): Promise<CategorizedWindowDTO> => {
      // after the rule is saved the engine re-categorizes НОВА ПОШТА → Кафе
      return saved
        ? win({ rows: [row({ rowIndex: 0, description: 'АТБ МАРКЕТ', categoryId: 'groceries' }), row({ rowIndex: 1, description: 'НОВА ПОШТА', categoryId: 'dining' })] })
        : win();
    });
    const rulesCreate = vi.fn(async () => {
      saved = true;
      return { ruleId: 9 };
    });
    renderScreen(makeClient({ importCategorizedRows, rulesCreate }));
    await screen.findByText('Продукти');

    // НОВА ПОШТА is uncategorized → «Призначити» affordance present
    expect(screen.getByText('Призначити')).toBeTruthy();

    // seed a draft via a column funnel (desc · contains)
    const funnels = screen.getAllByTitle(/Фільтрувати|Filter/i);
    fireEvent.click(funnels[1]); // the desc column funnel
    fireEvent.click(screen.getByRole('menuitem', { name: /Містить|Contains/i }));
    await waitFor(() => expect(rulesCreate).not.toHaveBeenCalled());

    // pick a category in the build pane (search «Кафе» → click)
    const picker = document.querySelector('.catpicker') as HTMLElement;
    fireEvent.change(within(picker).getByRole('textbox'), { target: { value: 'Кафе' } });
    fireEvent.click(within(picker).getByText('Кафе'));

    // Save as rule
    fireEvent.click(screen.getByRole('button', { name: /Зберегти як правило/i }));
    await waitFor(() => expect(rulesCreate).toHaveBeenCalledWith(expect.any(Array), 'dining'));

    // OPS re-rendered against the re-categorized truth: НОВА ПОШТА now → Кафе
    await waitFor(() => {
      const chips = screen.getAllByText('Кафе');
      expect(chips.length).toBeGreaterThan(0);
    });
  });

  it('the rules-list tab shows the rules + "first-match-wins"', async () => {
    renderScreen(makeClient());
    await screen.findByText('Продукти');
    // switch to the rules tab
    fireEvent.click(screen.getByRole('button', { name: /Усі правила/i }));
    expect(await screen.findByText(/ПЕРШЕ ЗБІГ ПЕРЕМАГАЄ/i)).toBeTruthy();
    // the rule's target category is listed
    expect(screen.getAllByText('Продукти').length).toBeGreaterThan(0);
  });

  it('clicking a category cell opens LOG/ with the why-tree (winner + a neutral lamp)', async () => {
    const importWhy = vi.fn(async (): Promise<WhyTreeDTO> => whyTree());
    renderScreen(makeClient({ importWhy }));
    await screen.findByText('Продукти');

    // click the first row's category cell → openWhy(0)
    const cells = screen.getAllByTitle(/Чому ця категорія/i);
    fireEvent.click(cells[0]);

    await waitFor(() => expect(importWhy).toHaveBeenCalledWith('sess-c', 0));
    // LOG/ pane renders the winner status + the operation row verbatim
    expect(await screen.findByText(/ПРАВИЛО-ПЕРЕМОЖЕЦЬ/i)).toBeTruthy();
    expect(screen.getByText(/ОПЕРАЦІЯ/i)).toBeTruthy();
    // a lamp is present (the why-tree has win/miss/neutral rows)
    expect(document.querySelectorAll('.whyrow .lamp').length).toBeGreaterThan(0);
  });

  it('flipping LangToggle re-localizes the MCC column title while operation content stays verbatim (HC-6)', async () => {
    renderScreen(makeClient());
    await screen.findByText('Продукти');

    const ukMcc = mccTitle(5812, 'uk');
    const enMcc = mccTitle(5812, 'en');
    expect(ukMcc).not.toBe(enMcc);

    // uk: chrome segment label + the uk MCC title present; content verbatim
    expect(screen.getByText('Усі')).toBeTruthy();
    expect(document.body.textContent).toContain(ukMcc);
    expect(screen.getByText('АТБ МАРКЕТ')).toBeTruthy();

    // flip to EN
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));

    // chrome flipped (MCC reference title re-localized) — content unchanged
    await waitFor(() => expect(document.body.textContent).toContain(enMcc));
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('АТБ МАРКЕТ')).toBeTruthy();
  });

  it('keys rows on rowIndex — a category-cell click reports the DTO rowIndex, not the array position', async () => {
    const importWhy = vi.fn(async (): Promise<WhyTreeDTO> => whyTree());
    const importCategorizedRows = vi.fn(async (): Promise<CategorizedWindowDTO> =>
      win({ rows: [row({ rowIndex: 17, description: 'A', categoryId: 'groceries' }), row({ rowIndex: 4, description: 'B', categoryId: null })] }),
    );
    renderScreen(makeClient({ importWhy, importCategorizedRows }));
    await screen.findByText('A');

    const cells = screen.getAllByTitle(/Чому ця категорія/i);
    fireEvent.click(cells[0]);
    await waitFor(() => expect(importWhy).toHaveBeenCalledWith('sess-c', 17));
  });
});
