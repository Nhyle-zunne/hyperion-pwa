import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const fixture = process.env.HYPERION_BROWSER_FIXTURE === 'session' ? 'session-browser' : 'keyword-browser'

// Isolated browser fixture using the real editor and encrypted storage. Run from repository root.
export default defineConfig({
  plugins: [react(), VitePWA({
    registerType: 'autoUpdate',
    workbox: { navigateFallback: `scripts/tests/${fixture}.html`, globPatterns: ['**/*.{js,css,html}'] }
  })],
  build: {
    outDir: process.env.HYPERION_BROWSER_TEST_OUTPUT || '/tmp/hyperion-keyword-browser',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL(`./${fixture}.html`, import.meta.url)) }
  }
})
