/**
 * CategorizationService IMPLEMENTATION — Story 4.9a S3c, Task 2 (EP-4).
 * @module internal/worker/categorization-service-impl
 * @internal
 *
 * The engine-side heart of S3c: the {@link CategorizationService} (declared in
 * Task 1) composed over the ALREADY-MERGED EP-4 graph. NOTHING here is
 * reimplemented — every behaviour delegates to a merged piece:
 *
 *   - {@link autoCategorize} (4.7)         — the L1→L4 per-row category ladder.
 *   - {@link RulePersistenceService} (4.3b) — `reload()` the live tree + `create()`.
 *   - {@link DecisionTreeDebuggerImpl} (4.2) — the winning ruleId + appliedCount
 *     + the why-tree (win/miss/neutral short-circuit).
 *   - {@link loadOverrideMap} (4.4.1)      — the triplet-keyed manual-override map
 *     (for the why-tree's manual-override surfacing).
 *   - the 4.1 rule factories               — `conditionsToRules` (amount via the
 *     Fork-B {@link createAmountCondition} pair — unconstructable without a currency).
 *   - {@link CategoriesService} (4.3a)     — list/create («base» resolved at read).
 *
 * SESSION ROWS: the impl never re-runs the pipeline. It reads a session's
 * stage3 rows through the injected {@link SessionRowsAccessor} — the same typed
 * rows `importGetRows` serves (the direct-client wires it over the live
 * SessionRegistry's cached `generatedRows`).
 *
 * SERIALIZABLE OUT: every method returns the plain wire DTOs from client/dto.ts.
 * Worker-side only — the UI never imports this module.
 */

import type {
  CategoryDTO,
  ConditionDTO,
  ConditionFieldDTO,
  CategorizedRowDTO,
  CategorizedWindowDTO,
  WhyTreeDTO,
  WhyRuleDTO,
  RuleSummaryDTO,
  EditActionDTO,
  SandboxStateDTO,
} from '../../client/dto';
import type { CategorizationService } from './categorization-service';
import type { CategoriesService } from '../categories/categories-service';
import type { FootprintDao } from '../footprint/footprint-dao';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';
import { autoCategorize, distinctPeriods } from '../rules/auto-categorize';
import { loadOverrideMap, overrideKeyForRow } from '../rules/categorize-with-overrides';
import { ComplexRuleImpl } from '../rules/decision-tree-impl';
import {
  RuleSandboxSession,
  classifyEditAction,
  type EditAction,
  type RuleSandboxDeps,
} from '../rules/rule-sandbox';
import type { Category } from '../categories/types';
import { DecisionTreeDebuggerImpl } from '../rules/debugger';
import type { ComplexRule, DecisionTree } from '../rules/decision-tree';
import { serializeRule } from '../rules/complex-rules-dao';
import type { RuleDTO } from '../rules/complex-rules-dao';
import type {
  BooleanOperation,
  DateOperation,
  NumberOperation,
  RuleOperation,
  StringMatchOperation,
  StringOperation,
} from '../rules/operations';
import type { Rule } from '../rules/rule';
import {
  createAccountRule,
  createAmountCondition,
  createBankCategoryRule,
  createCounterpartyRule,
  createCurrencyRule,
  createDateRule,
  createDescriptionRule,
  createIsBankCommissionRule,
  createIsCashbackRule,
  createMccRule,
} from '../rules/rule-factories';
import type { RulePersistenceService } from '../rules/rule-persistence-service';

/**
 * Reads a session's generated stage3 rows by id — the SAME typed rows
 * `importGetRows` windows (the direct-client wires this over the live
 * SessionRegistry's cached `generatedRows`). The accessor never re-runs the
 * pipeline; it returns the already-generated rows.
 */
export type SessionRowsAccessor = (
  sessionId: string,
) => Promise<ImportStatementStage3Row[]>;

/** The deps the categorization service composes over (all from the EP-4 graph). */
export interface CategorizationServiceDeps {
  /** The session-rows accessor (the worker-side stage3-row seam). */
  readonly getSessionRows: SessionRowsAccessor;
  /** The footprint DAO — the override-map source (4.4/4.4.1). */
  readonly footprintDao: FootprintDao;
  /** The categories service (4.3a) — list/create + «base» resolution. */
  readonly categoriesService: CategoriesService;
  /** The rule-persistence service (4.3b) — reload() the live tree + create(). */
  readonly rulePersistence: RulePersistenceService;
}

/**
 * The condition fields the import can build rules against — the per-field
 * valueKind + the operator grammar (4.1). Categorical fields (mcc/currency/
 * bankCategory) ALSO carry their distinct-values option set, filled from the
 * rows present.
 */
interface FieldGrammar {
  readonly field: string;
  readonly valueKind: ConditionFieldDTO['valueKind'];
  readonly operators: string[];
  /** True when the field is categorical → its options come from the rows. */
  readonly categorical?: boolean;
}

