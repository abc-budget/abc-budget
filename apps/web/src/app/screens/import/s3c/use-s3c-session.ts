import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CategorizedWindowDTO,
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  EngineClient,
  RuleSummaryDTO,
  WhyTreeDTO,
} from '@abc-budget/engine';
import { defaultValueFor } from './ConditionRow';
import type { OpsSegment } from './OpsPanel';
import type { RuleTab } from './RulePanel';

/**
 * use-s3c-session (Story 4.9a Task 4) — the S3c categorization state machine over
 * the EngineClient v4 seam.  Mirrors the S3b hook's shape: local state + wire
 * calls + reload-after-mutation.  The screen is a pure projection of this hook.
 *
 * SEEDING: the live session already exists (S3b's importNext kept it alive —
 * engine-client.ts importNext contract).  On mount the hook loads the static
 * surfaces (condition fields, categories, rules) and the first categorized-rows
 * window.  Re-seeds when the sessionId changes (a fresh S3a session).
 *
 * RE-CATEGORIZE-LIVE flow (the load-bearing contract): rulesCreate persists a
 * rule worker-side, where the rule engine re-runs over the rows.  The hook does
 * NOT compute the new categories — it RELOADS the window (importCategorizedRows)
 * + the rules list, so the OPS table re-renders against the engine's truth.
 *
 * DRAFT PREVIEW: a non-empty draft is passed to importCategorizedRows as `opts.draft`
 * so the window previews the not-yet-saved rule (matchCount = the live count).
 * The amount-condition currency is collected IN the draft by the builder; saveRule
 * passes the ConditionDTO[] as-is — the worker enforces the amount↔currency
 * pairing.  A thrown error (missing currency) surfaces loudly (the UI prevents it).
 */

/** The create-category dialog state (seeded from the picker's search, or blank). */
export interface CreateCatState {
  readonly initialName: string;
  /** True when launched from the rule-builder's CategoryPicker → auto-select on create. */
  readonly fromPicker: boolean;
}

export interface S3cSession {
  // ── OPS window ─────────────────────────────────────────────────────────────
  /** The latest categorized-rows window (rows + total + live matchCount). */
  window: CategorizedWindowDTO;
  segment: OpsSegment;
  page: number;

  // ── Rule draft ─────────────────────────────────────────────────────────────
  draft: ConditionDTO[];
  draftCategoryId: string | null;

  // ── Reference surfaces ─────────────────────────────────────────────────────
  rules: RuleSummaryDTO[];
  categories: CategoryDTO[];
  /** id → CategoryDTO index (the OPS + why panels resolve categories through it). */
  categoryIndex: Map<string, CategoryDTO>;
  fields: ConditionFieldDTO[];

  // ── Right pane (RUL/ build OR LOG/ why) ────────────────────────────────────
  right: 'build' | 'why';
  whyRowIndex: number | null;
  why: WhyTreeDTO | null;
  ruleTab: RuleTab;

  // ── Create-category modal ──────────────────────────────────────────────────
  createCat: CreateCatState | null;

  // ── Methods ────────────────────────────────────────────────────────────────
  setDraft: (next: ConditionDTO[]) => void;
  addCondition: (field: string, operator: string) => void;
  pickCategory: (categoryId: string) => void;
  saveRule: () => Promise<void>;
  openWhy: (rowIndex: number) => Promise<void>;
  closeWhy: () => void;
  openCreateCategory: (initialName: string, fromPicker: boolean) => void;
  closeCreateCategory: () => void;
  createCategory: (data: { name: string; icon: string; currency: string }) => Promise<void>;
  setSegment: (segment: OpsSegment) => void;
  setPage: (page: number) => void;
  setRuleTab: (tab: RuleTab) => void;
}

const EMPTY_WINDOW: CategorizedWindowDTO = { rows: [], total: 0, matchCount: 0 };
/** Window size — full ops set flows here (row economy); the panel paginates within. */
const WINDOW_COUNT = 240;

