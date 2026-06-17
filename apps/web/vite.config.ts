import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ABC Budget',
        short_name: 'ABC Budget',
        description: 'Local-first personal budgeting',
        theme_color: '#0d7377',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      // ttf: vendored ALTUS brand fonts must work offline (~1MB precache accepted;
      // woff2-subset pass is the EP-9.1 carry-forward).
      // csv: the bundled sample statement (2.7 — FEAT-001 path 2 must work offline).
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,ttf,woff2,csv}'] },
    }),
  ],
  // The engine worker entry uses dynamic import (lazy luxon/xlsx — the 2.2
  // discipline); classic-script workers cannot code-split, so the worker
  // bundle must be ES modules.
  worker: { format: 'es' },
  build: {
    // .vite/manifest.json — consumed by build-checks/verify-build.mjs to assert
    // the luxon/xlsx lazy-chunk + precache discipline (2.6 build check).
    manifest: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)),
        qaHarness: fileURLToPath(new URL('./qa-harness.html', import.meta.url)),
        // DEV-only 390px live-view of the engaged-sandbox S3c layout (4.9b Task 8).
        s3cSandboxHarness: fileURLToPath(new URL('./s3c-sandbox-harness.html', import.meta.url)),
      },
    },
  },
});