/**
 * The per-field grammar (4.1 condition grammar). NOTE the NAME-TRAP binding:
 * the UI "category" condition field IS `bankCategory` (the BANK category), never
 * the assigned budget category.
 *
 * This is the GRAMMAR table only — what valueKind/operators a field would carry
 * IF it appears on the surface. WHICH fields appear is decided by
 * {@link CategorizationServiceImpl.importConditionFields} from the import's mapped
 * columns: date/amount anchor, the optional fields appear only when the rows carry
 * them, and `currency` appears only when the rows carry >1 distinct currency.
 *
 * The boolean entries (isBankCommission/isCashback) exist here for the rule
 * grammar (`conditionsToRules`) ONLY — they are derived markers, NOT user-mapped
 * condition columns, so importConditionFields NEVER surfaces them (re-QA FINDING-C).
 */
const FIELD_GRAMMAR: Record<string, FieldGrammar> = {
  date: {
    field: 'date',
    valueKind: 'day',
    operators: [
      'firstDayOfMonth',
      'firstMondayOfMonth',
      'firstSaturdayOfMonth',
      'firstSundayOfMonth',
      'lastDayOfMonth',
      'lastMondayOfMonth',
      'lastSaturdayOfMonth',
      'lastSundayOfMonth',
      'specificDay',
      'dayRange',
    ],
  },
  amount: {
    field: 'amount',
    valueKind: 'num',
    operators: [
      'equals',
      'notEquals',
      'greaterThan',
      'lessThan',
      'greaterThanOrEqual',
      'lessThanOrEqual',
      'between',
    ],
  },
  description: {
    field: 'description',
    valueKind: 'text',
    operators: [
      'equals',
      'notEquals',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'matches',
    ],
  },
  counterparty: {
    field: 'counterparty',
    valueKind: 'text',
    operators: [
      'equals',
      'notEquals',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'matches',
    ],
  },
  account: {
    field: 'account',
    valueKind: 'text',
    operators: [
      'equals',
      'notEquals',
      'contains',
      'notContains',
      'startsWith',
      'endsWith',
      'matches',
    ],
  },
  currency: {
    field: 'currency',
    valueKind: 'optone',
    operators: ['equals', 'notEquals', 'oneOf'],
    categorical: true,
  },
  bankCategory: {
    field: 'bankCategory',
    valueKind: 'optset',
    operators: ['equals', 'notEquals', 'oneOf'],
    categorical: true,
  },
  mcc: {
    field: 'mcc',
    valueKind: 'code',
    operators: ['equals', 'notEquals', 'oneOf'],
    categorical: true,
  },
  isBankCommission: {
    field: 'isBankCommission',
    valueKind: 'bool',
    operators: ['isTrue', 'isFalse'],
  },
  isCashback: {
    field: 'isCashback',
    valueKind: 'bool',
    operators: ['isTrue', 'isFalse'],
  },
};

/**
 * The structural fields a valid import ALWAYS maps (so they always anchor the
 * field surface): date + amount. NOTHING else is forced here.
 *
 * Deliberately EXCLUDED (re-QA FINDING-C):
 *   - `currency` — the row-generator forces it to the base currency on EVERY row
 *     even when NO currency column was mapped (see amount-currency-detector's
 *     `use_base`/`auto`-with-no-column fallbacks). So a non-null `currency` is NOT
 *     proof of a mapped column. It is handled as a conditional field below: present
 *     only when the rows actually carry MORE THAN ONE distinct currency (the
 *     row-derivable signal that a CURRENCY column was mapped — ENT-009/010).
 *   - `isBankCommission` / `isCashback` — derived booleans, ALWAYS set (false/true,
 *     never null) on every row. They are NOT user-mappable condition-grammar columns,
 *     so they are NOT OPS columns / filter fields. The `conditionsToRules` boolean
 *     factories stay (the rule grammar can still build them for other uses), but they
 *     never appear on the importConditionFields surface.
 */
const ALWAYS_PRESENT_FIELDS: ReadonlyArray<string> = ['date', 'amount'];

/** The optional fields — present in the grammar only when the rows carry them. */
const OPTIONAL_FIELDS: ReadonlyArray<keyof ImportStatementStage3Row> = [
  'description',
  'counterparty',
  'account',
  'bankCategory',
  'mcc',
];

/**
 * The categorization assembly over the merged EP-4 graph.
 *
 * Constructed from the composed deps (the session-rows accessor, the footprint
 * DAO, the categories service, the rule-persistence service). Holds NO mutable
 * state — every call re-reads the rows + reloads the live tree, so a rule edit
 * between calls is reflected on the next call (RE-IMPORT semantics, Q-007).
 */
export class CategorizationServiceImpl implements CategorizationService {
  private readonly getSessionRows: SessionRowsAccessor;
  private readonly footprintDao: FootprintDao;
  private readonly categoriesService: CategoriesService;
  private readonly rulePersistence: RulePersistenceService;

  /**
   * The open sandbox sessions, keyed by import session id. A session is RETAINED
   * here only while ENGAGED (a virtual preview tree exists); a live-persisted or
   * canonical-no-op edit drops it. The sandbox-aware {@link importCategorizedRows}
   * reads the engaged session's {@link RuleSandboxSession.computeDiff} as the
   * row-level overlay (4.9b).
   */
  private readonly sandboxes = new Map<string, RuleSandboxSession>();

  constructor(deps: CategorizationServiceDeps) {
    this.getSessionRows = deps.getSessionRows;
    this.footprintDao = deps.footprintDao;
    this.categoriesService = deps.categoriesService;
    this.rulePersistence = deps.rulePersistence;
  }

