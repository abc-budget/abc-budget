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
      workbox: { globPatterns: ['**/*.{js,css,html,svg,png,ico,ttf,woff2}'] },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        gallery: fileURLToPath(new URL('./gallery.html', import.meta.url)),
        qaHarness: fileURLToPath(new URL('./qa-harness.html', import.meta.url)),
      },
    },
  },
});
