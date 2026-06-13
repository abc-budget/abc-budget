import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 'node' is required by @vitest/web-worker (the worker-hop test); do not switch to jsdom.
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // HC-9: the suite always runs under a hostile negative-offset zone — TZ bugs fail the gate
    // by construction (QA FINDING-1, 2.2). tz-determinism.spec additionally mutates TZ in-test.
    env: { TZ: 'America/New_York' },
    // Heavy-dep warm-up (2.5 QA FINDING-1): the lazy import('luxon') + the recall
    // date-heuristic module must never pay their cold dep-optimization/transform cost
    // inside a test's budget. globalSetup warms the shared cache; setupFiles warms each
    // worker. Warm-up is the FIRST defense (2.5 PM direction).
    globalSetup: './vitest-global-setup.ts',
    setupFiles: ['./vitest-setup.ts'],
    // Cold-cache ceiling (2.8 QA MAJOR-1 — the 2.5 FINDING-1 class, recurring at
    // 977-test scale where the new worker-spawning defer-commit tests contend with
    // the CPU-heavy recall date-heuristic on a COLD machine). This is a ONE-TIME
    // cold-cost ceiling, NOT a per-test runtime budget — virtually every test runs
    // in <1s; only the first cold worker-spawn handshake + the cold date-heuristic
    // approach it. Production guards are UNCHANGED (the prod worker handshake stays
    // 5s; the prod bundle is service-worker-precached so it never pays this cold cost).
    // QA observed green at 20s on the authoritative cold env.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Run test FILES sequentially (each still isolated in its own fork). 2.8 QA
    // MAJOR-1: the @vitest/web-worker real-worker specs (worker-host, defer-commit)
    // are timing-sensitive — concurrent forks competing for CPU slow a worker's
    // spawn/DB-open enough to race the initial fake-indexeddb upgrade → a flaky
    // unhandled `onblocked` (non-zero exit). Serializing files removes the cross-fork
    // contention that surfaces it; intra-file isolation (factory swap per test) is
    // unchanged. Trade: a slower engine suite for a DETERMINISTIC cold gate. This is
    // test-infra only — production code and timeouts are untouched.
    fileParallelism: false,
  },
});