  // ── conditionsToRules (the field→factory dispatch) ─────────────────────────

  /**
   * Maps a list of {@link ConditionDTO}s to the flattened {@link Rule}[] a
   * {@link ComplexRule} AND-combines. A field→factory dispatch (like
   * `rehydrateRule`, but from `{field, operator, value}`): each DTO's
   * `{operator, value}` builds the per-field operation object, then the matching
   * 4.1 factory builds the rule.
   *
   * amount is the Fork-B exception: it goes through {@link createAmountCondition}
   * (op, currency) — which AND-pairs the bare amount rule with a
   * `currency=equals` rule — so an amount condition CONTRIBUTES TWO rules and is
   * unconstructable without a currency (a loud throw enforces the pairing).
   */
  conditionsToRules(conditions: ConditionDTO[]): Rule[] {
    const rules: Rule[] = [];
    for (const dto of conditions) {
      switch (dto.field) {
        case 'date':
          rules.push(createDateRule(toDateOperation(dto)));
          break;
        case 'amount': {
          // Fork-B pairing invariant: amount carries its currency in the DTO.
          if (dto.currency === undefined || String(dto.currency).trim() === '') {
            throw new TypeError(
              `[abc-engine] conditionsToRules: an amount condition requires a currency ` +
                `(the amount↔currency pairing invariant — operator '${dto.operator}'). ` +
                `The amount factory is the Fork-B createAmountCondition(op, currency).`,
            );
          }
          // createAmountCondition returns the [amountRule, currencyEqualsRule] pair.
          rules.push(...createAmountCondition(toNumberOperation(dto), dto.currency));
          break;
        }
        case 'description':
          rules.push(createDescriptionRule(toStringOperation(dto)));
          break;
        case 'counterparty':
          rules.push(createCounterpartyRule(toStringOperation(dto)));
          break;
        case 'account':
          rules.push(createAccountRule(toStringOperation(dto)));
          break;
        case 'currency':
          rules.push(createCurrencyRule(toStringMatchOperation(dto)));
          break;
        case 'bankCategory':
          rules.push(createBankCategoryRule(toStringMatchOperation(dto)));
          break;
        case 'mcc':
          rules.push(createMccRule(toStringMatchOperation(dto)));
          break;
        case 'isBankCommission':
          rules.push(createIsBankCommissionRule(toBooleanOperation(dto)));
          break;
        case 'isCashback':
          rules.push(createIsCashbackRule(toBooleanOperation(dto)));
          break;
        default:
          throw new TypeError(
            `[abc-engine] conditionsToRules: unsupported condition field '${dto.field}'.`,
          );
      }
    }
    return rules;
  }

  // ── importCategorizedRows ──────────────────────────────────────────────────

  async importCategorizedRows(
    sessionId: string,
    opts: {
      offset: number;
      count: number;
      segment: 'all' | 'uncat';
      draft?: ConditionDTO[];
      changedOnly?: boolean;
    },
  ): Promise<CategorizedWindowDTO> {
    const rows = await this.getSessionRows(sessionId);
    const tree = await this.rulePersistence.reload();

    // Live per-row {categoryId, isManual} via the L1→L4 ladder (4.7).
    const categorized = await autoCategorize(rows, {
      tree,
      footprintDao: this.footprintDao,
      categoriesService: this.categoriesService,
    });

    // The WINNING ruleId per row — a single debugger pass over the live tree.
    const ruleIdByRowIndex = winningRuleIds(tree, rows);

    // Sandbox overlay (4.9b): while an engaged session exists, the pending-
    // preview diff (old→new category per CHANGED row) overlays the live category
    // — and `changedOnly` windows ONLY those rows. When NOT engaged the overlay
    // is null and the method behaves EXACTLY as 4.9a. computeDiff resolves an
    // L1/L2-overridden row identically under both trees, so an override-pinned
    // row is never in the diff (override-ops are structurally absent).
    const session = this.sandboxes.get(sessionId);
    const diffByRow = session?.engaged
      ? new Map(session.computeDiff().map((d) => [d.rowIndex, d]))
      : null;

    // The draft preview: a ComplexRule built from the draft conditions, matched
    // synchronously per row. matchCount = TOTAL matches across ALL rows (before
    // windowing) — the live-match count the UI shows.
    let draftRule: ComplexRule | null = null;
    if (opts.draft && opts.draft.length > 0) {
      // The category is irrelevant to a draft MATCH — we only call .evaluate().
      draftRule = new ComplexRuleImpl(
        this.conditionsToRules(opts.draft),
        { name: '', icon: '', isArchived: false, currency: '' },
      );
    }

    let matchCount = 0;
    // Build the segment-filtered, draft-filtered list (full, then window).
    const passing: {
      row: ImportStatementStage3Row;
      categoryId: string | null;
      isManual: 0 | 1;
      previousCategoryId?: string | null;
    }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const live = categorized[i];

      // Sandbox overlay: a CHANGED row takes the virtual category, recording the
      // live (current-tree) category as previousCategoryId (old→new). Unchanged
      // rows keep the 4.9a value and carry NO previousCategoryId (undefined).
      const diff = diffByRow?.get(row.rowIndex);
      const categoryId = diff ? diff.newCategoryId : live.categoryId;
      const isManual = live.isManual;
      const previousCategoryId = diff ? diff.oldCategoryId : undefined;

      const draftMatch = draftRule ? draftRule.evaluate(row) : false;
      if (draftMatch) matchCount++;

      // changedOnly (4.9b): window ONLY the diff rows when an overlay is present.
      if (opts.changedOnly && diffByRow && !diffByRow.has(row.rowIndex)) continue;
      // segment filter: 'uncat' keeps only categoryId === null.
      if (opts.segment === 'uncat' && categoryId !== null) continue;
      // draft filter: when a draft is set, the window shows only its matches.
      if (draftRule && !draftMatch) continue;

      passing.push({ row, categoryId, isManual, previousCategoryId });
    }

