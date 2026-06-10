/**
 * The «/» routing predicate (FEAT-030): hasData ? Dashboard : Onboarding.
 *
 * STUB in 1.5 — always false (first-run). EP-3 replaces this with a real engine
 * query once footprints exist (the engine owns the answer; this hook is the seam).
 */
export function useHasData(): boolean {
  return false;
}
