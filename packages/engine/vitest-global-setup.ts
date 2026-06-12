/**
 * Vitest global setup — heavy-dep warm-up (Story 2.5, QA FINDING-1).
 *
 * The engine lazy-loads luxon (`import('luxon')` in the date format-detector,
 * 2.2 ENT-001 discipline). On a COLD transform/dep-optimization cache the FIRST
 * dynamic import pays the whole optimization cost inside whichever test happens
 * to hit it first — on cold CI runners that blew the 5s default testTimeout
 * (recall.spec auto-detect path; 3/3 reproduced by QA, green warm).
 *
 * Warming the import HERE moves the cold cost outside every test/hook budget,
 * making the cold path deterministic — preferred over raising testTimeout,
 * which hides slowness creep and gets outgrown again (PM direction on record).
 */
export default async function globalSetup(): Promise<void> {
  await import('luxon');
}
