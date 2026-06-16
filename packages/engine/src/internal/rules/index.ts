/**
 * Internal barrel for the rule grammar (Story 4.1, EP-4 condition grammar).
 * @module internal/rules
 * @internal
 *
 * Re-exports the rule grammar's internal building blocks: the operator unions,
 * the single-rule wrapper, the typed factories, and the ReDoS guard. This is an
 * INTERNAL barrel — it is deliberately NOT wired into the package's public
 * barrel: no rule types may leak across the wire / into the DTO surface.
 */

export * from './operations';
export * from './rule';
export * from './rule-factories';
export * from './safe-regex';
