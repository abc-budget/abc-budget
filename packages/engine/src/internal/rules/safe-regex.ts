/**
 * ReDoS guard for the rule grammar's `matches(RegExp)` operator.
 * @module internal/rules/safe-regex
 * @internal
 *
 * Story 4.1 Task 3 — THREAT REFRAME (per PM ruling): the regex here is
 * USER-AUTHORED, run over the user's OWN data, and the whole engine is LOCAL +
 * single-user + worker-isolated. So this is SELF-INFLICTED UX-ROBUSTNESS — keep
 * the user from hanging their own worker with an accidental catastrophic pattern
 * — and NOT a security defense against an attacker. That framing decides what
 * does the real work:
 *
 *  - The INPUT-LENGTH CAP (`MAX_MATCH_INPUT`) is the PRIMARY mitigation. Bank
 *    description / counterparty fields are short, and capping the matched string
 *    bounds worst-case backtracking regardless of the pattern — it backstops
 *    even a bomb the heuristic below never sees.
 *
 *  - `assertSafeRegex` (the nested-quantifier heuristic) is SECONDARY /
 *    best-effort. It rejects the OBVIOUS exponential shapes at construction time
 *    so the user gets a clear error instead of a mystery hang. It is EXPLICITLY
 *    NOT a complete ReDoS detector: false negatives are acceptable because the
 *    cap above bounds the damage of anything it misses. Do not grow this into an
 *    exhaustive analyzer — that is the cap's job, not this function's.
 *
 * No runtime dependency: the heuristic is hand-rolled over `pattern.source`.
 */

/**
 * The PRIMARY mitigation: the maximum number of characters of input a rule regex
 * is ever run against.
 *
 * Bank description / counterparty fields are short, so 1000 chars is generous
 * headroom for real data while still bounding catastrophic backtracking: even an
 * exponential pattern the heuristic fails to catch can only blow up over the
 * input it sees, and a capped input keeps that blow-up finite. Callers MUST
 * truncate the matched string to this length before running a user regex.
 */
export const MAX_MATCH_INPUT = 1000;

/**
 * Thrown by {@link assertSafeRegex} when a pattern has an obviously catastrophic
 * shape (a nested quantifier). The message names the rejected pattern source so
 * the user can see which rule to fix.
 */
export class UnsafeRegexError extends Error {
  constructor(source: string) {
    super(
      `Unsafe regular expression rejected (nested quantifier): /${source}/`
    );
    this.name = 'UnsafeRegexError';
  }
}

/**
 * Best-effort screen for the OBVIOUS exponential-backtracking shape: a nested
 * quantifier — a quantified group whose body itself contains an unbounded
 * quantifier, e.g. `(a+)+`, `(a*)*`, `(a+)*`, `(.*a){10}`, `(\d+)+`.
 *
 * SECONDARY guard only (see the module header): this is a pragmatic scan over
 * `pattern.source`, NOT an exhaustive ReDoS detector. It will miss other
 * exponential shapes (e.g. alternation overlap like `(a|a)+`); that is by design
 * — `MAX_MATCH_INPUT` is the primary mitigation and backstops those misses.
 *
 * The heuristic: walk the source tracking group spans. When a group CLOSE `)` is
 * immediately followed by a quantifier (`*`, `+`, `?`, `{`), the group is itself
 * quantified; if that group's body contained an unbounded quantifier (`*`, `+`,
 * or `{`), the two stack into a nested quantifier and we reject. Characters
 * escaped with `\` are skipped, and contents of a character class `[...]` are
 * ignored (a quantifier metachar inside a class is a literal, not a quantifier).
 *
 * @param pattern - The user-authored regex to screen.
 * @throws {UnsafeRegexError} If a nested quantifier is detected.
 */
export function assertSafeRegex(pattern: RegExp): void {
  const src = pattern.source;

  // Stack of open groups; each frame records whether an unbounded quantifier has
  // been seen inside that group's body so far.
  const groupStack: Array<{ hasInnerQuantifier: boolean }> = [];
  let inCharClass = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    // Skip an escaped char: the backslash and the char it escapes are literal.
    if (ch === '\\') {
      i++;
      continue;
    }

    // Inside a character class, metacharacters are literal — only `]` matters.
    if (inCharClass) {
      if (ch === ']') {
        inCharClass = false;
      }
      continue;
    }
    if (ch === '[') {
      inCharClass = true;
      continue;
    }

    if (ch === '(') {
      groupStack.push({ hasInnerQuantifier: false });
      continue;
    }

    // An unbounded quantifier in the CURRENT group's body. `?` alone is bounded
    // (0..1) and does not cause exponential backtracking, so it does not arm a
    // group; `*`, `+`, and `{...}` do.
    const isUnboundedQuantifier = ch === '*' || ch === '+' || ch === '{';
    if (isUnboundedQuantifier && groupStack.length > 0) {
      groupStack[groupStack.length - 1].hasInnerQuantifier = true;
    }

    if (ch === ')') {
      const closed = groupStack.pop();
      if (!closed) {
        continue; // unbalanced source; let RegExp construction be the judge
      }
      // Is this group itself quantified? Look at the next significant char.
      const next = src[i + 1];
      const groupIsQuantified =
        next === '*' || next === '+' || next === '?' || next === '{';
      if (groupIsQuantified && closed.hasInnerQuantifier) {
        // Quantifier stacked on a quantifier body → catastrophic shape.
        throw new UnsafeRegexError(src);
      }
    }
  }
}
