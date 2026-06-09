import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 'node' is required by @vitest/web-worker (the worker-hop test); do not switch to jsdom.
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
