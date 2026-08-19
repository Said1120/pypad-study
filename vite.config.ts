import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin'
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'same-origin'
    }
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icons/pypad.svg'],
      manifest: {
        name: 'PyPad 学习台',
        short_name: 'PyPad',
        description: '在 iPad 本地、离线学习与运行 Python',
        lang: 'zh-CN',
        start_url: '/',
        display: 'standalone',
        background_color: '#f4f1ea',
        theme_color: '#3857d6',
        orientation: 'any',
        icons: [
          {
            src: '/icons/pypad.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        clientsClaim: true,
        globPatterns: ['**/*.{js,mjs,css,html,svg,wasm,data,zip,json}'],
        maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        runtimeCaching: [{
          urlPattern: /\/pyodide\/.*\.whl$/,
          handler: 'CacheFirst',
          options: {
            cacheName: 'pypad-python-packages',
            expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [200] }
          }
        }]
      }
    })
  ],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    coverage: {
      reporter: ['text', 'html']
    }
  },
  worker: {
    format: 'es'
  }
})
