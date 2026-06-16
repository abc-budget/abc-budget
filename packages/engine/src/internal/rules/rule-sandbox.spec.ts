/**
 * RuleSandboxSession spec — Story 4.5, Task 2 (FEAT-029).
 * @module internal/rules/rule-sandbox.spec
 * @internal
 *
 * The 5 proofs of the headless rule-tree sandbox:
 *   1. trigger table — `classify` is O(1) and DIFF-INDEPENDENT (a delete that
 *      changes 0 rows is STILL 'sandbox').
 *   2. diff correct + ZERO DB — `computeDiff` returns exactly the changed rows
 *      and the injected persistence's read-ish methods are NEVER called across
 *      repeated `classify()`/`computeDiff()`.
 *   3. apply preserves ids / cancel reverts — `apply()` calls
 *      `saveDecisionTree(virtualTree)` (ids preserved on the rebuilt rules) and
 *      promotes virtual→current; `cancel()` drops the virtual, current unchanged.
 *   4. same-conditions-any-order = no sandbox — `editConditions` whose before/
 *      after are an order-only reshuffle returns 'live' AND does NOT engage.
 *   5. override-ops NEVER in the diff — an L1/L2-resolved row that a rule would
 *      ALSO match never appears in the diff of a delete of that rule.
 *   + once engaged, an `appendEnd` (normally 'live') ACCUMULATES into the
 *     virtual tree (lands in `getVirtualTree()`, not persisted immediately).
 *
 * `classify` + `computeDiff` are PURE-SYNC (no await); the persistence service
 * is DI'd as a `vi.fn()` fake so the zero-DB proof can spy every method.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  RuleSandboxSession,
  type RuleSandboxDeps,
} from './rule-sandbox';
import { DecisionTreeBuilder, ComplexRuleBuilder } from './decision-tree-builder';
import { createDescriptionRule, createAmountCondition } from './rule-factories';
import { RulePersistenceService } from './rule-persistence-service';
import type { ComplexRule, DecisionTree } from './decision-tree';
import type { Category } from '../categories/types';
import type { Rule } from './rule';
import type { ImportStatementStage3Row } from '../importStatement/stage3/types';

// ── builders ────────────────────────────────────────────────────────────────

/** A live Category with the minimal shape the resolver reads. */
function cat(id: string, name = id): Category {
  return { id, name, isArchived: false, currency: 'UAH' } as Category;
}