    const total = passing.length;
    const window = passing.slice(opts.offset, opts.offset + opts.count);

    const dtoRows: CategorizedRowDTO[] = window.map(({ row, categoryId, isManual, previousCategoryId }) =>
      toCategorizedRowDTO(
        row,
        categoryId,
        isManual,
        ruleIdByRowIndex.get(row.rowIndex) ?? null,
        previousCategoryId,
      ),
    );

    // v6 (4.9c): count uncategorized rows across the FULL row set (not just the window).
    const remainderCount = rows.filter((_, i) => {
      const diff = diffByRow?.get(rows[i].rowIndex);
      return diff ? diff.newCategoryId === null : categorized[i].categoryId === null;
    }).length;

    return { rows: dtoRows, total, matchCount, remainderCount };
  }

  // ── importConditionFields ──────────────────────────────────────────────────

  async importConditionFields(sessionId: string): Promise<ConditionFieldDTO[]> {
    const rows = await this.getSessionRows(sessionId);

    // The fields the import actually mapped (ENT-009/010) — NOT a hardcoded
    // universal list. The mapped-column DEFINITIONS are not reachable through the
    // session-rows accessor seam (it serves only stage3 rows), so the mapped set
    // is derived from the rows themselves:
    //
    //   - date + amount  — structural; a valid import always maps them.
    //   - the OPTIONAL fields (description/counterparty/account/bankCategory/mcc)
    //     — present iff non-null on at least one row (the row-generator leaves an
    //     unmapped optional field null, so non-null ⇒ a column mapped to it).
    //   - currency       — SPECIAL (re-QA FINDING-C): the row-generator forces it
    //     to the base currency on every row even when no CURRENCY column was
    //     mapped, so non-null is NOT proof of mapping. The honest row-derivable
    //     signal of a mapped CURRENCY column is that the rows carry MORE THAN ONE
    //     distinct currency. Only then is `currency` a real mapped condition field.
    //   - isBankCommission/isCashback — derived booleans, never surfaced here.
    const fields: string[] = [...ALWAYS_PRESENT_FIELDS];

    // currency: mapped iff the rows carry >1 distinct currency value.
    if (distinctCount(rows, 'currency') > 1) {
      fields.push('currency');
    }

    for (const f of OPTIONAL_FIELDS) {
      if (rows.some((r) => r[f] !== null && r[f] !== undefined)) {
        fields.push(f);
      }
    }

    return fields.map((field) => {
      const grammar = FIELD_GRAMMAR[field];
      const dto: { -readonly [K in keyof ConditionFieldDTO]: ConditionFieldDTO[K] } = {
        field,
        valueKind: grammar.valueKind,
        operators: [...grammar.operators],
      };
      if (grammar.categorical) {
        dto.options = distinctOptions(rows, field as keyof ImportStatementStage3Row);
      }
      return dto;
    });
  }

  // ── importWhy ──────────────────────────────────────────────────────────────

  async importWhy(sessionId: string, rowIndex: number): Promise<WhyTreeDTO> {
    const rows = await this.getSessionRows(sessionId);
    const row = rows.find((r) => r.rowIndex === rowIndex);
    if (!row) {
      throw new Error(
        `[abc-engine] importWhy: row ${rowIndex} not found in session '${sessionId}'.`,
      );
    }

    const tree = await this.rulePersistence.reload();

    // Manual-override surfacing (L1/L2): if the row resolves via an in-session
    // manual pick OR a persisted override (the 4.4.1 triplet map), that wins
    // outright — no rule is the winner.
    const manual = await this.resolveManual(row);

    // The 4.2 debugger over the ONE row. categorizeRow short-circuits at the
    // first matching complexRule, so the debugger records evaluations UP TO the
    // winner only — rules AFTER it were never evaluated (→ 'neutral').
    const debug = new DecisionTreeDebuggerImpl();
    tree.categorizeRow(row, debug);
    const path = debug.getDecisionTreePath(row);
    const evaluatedRules = path?.complexRuleResults ?? [];

    // Map each complexRule (in tree order) to its why-status.
    const evaluatedById = new Map<number, (typeof evaluatedRules)[number]>();
    for (const ev of evaluatedRules) {
      const id = ev.complexRule.id;
      if (id !== undefined) evaluatedById.set(id, ev);
    }

    let winnerRuleId: number | null = null;
    const whyRules: WhyRuleDTO[] = tree.complexRules.map((complexRule) => {
      const id = complexRule.id ?? -1;
      const ev = evaluatedById.get(id);
      let status: WhyRuleDTO['status'];
      if (ev === undefined) {
        // Not evaluated — short-circuited away (after the winner).
        status = 'neutral';
      } else if (ev.result) {
        status = 'win';
        if (winnerRuleId === null) winnerRuleId = id;
      } else {
        status = 'miss';
      }
      return {
        ruleId: id,
        status,
        conditions: whyConditions(complexRule, ev?.ruleResults),
        categoryId: complexRule.category.id ?? '',
      };
    });

    // A manual override wins outright — null out any rule winner.
    return {
      manual,
      rules: whyRules,
      winnerRuleId: manual ? null : winnerRuleId,
    };
  }

  // ── importRulesList ────────────────────────────────────────────────────────

  async importRulesList(sessionId: string): Promise<RuleSummaryDTO[]> {
    const rows = await this.getSessionRows(sessionId);
    const tree = await this.rulePersistence.reload();

    // appliedCount per rule: how many of THIS session's rows the tree routed to
    // that rule (the first-match winner per row), via a single debugger pass.
    const ruleIdByRowIndex = winningRuleIds(tree, rows);
    const appliedCount = new Map<number, number>();
    for (const id of ruleIdByRowIndex.values()) {
      if (id !== null) appliedCount.set(id, (appliedCount.get(id) ?? 0) + 1);
    }

    // First-match order = the tree's complexRules order (reload() reads ordered).
    return tree.complexRules.map((complexRule) => {
      const id = complexRule.id ?? -1;
      return {
        ruleId: id,
        conditions: complexRule.rules.map(ruleToConditionDTO),
        categoryId: complexRule.category.id ?? '',
        appliedCount: appliedCount.get(id) ?? 0,
      };
    });
  }

  // ── rulesCreate ────────────────────────────────────────────────────────────

  async rulesCreate(
    conditions: ConditionDTO[],
    categoryId: string,
  ): Promise<{ ruleId: number }> {
    // conditionsToRules first — an amount-without-currency throws BEFORE any
    // persistence touches the store (the pairing invariant, loud).
    const rules = this.conditionsToRules(conditions);

    const category = await this.categoriesService.get(categoryId);
    if (!category) {
      throw new Error(`[abc-engine] rulesCreate: category '${categoryId}' not found.`);
    }

    const complexRule = new ComplexRuleImpl(rules, category);
    const created = await this.rulePersistence.create(complexRule);
    if (created.id === undefined) {
      throw new Error('[abc-engine] rulesCreate: persistence returned no rule id.');
    }
    return { ruleId: created.id };
  }

  // ── categoriesList / categoriesCreate ──────────────────────────────────────

  async categoriesList(): Promise<CategoryDTO[]> {
    const categories = await this.categoriesService.list();
    return categories.map((c) => ({
      id: c.id ?? '',
      name: c.name,
      icon: c.icon,
      currency: c.currency, // «base» already resolved by the service at read.
    }));
  }

  async categoriesCreate(input: {
    name: string;
    icon: string;
    currency: string;
  }): Promise<CategoryDTO> {
    const created = await this.categoriesService.create({
      name: input.name,
      icon: input.icon,
      currency: input.currency,
    });
    // Re-read so the «base» alias resolves (create stores the literal as given).
    const resolved = (created.id ? await this.categoriesService.get(created.id) : null) ?? created;
    return {
      id: resolved.id ?? '',
      name: resolved.name,
      icon: resolved.icon,
      currency: resolved.currency,
    };
  }

  // ── v5 sandbox lifecycle (4.9b — rule editing + the sandbox) ────────────────
  //
  // A funnel over the headless RuleSandboxSession (4.5): rulesClassify previews
  // the lane (pure, no engage); rulesSubmitEdit routes the edit (a LIVE edit
  // persists immediately + drops the session, a SANDBOX edit engages + retains
  // it); sandboxState/Apply/Cancel/dropSandbox manage the retained session.

  /**
   * Previews an edit's lane (`'live'` | `'sandbox'`) WITHOUT engaging a session —
   * the «dynamic button» preview. Pure: builds the category index, lifts the DTO
   * to an engine {@link EditAction}, and routes via {@link classifyEditAction}.
   */
  async rulesClassify(_sessionId: string, dto: EditActionDTO): Promise<'live' | 'sandbox'> {
    const categoriesById = await this.buildCategoriesById();
    return classifyEditAction(this.toEditAction(dto, categoriesById));
  }

  /**
   * Submits an edit through the sandbox funnel.
   *
   *  - A LIVE edit while NOT engaged persists immediately and the session is
   *    dropped (`engaged:false`). A canonical no-op (`editConditions` whose set
   *    is unchanged) also resolves live → dropped.
   *  - A SANDBOX edit (or ANY edit once engaged) accumulates into the virtual
   *    preview tree; the session is RETAINED and `{engaged:true, count}` returned.
   */
  async rulesSubmitEdit(sessionId: string, dto: EditActionDTO): Promise<SandboxStateDTO> {
    let session = this.sandboxes.get(sessionId);
    let categoriesById: Map<string, Category>;
    if (session) {
      // Refetch — a category may have been created mid-sandbox.
      categoriesById = await this.buildCategoriesById();
    } else {
      const deps = await this.buildSandboxDeps(sessionId);
      categoriesById = deps.categoriesById;
      session = new RuleSandboxSession(deps);
    }

    await session.submit(this.toEditAction(dto, categoriesById));

    if (session.engaged) {
      this.sandboxes.set(sessionId, session);
      return { engaged: true, count: session.computeDiff().length };
    }
    // Live persisted, or a canonical no-op → nothing pending.
    this.sandboxes.delete(sessionId);
    return { engaged: false, count: 0 };
  }

  /** The current sandbox state for a session — sync, ZERO DB. */
  sandboxState(sessionId: string): SandboxStateDTO {
    const session = this.sandboxes.get(sessionId);
    return session?.engaged
      ? { engaged: true, count: session.computeDiff().length }
      : { engaged: false, count: 0 };
  }

  /** Commits the pending preview (persists the virtual tree delta) + tears down. */
  async sandboxApply(sessionId: string): Promise<void> {
    const session = this.sandboxes.get(sessionId);
    if (session?.engaged) {
      await session.apply();
    }
    this.sandboxes.delete(sessionId);
  }

  /** Discards the pending preview + tears down — sync; the live tree is unchanged. */
  sandboxCancel(sessionId: string): void {
    this.sandboxes.get(sessionId)?.cancel();
    this.sandboxes.delete(sessionId);
  }

  /** Drops any open sandbox for a session (importAbort teardown) — sync, idempotent. */
  dropSandbox(sessionId: string): void {
    this.sandboxes.delete(sessionId);
  }

  // ── v6 stubs (4.9c — implemented in Task 2) ─────────────────────────────────

  /** @throws Loudly — lands in Task 2. */
  async importRemainderMagnitude(_sessionId: string): Promise<import('../../client/dto').RemainderMagnitudeDTO> {
    throw new Error('[abc-engine] importRemainderMagnitude not implemented — lands in Task 2 (4.9c).');
  }

  /** @throws Loudly — lands in Task 2. */
  async importAssignRemainder(_sessionId: string, _categoryId: string | null): Promise<void> {
    throw new Error('[abc-engine] importAssignRemainder not implemented — lands in Task 2 (4.9c).');
  }

  /** @throws Loudly — lands in Task 2. */
  async importTypicality(_sessionId: string, _opts?: { virtual?: boolean; draft?: import('../../client/dto').ConditionDTO[] }): Promise<import('../../client/dto').TypicalityResultDTO> {
    throw new Error('[abc-engine] importTypicality not implemented — lands in Task 2 (4.9c).');
  }

  /** Drop any session dump (importAbort teardown) — sync no-op until Task 2. */
  dropDump(_sessionId: string): void {
    // no-op — dump storage lands in Task 2.
  }

  // ── sandbox helpers ──────────────────────────────────────────────────────────

  /** The full `id → Category` index (incl. archived) — the sandbox category seam. */
  private async buildCategoriesById(): Promise<Map<string, Category>> {
    const byId = new Map<string, Category>();
    for (const c of await this.categoriesService.list({ includeArchived: true })) {
      if (c.id !== undefined) byId.set(c.id, c);
    }
    return byId;
  }

  /**
   * Builds the load-once {@link RuleSandboxDeps} for a session: the session rows,
   * the live tree (reload()), and the period-scoped override map + category index
   * (the SAME `distinctPeriods` + `loadOverrideMap` autoCategorize uses, so an
   * override pins a row identically under both the current and the virtual tree).
   */
  private async buildSandboxDeps(sessionId: string): Promise<RuleSandboxDeps> {
    const rows = await this.getSessionRows(sessionId);
    const currentTree = await this.rulePersistence.reload();
    const periods = distinctPeriods(rows);
    const { overrideMap, categoriesById } = await loadOverrideMap(
      this.footprintDao,
      this.categoriesService,
      periods,
    );
    return {
      importRows: rows,
      overrideMap,
      categoriesById,
      currentTree,
      persistence: this.rulePersistence,
    };
  }

  /**
   * Lifts a wire {@link EditActionDTO} to an engine {@link EditAction}: the JSON-
   * safe fields are rehydrated (`categoryId` → `Category` via the index,
   * `ConditionDTO[]` → `Rule[]` via {@link conditionsToRules}, `appendEnd`
   * conditions → a {@link ComplexRuleImpl}).
   *
   * REORDER PIN: `EditActionDTO.reorder.order` carries complexRule IDS in their
   * new eval order, and the engine's `applyActionToTree` reorder branch ALSO
   * keys its rank map on `rule.id` (NOT array indices) — so `order` passes
   * through verbatim, no index translation needed.
   */
  private toEditAction(dto: EditActionDTO, categoriesById: Map<string, Category>): EditAction {
    switch (dto.kind) {
      case 'reorder':
        return { kind: 'reorder', order: dto.order }; // ruleIds in new order (pin)
      case 'delete':
        return { kind: 'delete', ruleId: dto.ruleId };
      case 'editConditions':
        return {
          kind: 'editConditions',
          ruleId: dto.ruleId,
          before: this.conditionsToRules(dto.before),
          after: this.conditionsToRules(dto.after),
        };
      case 'categoryOnly': {
        const category = categoriesById.get(dto.categoryId);
        if (!category) {
          throw new TypeError(`[abc-engine] categoryOnly: unknown categoryId '${dto.categoryId}'`);
        }
        return { kind: 'categoryOnly', ruleId: dto.ruleId, category };
      }
      case 'appendEnd': {
        const category = categoriesById.get(dto.categoryId);
        if (!category) {
          throw new TypeError(`[abc-engine] appendEnd: unknown categoryId '${dto.categoryId}'`);
        }
        return {
          kind: 'appendEnd',
          rule: new ComplexRuleImpl(this.conditionsToRules(dto.conditions), category),
        };
      }
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * Resolves the row's manual override (L1 in-session pick OR L2 persisted
   * override via the 4.4.1 triplet map). Returns `{ categoryId }` when the row
   * is manually resolved, else null.
   */
  private async resolveManual(
    row: ImportStatementStage3Row,
  ): Promise<{ categoryId: string } | null> {
    // L1 — in-session manual pick.
    if (row.isManuallySetCategory && row.category?.id) {
      return { categoryId: row.category.id };
    }
    // L2 — persisted override (the triplet-keyed manual footprint). Loaded over
    // the row's own period only.
    const period = {
      year: row.date.getUTCFullYear(),
      month: row.date.getUTCMonth() + 1,
    };
    const { overrideMap } = await loadOverrideMap(
      this.footprintDao,
      this.categoriesService,
      [period],
    );
    // overrideMap is keyed `${hash}|${year}|${month}` → categoryId (a string).
    const overriddenCategoryId = overrideMap.get(overrideKeyForRow(row));
    return overriddenCategoryId ? { categoryId: overriddenCategoryId } : null;
  }
}

