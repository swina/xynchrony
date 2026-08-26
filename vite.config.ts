import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // WAV audio (public/wav/**) is intentionally NOT precached here --
      // it's fetched on demand and cached in IndexedDB by SampleCache
      // (see src/core/audio/SampleCache.ts and docs/ARCHITECTURE.md).
      // Precaching 80MB+ per bank via the service worker on first load
      // would be a poor tradeoff for an app where a session typically
      // touches a handful of presets out of a thousand-plus.
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}', 'data/banks/manifest.json', 'data/banks/*/bank.json'],
        globIgnores: ['wav/**'],
      },
      manifest: {
        name: 'Xynchrony',
        short_name: 'Xynchrony',
        description: 'Browser-based synthesizer for E-mu EOS/E4B sound banks',
        theme_color: '#faf8f2',
        background_color: '#faf8f2',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
