/**
 * Vitest per-file setup — heavy-dep warm-up, worker side (Story 2.5, QA FINDING-1).
 *
 * Complements vitest-global-setup.ts: globalSetup warms the SHARED
 * transform/dep-optimization cache in the runner process; this file warms each
 * worker's own module registry. Top-level await → the cost lands in setup
 * (hookTimeout budget, warm after the first file), never inside a test's
 * 5s testTimeout. Together they make the cold-cache path deterministic.
 */
await import('luxon');