// ── pure helpers ──────────────────────────────────────────────────────────────

/**
 * A single debugger pass: categorize EVERY row and read each row's winning
 * complexRule id (the first-match winner) from the path. Rows with no winner
 * (or a manual category) map to null.
 */
function winningRuleIds(
  tree: DecisionTree,
  rows: ImportStatementStage3Row[],
): Map<number, number | null> {
  const result = new Map<number, number | null>();
  for (const row of rows) {
    const debug = new DecisionTreeDebuggerImpl();
    const category = tree.categorizeRow(row, debug);
    if (category === null) {
      result.set(row.rowIndex, null);
      continue;
    }
    const path = debug.getDecisionTreePath(row);
    const winner = path?.complexRuleResults.find((ev) => ev.result);
    result.set(row.rowIndex, winner?.complexRule.id ?? null);
  }
  return result;
}

/**
 * Maps a stage3 row + its resolved category to the wire DTO.
 *
 * `previousCategoryId` is the sandbox overlay's old→new seam (4.9b): set ONLY for
 * a CHANGED row under an engaged sandbox (`undefined` otherwise, so the field is
 * absent on the wire for un-overlaid rows). `atypical` remains a 4.9c seam.
 */
function toCategorizedRowDTO(
  row: ImportStatementStage3Row,
  categoryId: string | null,
  isManual: 0 | 1,
  ruleId: number | null,
  previousCategoryId?: string | null,
): CategorizedRowDTO {
  const dto: { -readonly [K in keyof CategorizedRowDTO]?: CategorizedRowDTO[K] } = {
    rowIndex: row.rowIndex,
    date: row.date instanceof Date ? row.date.toISOString() : String(row.date),
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    counterparty: row.counterparty,
    account: row.account,
    bankCategory: row.bankCategory,
    mcc: row.mcc,
    categoryId,
    isManual,
    ruleId,
  };
  // Set the sandbox-overlay field ONLY when present (absent on the wire otherwise).
  if (previousCategoryId !== undefined) {
    dto.previousCategoryId = previousCategoryId;
  }
  return dto as CategorizedRowDTO;
}

