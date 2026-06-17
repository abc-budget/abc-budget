import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type {
  CategorizedWindowDTO,
  CategoryDTO,
  ConditionDTO,
  EngineClient,
  RuleSummaryDTO,
  SandboxStateDTO,
  WhyTreeDTO,
} from '@abc-budget/engine';
import { useS3cSession } from './use-s3c-session';
import { cat, FIELDS, row, rule, RULES_MULTI, whyTree } from './fixtures';

/**
 * use-s3c-session — Task 4 hook spec (TDD, mock v4 EngineClient).
 *
 * The hook loads the static surfaces (fields / categories / rules) + the first
 * window on mount, drives draft / saveRule / openWhy / segment / page over the
 * EngineClient v4 seam, and RELOADS the window after every mutation so the OPS
 * always reflects the engine's truth (re-categorize-live).
 */

function win(over: Partial<CategorizedWindowDTO> = {}): CategorizedWindowDTO {
  return { rows: [row({ rowIndex: 0 }), row({ rowIndex: 1, categoryId: null })], total: 2, matchCount: 2, ...over };
}

const CATS: CategoryDTO[] = [cat(), cat({ id: 'dining', name: 'Кафе', icon: 'dining' })];

function makeClient(over?: Partial<EngineClient>): EngineClient {
  return {
    ping: vi.fn(),
    getVersion: vi.fn(async () => ({ engine: '0.0.0', contract: 4 })),
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
    // ── v5 (4.9b) sandbox / rule-editing seam ──
    rulesClassify: vi.fn(async (): Promise<'live' | 'sandbox'> => 'live'),
    rulesSubmitEdit: vi.fn(async (): Promise<SandboxStateDTO> => ({ engaged: false, count: 0 })),
    sandboxState: vi.fn(async (): Promise<SandboxStateDTO> => ({ engaged: false, count: 0 })),
    sandboxApply: vi.fn(async (): Promise<void> => undefined),
    sandboxCancel: vi.fn(async (): Promise<void> => undefined),
    onEvent: vi.fn(() => () => {}),
    ...over,
  } as unknown as EngineClient;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useS3cSession', () => {
  it('mount loads fields / categories / rules / the first window', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));

    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));
    expect(client.importConditionFields).toHaveBeenCalledWith('sess-c');
    expect(client.categoriesList).toHaveBeenCalled();
    expect(client.importRulesList).toHaveBeenCalledWith('sess-c');
    expect(client.importCategorizedRows).toHaveBeenCalledWith('sess-c', {
      offset: 0,
      count: 240,
      segment: 'all',
    });
    expect(result.current.window.rows).toHaveLength(2);
    expect(result.current.categories).toHaveLength(2);
    expect(result.current.categoryIndex.get('dining')?.name).toBe('Кафе');
    expect(result.current.rules).toHaveLength(1);
  });

  it('addCondition seeds a draft condition, reloads with the draft, updates matchCount', async () => {
    const importCategorizedRows = vi.fn(async (_s: string, opts: { draft?: ConditionDTO[] }): Promise<CategorizedWindowDTO> => {
      return opts.draft && opts.draft.length > 0 ? win({ matchCount: 5 }) : win({ matchCount: 2 });
    });
    const client = makeClient({ importCategorizedRows });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));

    act(() => {
      result.current.addCondition('description', 'contains');
    });

    await waitFor(() => expect(result.current.draft).toHaveLength(1));
    expect(result.current.draft[0]).toMatchObject({ field: 'description', operator: 'contains' });
    // reloaded WITH the draft (preview) → matchCount reflects the sandbox eval
    await waitFor(() => expect(result.current.window.matchCount).toBe(5));
    const lastCall = importCategorizedRows.mock.calls.at(-1);
    expect(lastCall?.[1].draft).toHaveLength(1);
    expect(result.current.right).toBe('build');
  });

  it('saveRule calls rulesCreate then reloads the window (no draft) + the rules list', async () => {
    const rulesCreate = vi.fn(async () => ({ ruleId: 42 }));
    const importRulesList = vi
      .fn<() => Promise<RuleSummaryDTO[]>>()
      .mockResolvedValueOnce([rule()]) // mount
      .mockResolvedValue([rule(), rule({ ruleId: 42 })]); // after save
    const importCategorizedRows = vi.fn(
      async (
        _s: string,
        opts: { offset: number; count: number; segment: 'all' | 'uncat'; draft?: ConditionDTO[] },
      ): Promise<CategorizedWindowDTO> => {
        void opts;
        return win();
      },
    );
    const client = makeClient({ rulesCreate, importRulesList, importCategorizedRows });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));

    // build a draft + pick a category
    act(() => result.current.addCondition('description', 'contains'));
    await waitFor(() => expect(result.current.draft).toHaveLength(1));
    act(() => result.current.pickCategory('dining'));
    await waitFor(() => expect(result.current.draftCategoryId).toBe('dining'));

    const callsBefore = importCategorizedRows.mock.calls.length;
    await act(async () => {
      await result.current.saveRule();
    });

    expect(rulesCreate).toHaveBeenCalledWith(expect.any(Array), 'dining');
    // draft cleared after save
    expect(result.current.draft).toHaveLength(0);
    expect(result.current.draftCategoryId).toBeNull();
    // window RELOADED (re-categorize live) + rules list refreshed
    expect(importCategorizedRows.mock.calls.length).toBeGreaterThan(callsBefore);
    const lastWindowCall = importCategorizedRows.mock.calls.at(-1);
    expect(lastWindowCall?.[1].draft).toBeUndefined(); // saved → no longer a draft preview
    await waitFor(() => expect(result.current.rules).toHaveLength(2));
  });

  it('saveRule passes the draft conditions as-is (worker enforces amount↔currency pairing)', async () => {
    const rulesCreate = vi.fn(async () => ({ ruleId: 7 }));
    const client = makeClient({ rulesCreate });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));

    // a hand-set draft carrying a currency on an amount condition
    const draft: ConditionDTO[] = [{ field: 'amount', operator: 'lt', value: -100, currency: 'UAH' }];
    act(() => result.current.setDraft(draft));
    await waitFor(() => expect(result.current.draft).toHaveLength(1));
    act(() => result.current.pickCategory('groceries'));

    await act(async () => {
      await result.current.saveRule();
    });
    expect(rulesCreate).toHaveBeenCalledWith(draft, 'groceries');
  });

  it('openWhy calls importWhy + flips right to "why"; closeWhy flips back', async () => {
    const importWhy = vi.fn(async (): Promise<WhyTreeDTO> => whyTree());
    const client = makeClient({ importWhy });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));

    await act(async () => {
      await result.current.openWhy(1);
    });
    expect(importWhy).toHaveBeenCalledWith('sess-c', 1);
    expect(result.current.right).toBe('why');
    expect(result.current.whyRowIndex).toBe(1);
    expect(result.current.why).not.toBeNull();

    act(() => result.current.closeWhy());
    expect(result.current.right).toBe('build');
    expect(result.current.why).toBeNull();
    expect(result.current.whyRowIndex).toBeNull();
  });

  it('setSegment reloads the window with the new segment + resets the page', async () => {
    const importCategorizedRows = vi.fn(
      async (
        _s: string,
        opts: { offset: number; count: number; segment: 'all' | 'uncat'; draft?: ConditionDTO[] },
      ): Promise<CategorizedWindowDTO> => {
        void opts;
        return win();
      },
    );
    const client = makeClient({ importCategorizedRows });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));

    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);

    const before = importCategorizedRows.mock.calls.length;
    act(() => result.current.setSegment('uncat'));
    expect(result.current.segment).toBe('uncat');
    expect(result.current.page).toBe(0); // reset
    await waitFor(() => expect(importCategorizedRows.mock.calls.length).toBeGreaterThan(before));
    expect(importCategorizedRows.mock.calls.at(-1)?.[1].segment).toBe('uncat');
  });

  it('createCategory persists, refreshes the list, and selects it when launched from the picker', async () => {
    const categoriesCreate = vi.fn(async () => cat({ id: 'newcat', name: 'Нова' }));
    const categoriesList = vi
      .fn<() => Promise<CategoryDTO[]>>()
      .mockResolvedValueOnce(CATS) // mount
      .mockResolvedValue([...CATS, cat({ id: 'newcat', name: 'Нова' })]);
    const client = makeClient({ categoriesCreate, categoriesList });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));

    act(() => result.current.openCreateCategory('Нова', true));
    expect(result.current.createCat).toEqual({ initialName: 'Нова', fromPicker: true });

    await act(async () => {
      await result.current.createCategory({ name: 'Нова', icon: 'other', currency: 'BASE' });
    });
    expect(categoriesCreate).toHaveBeenCalledWith({ name: 'Нова', icon: 'other', currency: 'BASE' });
    await waitFor(() => expect(result.current.categories).toHaveLength(3));
    expect(result.current.createCat).toBeNull();
    // launched from the picker → the new category is auto-selected as the draft target
    expect(result.current.draftCategoryId).toBe('newcat');
  });

  it('setRuleTab switches the rules tab', async () => {
    const client = makeClient();
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));
    expect(result.current.ruleTab).toBe('build');
    act(() => result.current.setRuleTab('rules'));
    expect(result.current.ruleTab).toBe('rules');
  });

  // ── 4.9b sandbox / rule-editing ──

  it('mount fetches sandboxState; engaged resumes the banner', async () => {
    const client = makeClient({ sandboxState: vi.fn().mockResolvedValue({ engaged: true, count: 3 }) });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.sandbox?.engaged).toBe(true));
    expect(result.current.sandbox?.count).toBe(3);
  });

  it('openEdit loads the rule conditions into the draft + sets editingId', async () => {
    const client = makeClient({ importRulesList: vi.fn(async () => RULES_MULTI) });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));
    act(() => result.current.openEdit(RULES_MULTI[1]));
    expect(result.current.editingId).toBe(2);
    expect(result.current.draft).toEqual(RULES_MULTI[1].conditions);
    expect(result.current.draftCategoryId).toBe('transport');
    expect(result.current.right).toBe('build');
    expect(result.current.ruleTab).toBe('build');
  });

  it('reorderRules → rulesSubmitEdit(reorder) → sets sandbox state + reloads window', async () => {
    const client = makeClient({
      importRulesList: vi.fn(async () => RULES_MULTI),
      rulesSubmitEdit: vi.fn().mockResolvedValue({ engaged: true, count: 2 }),
    });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.rules.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.reorderRules([2, 1, 3]);
    });
    expect(client.rulesSubmitEdit).toHaveBeenCalledWith('sess-c', { kind: 'reorder', order: [2, 1, 3] });
    expect(result.current.sandbox?.engaged).toBe(true);
    expect(result.current.sandbox?.count).toBe(2);
  });

  it('deleteRule → rulesSubmitEdit(delete) → sets sandbox state', async () => {
    const client = makeClient({
      importRulesList: vi.fn(async () => RULES_MULTI),
      rulesSubmitEdit: vi.fn().mockResolvedValue({ engaged: true, count: 1 }),
    });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.rules.length).toBeGreaterThan(0));
    await act(async () => {
      await result.current.deleteRule(2);
    });
    expect(client.rulesSubmitEdit).toHaveBeenCalledWith('sess-c', { kind: 'delete', ruleId: 2 });
    expect(result.current.sandbox?.engaged).toBe(true);
  });

  it('submitEdit on a category-only change → categoryOnly action (no editConditions)', async () => {
    const rulesSubmitEdit = vi.fn().mockResolvedValue({ engaged: false, count: 0 });
    const client = makeClient({ importRulesList: vi.fn(async () => RULES_MULTI), rulesSubmitEdit });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.rules.length).toBeGreaterThan(0));
    act(() => result.current.openEdit(RULES_MULTI[0])); // groceries, [desc contains АТБ]
    act(() => result.current.pickCategory('transport')); // only the category changed
    await act(async () => {
      await result.current.submitEdit();
    });
    // structural compare: draft === editBefore → NO editConditions submit, only categoryOnly
    expect(rulesSubmitEdit).toHaveBeenCalledTimes(1);
    expect(rulesSubmitEdit).toHaveBeenCalledWith('sess-c', {
      kind: 'categoryOnly',
      ruleId: 1,
      categoryId: 'transport',
    });
    // edit session torn down
    expect(result.current.editingId).toBeNull();
  });

  it('submitEdit on a conditions change → editConditions action', async () => {
    const rulesSubmitEdit = vi.fn().mockResolvedValue({ engaged: true, count: 1 });
    const client = makeClient({ importRulesList: vi.fn(async () => RULES_MULTI), rulesSubmitEdit });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.rules.length).toBeGreaterThan(0));
    act(() => result.current.openEdit(RULES_MULTI[0])); // groceries, [desc contains АТБ]
    const after: ConditionDTO[] = [{ field: 'description', operator: 'contains', value: 'СІЛЬПО' }];
    act(() => result.current.setDraft(after)); // conditions changed, category unchanged
    await act(async () => {
      await result.current.submitEdit();
    });
    expect(rulesSubmitEdit).toHaveBeenCalledWith('sess-c', {
      kind: 'editConditions',
      ruleId: 1,
      before: RULES_MULTI[0].conditions,
      after,
    });
    // category unchanged → no categoryOnly submit
    expect(rulesSubmitEdit).toHaveBeenCalledTimes(1);
    expect(result.current.sandbox?.engaged).toBe(true);
  });

  it('applySandbox calls sandboxApply + clears sandbox; cancelSandbox calls sandboxCancel', async () => {
    const client = makeClient({
      sandboxState: vi.fn().mockResolvedValue({ engaged: true, count: 2 }),
      sandboxApply: vi.fn().mockResolvedValue(undefined),
      sandboxCancel: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.sandbox?.engaged).toBe(true));
    await act(async () => {
      await result.current.applySandbox();
    });
    expect(client.sandboxApply).toHaveBeenCalledWith('sess-c');
    expect(result.current.sandbox).toBeNull();
    expect(result.current.changedOnly).toBe(false);
  });

  it('cancelSandbox calls sandboxCancel + clears sandbox', async () => {
    const client = makeClient({
      sandboxState: vi.fn().mockResolvedValue({ engaged: true, count: 2 }),
      sandboxCancel: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.sandbox?.engaged).toBe(true));
    await act(async () => {
      await result.current.cancelSandbox();
    });
    expect(client.sandboxCancel).toHaveBeenCalledWith('sess-c');
    expect(result.current.sandbox).toBeNull();
  });

  it('applySandbox clears edit-open anchors (editingId → null, draft → [])', async () => {
    const client = makeClient({
      sandboxApply: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));
    // Open an edit so editingId and draft are populated.
    act(() => result.current.openEdit(RULES_MULTI[0]));
    expect(result.current.editingId).toBe(1);
    expect(result.current.draft).toHaveLength(1);
    // Apply the sandbox — must clear the edit anchors.
    await act(async () => {
      await result.current.applySandbox();
    });
    expect(result.current.editingId).toBeNull();
    expect(result.current.draft).toHaveLength(0);
    expect(result.current.sandbox).toBeNull();
    expect(result.current.changedOnly).toBe(false);
  });

  it('cancelSandbox clears edit-open anchors (editingId → null, draft → [])', async () => {
    const client = makeClient({
      sandboxCancel: vi.fn().mockResolvedValue(undefined),
    });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));
    // Open an edit so editingId and draft are populated.
    act(() => result.current.openEdit(RULES_MULTI[1]));
    expect(result.current.editingId).toBe(2);
    expect(result.current.draft).toHaveLength(1);
    // Cancel the sandbox — must clear the edit anchors.
    await act(async () => {
      await result.current.cancelSandbox();
    });
    expect(result.current.editingId).toBeNull();
    expect(result.current.draft).toHaveLength(0);
    expect(result.current.sandbox).toBeNull();
    expect(result.current.changedOnly).toBe(false);
  });

  it('toggleChangedOnly threads changedOnly into importCategorizedRows', async () => {
    const importCategorizedRows = vi.fn(
      async (_s: string, opts: { changedOnly?: boolean }): Promise<CategorizedWindowDTO> => {
        void opts;
        return win();
      },
    );
    const client = makeClient({ importCategorizedRows });
    const { result } = renderHook(() => useS3cSession(client, 'sess-c'));
    await waitFor(() => expect(result.current.fields.length).toBeGreaterThan(0));
    act(() => result.current.toggleChangedOnly());
    expect(result.current.changedOnly).toBe(true);
    await waitFor(() => expect(importCategorizedRows.mock.calls.at(-1)?.[1].changedOnly).toBe(true));
  });
});
