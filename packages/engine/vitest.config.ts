import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 'node' is required by @vitest/web-worker (the worker-hop test); do not switch to jsdom.
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // HC-9: the suite always runs under a hostile negative-offset zone — TZ bugs fail the gate
    // by construction (QA FINDING-1, 2.2). tz-determinism.spec additionally mutates TZ in-test.
    env: { TZ: 'America/New_York' },
  },
});
