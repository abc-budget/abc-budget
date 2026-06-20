import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.spec.{ts,tsx}'],
    // jsdom-undici realm bridge for the data router (see vitest.setup.ts)
    setupFiles: ['./vitest.setup.ts'],
  },
});
