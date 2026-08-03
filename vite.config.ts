import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

// NOTE (deploy): Netlify build command MUST be `vite build` (not `tsc -b && vite build`).
// `vite build` uses esbuild and does not type-check, so it won't fail the build on
// TS type errors -- only on syntax errors / broken imports. This mirrors the
// edenvale-vegetation-control setup on purpose (see that app's hard-won notes).
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Edenvale Panel Manager',
        short_name: 'Panel Manager',
        description: 'Locate, report and replace individual PV panels at Edenvale Solar Farm.',
        theme_color: '#0b1220',
        background_color: '#0b1220',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        // App shell + data are cached at runtime via Dexie/IndexedDB (see src/lib/db.ts).
        // Here we only need the static build assets available offline.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
