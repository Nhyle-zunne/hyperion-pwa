import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: [
        'favicon.svg',
        'favicon.png',
        'apple-touch-icon.png',
        'pwa-192x192.png',
        'pwa-512x512.png'
      ],
      manifest: {
        name: 'Hyperion – Maritime Licensure Reviewer',
        short_name: 'Hyperion',
        description:
          'Maritime Licensure Reviewer for OIC-NW, GMDSS, Engine and Management tracks',
        theme_color: '#002060',
        background_color: '#002060',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        id: '/',
        categories: ['education', 'productivity'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        // Question banks are delivered by the protected Supabase Edge Function.
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
        // Large question banks – raise limit (default 2 MiB)
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 }
            }
          }
        ]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  build: {
    target: 'esnext',
    sourcemap: false
  }
})