/** Counts the distinct non-null values of a field across the rows. */
function distinctCount(
  rows: ImportStatementStage3Row[],
  field: keyof ImportStatementStage3Row,
): number {
  const seen = new Set<string>();
  for (const row of rows) {
    const raw = row[field];
    if (raw === null || raw === undefined) continue;
    seen.add(String(raw));
  }
  return seen.size;
}

/** The distinct non-null values of a categorical field across the rows. */
function distinctOptions(
  rows: ImportStatementStage3Row[],
  field: keyof ImportStatementStage3Row,
): { value: string; label: string }[] {
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const row of rows) {
    const raw = row[field];
    if (raw === null || raw === undefined) continue;
    const value = String(raw);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({ value, label: value });
  }
  return options;
}

/**
 * The per-condition met-state for a complexRule's why entry. When the rule was
 * evaluated, each Rule's individual result is read from the debugger's
 * ruleResults (positionally aligned to the complexRule's rules). When the rule
 * was NOT evaluated (neutral), every met-state is null (not evaluated).
 */
function whyConditions(
  complexRule: ComplexRule,
  ruleResults:
    | ReadonlyArray<{ rule: Rule; result: boolean }>
    | undefined,
): WhyRuleDTO['conditions'] {
  const resultByRule = new Map<Rule, boolean>();
  if (ruleResults) {
    for (const rr of ruleResults) resultByRule.set(rr.rule, rr.result);
  }
  return complexRule.rules.map((rule) => {
    const dto = ruleToConditionDTO(rule);
    const met = ruleResults ? resultByRule.get(rule) ?? null : null;
    return { field: dto.field, operator: dto.operator, value: dto.value, met };
  });
}

