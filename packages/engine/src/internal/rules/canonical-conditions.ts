/**
 * Order-INDEPENDENT condition equality — the sandbox no-op detector
 * (Story 4.5, Task 1 — FEAT-029).
 * @module internal/rules/canonical-conditions
 * @internal
 *
 * The conditions of a {@link ComplexRule} are AND-combined, so their ORDER is
 * NOT semantic: `[description, amount]` matches exactly the same rows as
 * `[amount, description]`. To detect a sandbox EDIT that is really a no-op
 * (the user merely reordered the conditions, or re-saved an identical set),
 * we reduce a condition list to a canonical, order-independent signature:
 * each condition becomes a stable key, the keys are SORTED, then joined.
 * Two lists are equal iff their signatures are byte-identical.
 *
 * This is DELIBERATELY DISTINCT from 4.3b's {@link rulesContentMatch} in
 * `rule-persistence-service.ts`, which compares POSITIONALLY
 * (`a.rules[i] vs b.rules[i]` by index). That positional match is correct for
 * its job — store-delta id reuse, where a stable positional shape lets an
 * existing row keep its id — but it would falsely flag a pure condition
 * REORDER as a content change. The two helpers answer different questions, so
 * both are kept: positional for persistence-delta id reuse, this one for the
 * sandbox no-op check. We do NOT modify `rulesContentMatch`.
 */

import type { RuleOperation } from './operations';
import type { Rule } from './rule';

/**
 * Serializes an operation into a key-order-STABLE string.
 *
 * Object keys are sorted before serialization so `{type:'equals',value:'x'}`
 * and `{value:'x',type:'equals'}` yield the SAME string. A `RegExp` value
 * (the `matches` operation's `pattern`) does not JSON-stringify usefully
 * (`JSON.stringify(/x/i)` is `"{}"`), so it is serialized as its `source` +
 * `flags` — making `/x/i` distinct from `/x/g` and from `/y/i`.
 *
 * Handles every operation shape: bare (`{type}` only), `value`, `min`/`max`,
 * `start`/`end`, `values[]`, and `pattern: RegExp`.
 */
function stableSerialize(operation: RuleOperation): string {
  const entries = Object.entries(operation as Record<string, unknown>)
    .sort(([keyA], [keyB]) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .map(([key, value]) => `${key}=${serializeValue(value)}`);
  return entries.join(',');
}

/** Serializes a single operation property value (RegExp gets source+flags). */
function serializeValue(value: unknown): string {
  if (value instanceof RegExp) {
    return `RegExp(${value.source}/${value.flags})`;
  }
  return JSON.stringify(value);
}

/**
 * Builds a canonical, ORDER-INDEPENDENT signature for a condition list.
 *
 * Each condition becomes a key `${field}|${operation.type}|${stableSerialize}`;
 * the per-condition keys are SORTED ascending and joined with `'\n'` (a
 * separator unlikely to occur inside a key). Reordering the input conditions
 * therefore produces a byte-identical signature.
 *
 * @param rules The conditions of a complex rule (AND-combined)
 * @returns A deterministic signature; equal signatures ⇔ equal condition sets
 */
export function canonicalConditionSignature(rules: readonly Rule[]): string {
  return rules
    .map(
      (rule) =>
        `${rule.field}|${rule.operation.type}|${stableSerialize(rule.operation)}`
    )
    .sort((keyA, keyB) => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0))
    .join('\n');
}

/**
 * Order-independent equality of two condition lists.
 *
 * @returns `true` iff the two lists are the SAME set of conditions, ignoring
 *   order — the sandbox no-op signal.
 */
export function conditionsEqual(
  a: readonly Rule[],
  b: readonly Rule[]
): boolean {
  return canonicalConditionSignature(a) === canonicalConditionSignature(b);
}