export function useS3cSession(client: EngineClient, sessionId: string, active = true): S3cSession {
  const [windowDto, setWindowDto] = useState<CategorizedWindowDTO>(EMPTY_WINDOW);
  const [segment, setSegmentState] = useState<OpsSegment>('all');
  const [page, setPage] = useState(0);

  const [draft, setDraftState] = useState<ConditionDTO[]>([]);
  const [draftCategoryId, setDraftCategoryId] = useState<string | null>(null);

  const [rules, setRules] = useState<RuleSummaryDTO[]>([]);
  const [categories, setCategories] = useState<CategoryDTO[]>([]);
  const [fields, setFields] = useState<ConditionFieldDTO[]>([]);

  const [right, setRight] = useState<'build' | 'why'>('build');
  const [whyRowIndex, setWhyRowIndex] = useState<number | null>(null);
  const [why, setWhy] = useState<WhyTreeDTO | null>(null);
  const [ruleTab, setRuleTab] = useState<RuleTab>('build');

  const [createCat, setCreateCat] = useState<CreateCatState | null>(null);

  /**
   * Reload the OPS window for the given segment + (optional) draft.  The single
   * window load — every mutation (saveRule / addCondition / segment / page)
   * funnels through here so the OPS always reflects the engine's truth.
   */
  const reloadWindow = useCallback(
    async (seg: OpsSegment, draftConds: ConditionDTO[]) => {
      const opts: { offset: number; count: number; segment: 'all' | 'uncat'; draft?: ConditionDTO[] } = {
        offset: 0,
        count: WINDOW_COUNT,
        segment: seg,
      };
      if (draftConds.length > 0) opts.draft = draftConds;
      const win = await client.importCategorizedRows(sessionId, opts);
      setWindowDto(win);
    },
    [client, sessionId],
  );

  const reloadRules = useCallback(async () => {
    setRules(await client.importRulesList(sessionId));
  }, [client, sessionId]);

  const refreshCategories = useCallback(async (): Promise<CategoryDTO[]> => {
    const cats = await client.categoriesList();
    setCategories(cats);
    return cats;
  }, [client]);

  /**
   * Lazy mount load (+ re-seed on session swap): static surfaces + first window.
   *
   * Gated on `active` (the step being REACHED): the categorization fan-out must
   * not fire while the user is still on S3a/S3b — those surfaces don't exist yet
   * for the user and a premature load couples the whole flow to the v4 wire.
   * The hook is still called unconditionally (Rules of Hooks); only the FETCH is
   * deferred until S3c is the active step.  Keyed on (sessionId), so a swap
   * re-seeds and an active re-entry on the same session does not re-fetch.
   */
  const seededSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!active) return;
    if (seededSessionRef.current === sessionId) return;
    seededSessionRef.current = sessionId;
    if (!sessionId) {
      setWindowDto(EMPTY_WINDOW);
      setFields([]);
      setCategories([]);
      setRules([]);
      return;
    }
    let live = true;
    void (async () => {
      const [f, cats, rs, win] = await Promise.all([
        client.importConditionFields(sessionId),
        client.categoriesList(),
        client.importRulesList(sessionId),
        client.importCategorizedRows(sessionId, { offset: 0, count: WINDOW_COUNT, segment: 'all' }),
      ]);
      if (!live) return;
      setFields(f);
      setCategories(cats);
      setRules(rs);
      setWindowDto(win);
      // Reset the per-session view state on a fresh session.
      setSegmentState('all');
      setPage(0);
      setDraftState([]);
      setDraftCategoryId(null);
      setRight('build');
      setRuleTab('build');
      setWhy(null);
      setWhyRowIndex(null);
      setCreateCat(null);
    })();
    return () => {
      live = false;
    };
  }, [client, sessionId, active]);

  // ── Draft ──────────────────────────────────────────────────────────────────

  const setDraft = useCallback(
    (next: ConditionDTO[]) => {
      setDraftState(next);
      void reloadWindow(segment, next);
    },
    [reloadWindow, segment],
  );

  /** Funnel → seed a new condition (kind-shaped default value) → reload preview. */
  const addCondition = useCallback(
    (fieldId: string, operator: string) => {
      const field = fields.find((f) => f.field === fieldId);
      const seeded: ConditionDTO = {
        field: fieldId,
        operator,
        value: field ? defaultValueFor(field) : '',
      };
      setDraftState((prev) => {
        const next = [...prev, seeded];
        void reloadWindow(segment, next);
        return next;
      });
      // Building a rule lives on the BUILD tab + the RUL/ pane.
      setRight('build');
      setRuleTab('build');
    },
    [fields, reloadWindow, segment],
  );

  const pickCategory = useCallback((categoryId: string) => {
    setDraftCategoryId(categoryId);
  }, []);

  // ── Save a rule → re-categorize live ─────────────────────────────────────────

  const saveRule = useCallback(async () => {
    if (draft.length === 0 || draftCategoryId == null) return;
    // The worker enforces the amount↔currency pairing; a missing currency throws
    // and the rejection propagates loudly (the builder prevents reaching here).
    await client.rulesCreate(draft, draftCategoryId);
    const savedSegment = segment;
    setDraftState([]);
    setDraftCategoryId(null);
    // Reload WITHOUT the draft (it is now a persisted rule) + refresh the list:
    // the OPS re-renders against the engine's freshly re-categorized truth.
    await Promise.all([reloadWindow(savedSegment, []), reloadRules()]);
  }, [client, draft, draftCategoryId, segment, reloadWindow, reloadRules]);

  // ── Why (LOG/) ───────────────────────────────────────────────────────────────

  const openWhy = useCallback(
    async (rowIndex: number) => {
      setWhyRowIndex(rowIndex);
      setRight('why');
      const tree = await client.importWhy(sessionId, rowIndex);
      setWhy(tree);
    },
    [client, sessionId],
  );

  const closeWhy = useCallback(() => {
    setRight('build');
    setWhy(null);
    setWhyRowIndex(null);
  }, []);

  // ── Create category ──────────────────────────────────────────────────────────

  const openCreateCategory = useCallback((initialName: string, fromPicker: boolean) => {
    setCreateCat({ initialName, fromPicker });
  }, []);

  const closeCreateCategory = useCallback(() => setCreateCat(null), []);

  const createCategory = useCallback(
    async (data: { name: string; icon: string; currency: string }) => {
      const fromPicker = createCat?.fromPicker ?? false;
      const created = await client.categoriesCreate(data);
      await refreshCategories();
      setCreateCat(null);
      // Launched from the rule-builder's picker → auto-select the new category.
      if (fromPicker) setDraftCategoryId(created.id);
    },
    [client, createCat, refreshCategories],
  );

  // ── Segment / page ───────────────────────────────────────────────────────────

  const setSegment = useCallback(
    (seg: OpsSegment) => {
      setSegmentState(seg);
      setPage(0);
      void reloadWindow(seg, draft);
    },
    [reloadWindow, draft],
  );

  return {
    window: windowDto,
    segment,
    page,
    draft,
    draftCategoryId,
    rules,
    categories,
    categoryIndex: new Map(categories.map((c) => [c.id, c])),
    fields,
    right,
    whyRowIndex,
    why,
    ruleTab,
    createCat,
    setDraft,
    addCondition,
    pickCategory,
    saveRule,
    openWhy,
    closeWhy,
    openCreateCategory,
    closeCreateCategory,
    createCategory,
    setSegment,
    setPage,
    setRuleTab,
  };
}