/** Serializes a Rule back to a ConditionDTO (via the persisted RuleDTO shape). */
function ruleToConditionDTO(rule: Rule): ConditionDTO {
  return ruleDtoToConditionDTO(serializeRule(rule));
}

/**
 * Maps a persisted {@link RuleDTO} ({field, operation}) back to the wire
 * {@link ConditionDTO} ({field, operator, value}). The operation's discriminant
 * `type` becomes the operator; the value is extracted per the operation shape.
 * A `currency=equals` rule that PAIRS an amount rule is folded back onto the
 * amount condition by the caller (see {@link ruleListToConditionDTOs}).
 */
function ruleDtoToConditionDTO(dto: RuleDTO): ConditionDTO {
  const op = dto.operation;
  return { field: dto.field, operator: op.type, value: operationValue(op) };
}

/** Extracts the wire `value` from a rule operation per its discriminant. */
function operationValue(op: RuleOperation): unknown {
  switch (op.type) {
    case 'specificDay':
      return op.value;
    case 'dayRange':
      return { start: op.start, end: op.end };
    case 'between':
      return { min: op.min, max: op.max };
    case 'oneOf':
      return op.values;
    case 'matches':
      return op.pattern.source;
    case 'isTrue':
    case 'isFalse':
      return null;
    case 'firstDayOfMonth':
    case 'firstMondayOfMonth':
    case 'firstSaturdayOfMonth':
    case 'firstSundayOfMonth':
    case 'lastDayOfMonth':
    case 'lastMondayOfMonth':
    case 'lastSaturdayOfMonth':
    case 'lastSundayOfMonth':
      return null;
    default:
      // equals / notEquals / contains / … all carry `.value`.
      return (op as { value: unknown }).value;
  }
}