/** A minimal stage-3 row carrying the fields the resolver + rules read. */
function row(over: Partial<ImportStatementStage3Row>): ImportStatementStage3Row {
  return {
    rowIndex: 0,
    hash: `hash-${Math.random()}`,
    amount: 0,
    currency: 'UAH',
    description: null,
    counterparty: null,
    category: null,
    isManuallySetCategory: false,
    ...over,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** A complex rule: description equals `value` → `category`, carrying `id`. */
function descRule(id: number, value: string, category: Category): ComplexRule {
  return new ComplexRuleBuilder()
    .withId(id)
    .withCategory(category)
    .withRule(createDescriptionRule({ type: 'equals', value }))
    .build();
}

/** Builds a tree (name 'Decision Tree') over the given complex rules. */
function treeOf(...rules: ComplexRule[]): DecisionTree {
  const builder = new DecisionTreeBuilder().withName('Decision Tree');
  for (const r of rules) {
    builder.withComplexRule(r);
  }
  return builder.build();
}

/**
 * A spy persistence service: a real `RulePersistenceService` instance whose
 * every method is replaced with a `vi.fn()`. This lets the zero-DB proof assert
 * that NO method (read or write) is touched during classify/computeDiff, while
 * still being assignable as a `RulePersistenceService`.
 */
function spyPersistence(): RulePersistenceService {
  // Construct without real deps — the prototype methods are all stubbed below.
  const svc = Object.create(
    RulePersistenceService.prototype
  ) as RulePersistenceService;
  const stub = svc as unknown as Record<string, unknown>;
  stub.saveDecisionTree = vi.fn().mockResolvedValue(undefined);
  stub.create = vi.fn().mockResolvedValue({ id: 999 });
  stub.update = vi.fn().mockResolvedValue(undefined);
  stub.reload = vi.fn().mockResolvedValue(treeOf());
  stub.reorder = vi.fn().mockResolvedValue(undefined);
  return svc;
}

/** Base deps with an empty override map + a category index over the given cats. */
function depsFor(
  tree: DecisionTree,
  importRows: ImportStatementStage3Row[],
  cats: Category[],
  persistence: RulePersistenceService
): RuleSandboxDeps {
  const categoriesById = new Map<string, Category>();
  for (const c of cats) {
    categoriesById.set(c.id!, c);
  }
  return {
    importRows,
    overrideMap: new Map<string, string>(),
    categoriesById,
    currentTree: tree,
    persistence,
  };
}

// ── PROOF 1: trigger table (O(1), diff-independent) ──────────────────────────

describe('RuleSandboxSession.classify — the trigger table', () => {
  it('maps every EditAction kind to the right lane, diff-independent', () => {
    const coffee = cat('c-coffee');
    const tea = cat('c-tea');
    const tree = treeOf(descRule(1, 'COFFEE', coffee), descRule(2, 'TEA', tea));
    // NO import rows match the rules → the diff is empty for every action.
    const importRows = [row({ rowIndex: 0, description: 'UNRELATED' })];
    const session = new RuleSandboxSession(
      depsFor(tree, importRows, [coffee, tea], spyPersistence())
    );

    const before: Rule[] = [createDescriptionRule({ type: 'equals', value: 'COFFEE' })];
    const after: Rule[] = [createDescriptionRule({ type: 'equals', value: 'LATTE' })];
    const sameAfter: Rule[] = [createDescriptionRule({ type: 'equals', value: 'COFFEE' })];

    expect(session.classify({ kind: 'reorder', order: [2, 1] })).toBe('sandbox');
    // A delete that changes ZERO rows is STILL 'sandbox' (diff-independent).
    expect(session.classify({ kind: 'delete', ruleId: 1 })).toBe('sandbox');
    expect(
      session.classify({ kind: 'categoryOnly', ruleId: 1, category: tea })
    ).toBe('live');
    expect(
      session.classify({ kind: 'appendEnd', rule: descRule(3, 'X', coffee) })
    ).toBe('live');
    expect(
      session.classify({ kind: 'editConditions', ruleId: 1, before, after })
    ).toBe('sandbox');
    // Same conditions (re-save / reorder) → no-op → 'live'.
    expect(
      session.classify({ kind: 'editConditions', ruleId: 1, before, after: sameAfter })
    ).toBe('live');
  });
});

// ── PROOF 2: diff correct + ZERO DB ──────────────────────────────────────────

describe('RuleSandboxSession.computeDiff — correctness + zero DB', () => {
  it('returns exactly the K changed rows and never touches the persistence', () => {
    const coffee = cat('c-coffee');
    const tea = cat('c-tea');
    const tree = treeOf(descRule(1, 'COFFEE', coffee), descRule(2, 'TEA', tea));
    // rows 0,1 → COFFEE; row 2 → TEA; row 3 → no match (null).
    const importRows = [
      row({ rowIndex: 0, description: 'COFFEE' }),
      row({ rowIndex: 1, description: 'COFFEE' }),
      row({ rowIndex: 2, description: 'TEA' }),
      row({ rowIndex: 3, description: 'UNRELATED' }),
    ];
    const persistence = spyPersistence();
    const session = new RuleSandboxSession(
      depsFor(tree, importRows, [coffee, tea], persistence)
    );

    // Not engaged → empty diff.
    expect(session.computeDiff()).toEqual([]);

    // Engage a sandbox delete of rule 1 (COFFEE) → rows 0,1 drop COFFEE → null.
    expect(session.classify({ kind: 'delete', ruleId: 1 })).toBe('sandbox');
    // submit the delete (sandbox path engages the virtual tree).
    return session
      .submit({ kind: 'delete', ruleId: 1 })
      .then((decision) => {
        expect(decision).toBe('sandbox');

        const diff = session.computeDiff();
        // Exactly K=2 rows changed: rows 0 and 1, COFFEE → null.
        expect(diff).toHaveLength(2);
        expect(diff).toEqual(
          expect.arrayContaining([
            { rowIndex: 0, oldCategoryId: 'c-coffee', newCategoryId: null },
            { rowIndex: 1, oldCategoryId: 'c-coffee', newCategoryId: null },
          ])
        );

        // Repeated classify/computeDiff — still zero DB.
        session.classify({ kind: 'reorder', order: [2] });
        session.computeDiff();
        session.computeDiff();

        // ZERO persistence calls across all reads (no DAO/read method touched).
        const p = persistence as unknown as Record<string, ReturnType<typeof vi.fn>>;
        expect(p.saveDecisionTree).not.toHaveBeenCalled();
        expect(p.create).not.toHaveBeenCalled();
        expect(p.update).not.toHaveBeenCalled();
        expect(p.reload).not.toHaveBeenCalled();
        expect(p.reorder).not.toHaveBeenCalled();
      });
  });
});

// ── PROOF 3: apply preserves ids / cancel reverts ────────────────────────────

describe('RuleSandboxSession.apply / cancel', () => {
  it('apply() persists the virtual tree (ids preserved) and promotes it', async () => {
    const coffee = cat('c-coffee');
    const tea = cat('c-tea');
    const tree = treeOf(
      descRule(1, 'COFFEE', coffee),
      descRule(2, 'TEA', tea),
      descRule(3, 'CASH', coffee)
    );
    const importRows = [row({ rowIndex: 0, description: 'COFFEE' })];
    const persistence = spyPersistence();
    const session = new RuleSandboxSession(
      depsFor(tree, importRows, [coffee, tea], persistence)
    );

    // Sandbox a reorder + an editConditions.
    await session.submit({ kind: 'reorder', order: [3, 2, 1] });
    await session.submit({
      kind: 'editConditions',
      ruleId: 2,
      before: [createDescriptionRule({ type: 'equals', value: 'TEA' })],
      after: [createDescriptionRule({ type: 'equals', value: 'CHAI' })],
    });
    expect(session.engaged).toBe(true);

    const virtual = session.getVirtualTree();
    expect(virtual).not.toBeNull();

    await session.apply();

    const p = persistence as unknown as Record<string, ReturnType<typeof vi.fn>>;
    // saveDecisionTree was called with the virtual tree exactly.
    expect(p.saveDecisionTree).toHaveBeenCalledTimes(1);
    expect(p.saveDecisionTree).toHaveBeenCalledWith(virtual);

    // Every complexRule id is preserved through the rebuild (still {1,2,3}).
    const persistedTree = p.saveDecisionTree.mock.calls[0][0] as DecisionTree;
    const ids = persistedTree.complexRules.map((r) => r.id).sort();
    expect(ids).toEqual([1, 2, 3]);
    // The reorder placed [3,2,1] order.
    expect(persistedTree.complexRules.map((r) => r.id)).toEqual([3, 2, 1]);

    // current is now the virtual; no longer engaged.
    expect(session.getCurrentTree()).toBe(virtual);
    expect(session.engaged).toBe(false);
  });

  it('apply() throws when nothing is engaged', async () => {
    const coffee = cat('c-coffee');
    const session = new RuleSandboxSession(
      depsFor(treeOf(descRule(1, 'COFFEE', coffee)), [], [coffee], spyPersistence())
    );
    await expect(session.apply()).rejects.toThrow();
  });

  it('cancel() drops the virtual tree, current unchanged, diff empty', async () => {
    const coffee = cat('c-coffee');
    const tea = cat('c-tea');
    const tree = treeOf(descRule(1, 'COFFEE', coffee), descRule(2, 'TEA', tea));
    const importRows = [row({ rowIndex: 0, description: 'COFFEE' })];
    const session = new RuleSandboxSession(
      depsFor(tree, importRows, [coffee, tea], spyPersistence())
    );

    await session.submit({ kind: 'delete', ruleId: 1 });
    expect(session.engaged).toBe(true);
    expect(session.computeDiff().length).toBeGreaterThan(0);

    session.cancel();

    expect(session.engaged).toBe(false);
    expect(session.getCurrentTree()).toBe(tree); // unchanged reference
    expect(session.computeDiff()).toEqual([]);
  });
});

// ── PROOF 4: same-conditions-any-order = no sandbox ──────────────────────────

describe('RuleSandboxSession.submit — editConditions no-op', () => {
  it('a same-set reorder of conditions returns live and does NOT engage', async () => {
    const coffee = cat('c-coffee');
    const a = createDescriptionRule({ type: 'equals', value: 'COFFEE' });
    const b = createAmountCondition({ type: 'greaterThan', value: 10 }, 'UAH')[0];
    const ruleWithBoth = new ComplexRuleBuilder()
      .withId(1)
      .withCategory(coffee)
      .withRules([a, b])
      .build();
    const tree = treeOf(ruleWithBoth);
    const session = new RuleSandboxSession(
      depsFor(tree, [], [coffee], spyPersistence())
    );

    // before [A,B], after [B,A] — same set, different order → no-op.
    const decision = await session.submit({
      kind: 'editConditions',
      ruleId: 1,
      before: [a, b],
      after: [b, a],
    });

    expect(decision).toBe('live');
    expect(session.engaged).toBe(false);
  });
});

// ── PROOF 5: override-ops NEVER in the diff ──────────────────────────────────

describe('RuleSandboxSession.computeDiff — override independence', () => {
  it('an L2-overridden row that a rule would match is NOT in a delete diff', () => {
    const coffee = cat('c-coffee');
    const override = cat('c-override');
    // A rule that WOULD match the row's description → coffee.
    const tree = treeOf(descRule(1, 'COFFEE-SHOP', coffee));
    const overriddenRow = row({
      rowIndex: 0,
      hash: 'h-overridden',
      description: 'COFFEE-SHOP',
    });
    const persistence = spyPersistence();
    const deps = depsFor(tree, [overriddenRow], [coffee, override], persistence);
    // L2: hash → override category — beats the rule under BOTH trees.
    deps.overrideMap.set('h-overridden', 'c-override');

    const session = new RuleSandboxSession(deps);
    return session.submit({ kind: 'delete', ruleId: 1 }).then(() => {
      const diff = session.computeDiff();
      // The overridden row resolves to 'c-override' under BOTH trees → not in diff.
      expect(diff.find((d) => d.rowIndex === 0)).toBeUndefined();
      expect(diff).toEqual([]);
    });
  });

  it('an L1 (in-session manual) row that a rule would match is NOT in a delete diff', () => {
    const coffee = cat('c-coffee');
    const manual = cat('c-manual');
    const tree = treeOf(descRule(1, 'COFFEE-SHOP', coffee));
    const manualRow = row({
      rowIndex: 0,
      description: 'COFFEE-SHOP',
      isManuallySetCategory: true,
      category: manual,
    });
    const session = new RuleSandboxSession(
      depsFor(tree, [manualRow], [coffee, manual], spyPersistence())
    );
    return session.submit({ kind: 'delete', ruleId: 1 }).then(() => {
      expect(session.computeDiff()).toEqual([]);
    });
  });
});

// ── EXTRA: engaged appendEnd ACCUMULATES into the virtual tree ────────────────

describe('RuleSandboxSession.submit — engaged accumulation', () => {
  it('once engaged, an appendEnd accumulates into virtual (not persisted)', async () => {
    const coffee = cat('c-coffee');
    const tea = cat('c-tea');
    const tree = treeOf(descRule(1, 'COFFEE', coffee));
    const persistence = spyPersistence();
    const session = new RuleSandboxSession(
      depsFor(tree, [], [coffee, tea], persistence)
    );

    // Engage via a sandbox delete first.
    await session.submit({ kind: 'reorder', order: [1] });
    // Reorder of a single rule is sandbox lane and engages the virtual tree.
    expect(session.engaged).toBe(true);

    // Now an appendEnd (normally 'live') ACCUMULATES into the virtual tree.
    const appended = descRule(2, 'TEA', tea);
    const decision = await session.submit({ kind: 'appendEnd', rule: appended });
    // The action's own lane is 'live', but engaged → accumulates, no persist.
    expect(decision).toBe('live');

    const virtual = session.getVirtualTree();
    expect(virtual).not.toBeNull();
    expect(virtual!.complexRules.map((r) => r.id)).toContain(2);

    const p = persistence as unknown as Record<string, ReturnType<typeof vi.fn>>;
    // The append did NOT persist immediately (it accumulated).
    expect(p.create).not.toHaveBeenCalled();
    expect(p.saveDecisionTree).not.toHaveBeenCalled();
  });

  it('a live categoryOnly while NOT engaged persists immediately via update', async () => {
    const coffee = cat('c-coffee');
    const tea = cat('c-tea');
    const tree = treeOf(descRule(1, 'COFFEE', coffee));
    const persistence = spyPersistence();
    const session = new RuleSandboxSession(
      depsFor(tree, [], [coffee, tea], persistence)
    );

    const decision = await session.submit({
      kind: 'categoryOnly',
      ruleId: 1,
      category: tea,
    });
    expect(decision).toBe('live');
    expect(session.engaged).toBe(false);

    const p = persistence as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(p.update).toHaveBeenCalledTimes(1);
    // The updated complexRule keeps id 1 with the new category.
    const updated = p.update.mock.calls[0][0] as ComplexRule;
    expect(updated.id).toBe(1);
    expect(updated.category.id).toBe('c-tea');
    // current tree advanced to reflect the live write.
    expect(session.getCurrentTree().complexRules[0].category.id).toBe('c-tea');
  });

  it('a live appendEnd while NOT engaged persists immediately via create', async () => {
    const coffee = cat('c-coffee');
    const tea = cat('c-tea');
    const tree = treeOf(descRule(1, 'COFFEE', coffee));
    const persistence = spyPersistence();
    const session = new RuleSandboxSession(
      depsFor(tree, [], [coffee, tea], persistence)
    );

    const appended = descRule(2, 'TEA', tea);
    const decision = await session.submit({ kind: 'appendEnd', rule: appended });
    expect(decision).toBe('live');
    expect(session.engaged).toBe(false);

    const p = persistence as unknown as Record<string, ReturnType<typeof vi.fn>>;
    expect(p.create).toHaveBeenCalledTimes(1);
    expect(p.create).toHaveBeenCalledWith(appended);
    // current tree advanced to include the appended rule.
    expect(session.getCurrentTree().complexRules.map((r) => r.id)).toEqual([1, 2]);
  });
});