// ── ConditionDTO → operation builders (the field→operation half of dispatch) ──

/** Builds a DateOperation from a date ConditionDTO. */
function toDateOperation(dto: ConditionDTO): DateOperation {
  switch (dto.operator) {
    case 'specificDay':
      return { type: 'specificDay', value: Number(dto.value) };
    case 'dayRange': {
      const v = dto.value as { start: number; end: number };
      return { type: 'dayRange', start: Number(v.start), end: Number(v.end) };
    }
    case 'firstDayOfMonth':
    case 'firstMondayOfMonth':
    case 'firstSaturdayOfMonth':
    case 'firstSundayOfMonth':
    case 'lastDayOfMonth':
    case 'lastMondayOfMonth':
    case 'lastSaturdayOfMonth':
    case 'lastSundayOfMonth':
      return { type: dto.operator };
    default:
      throw new TypeError(
        `[abc-engine] conditionsToRules: unsupported date operator '${dto.operator}'.`,
      );
  }
}

/** Builds a NumberOperation (amount) from a ConditionDTO. */
function toNumberOperation(dto: ConditionDTO): NumberOperation {
  switch (dto.operator) {
    case 'equals':
    case 'notEquals':
    case 'greaterThan':
    case 'lessThan':
    case 'greaterThanOrEqual':
    case 'lessThanOrEqual':
      return { type: dto.operator, value: Number(dto.value) };
    case 'between': {
      const v = dto.value as { min: number; max: number };
      return { type: 'between', min: Number(v.min), max: Number(v.max) };
    }
    default:
      throw new TypeError(
        `[abc-engine] conditionsToRules: unsupported amount operator '${dto.operator}'.`,
      );
  }
}

/** Builds a StringOperation from a text-field ConditionDTO. */
function toStringOperation(dto: ConditionDTO): StringOperation {
  switch (dto.operator) {
    case 'equals':
    case 'notEquals':
    case 'contains':
    case 'notContains':
    case 'startsWith':
    case 'endsWith':
      return { type: dto.operator, value: String(dto.value) };
    case 'matches':
      return { type: 'matches', pattern: new RegExp(String(dto.value)) };
    default:
      throw new TypeError(
        `[abc-engine] conditionsToRules: unsupported string operator '${dto.operator}'.`,
      );
  }
}

/** Builds a StringMatchOperation (mcc/currency/bankCategory) from a ConditionDTO. */
function toStringMatchOperation(dto: ConditionDTO): StringMatchOperation {
  switch (dto.operator) {
    case 'equals':
    case 'notEquals':
      return { type: dto.operator, value: String(dto.value) };
    case 'oneOf':
      return { type: 'oneOf', values: (dto.value as unknown[]).map((v) => String(v)) };
    default:
      throw new TypeError(
        `[abc-engine] conditionsToRules: unsupported categorical operator '${dto.operator}'.`,
      );
  }
}

/** Builds a BooleanOperation from a boolean-field ConditionDTO. */
function toBooleanOperation(dto: ConditionDTO): BooleanOperation {
  switch (dto.operator) {
    case 'isTrue':
    case 'isFalse':
      return { type: dto.operator };
    default:
      throw new TypeError(
        `[abc-engine] conditionsToRules: unsupported boolean operator '${dto.operator}'.`,
      );
  }
}
