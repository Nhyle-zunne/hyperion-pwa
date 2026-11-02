import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const fixture = process.env.HYPERION_BROWSER_FIXTURE === 'recovery' ? 'recovery-browser' : process.env.HYPERION_BROWSER_FIXTURE === 'quickscan' ? 'quickscan-browser' : process.env.HYPERION_BROWSER_FIXTURE === 'session' ? 'session-browser' : 'keyword-browser'

// Isolated browser fixture using the real editor and encrypted storage. Run from repository root.
export default defineConfig({
  plugins: [{
    name: 'quickscan-synthetic-bank',
    enforce: 'pre',
    resolveId(source, importer) {
      if (fixture === 'recovery-browser' && /(?:\/lib\/|^\.\/)supabase(?:\.ts)?$/.test(source) && !importer?.endsWith('recovery-supabase-fixture.ts')) return fileURLToPath(new URL('./recovery-supabase-fixture.ts', import.meta.url))
      if (fixture === 'recovery-browser' && /\/lib\/questionBank(?:\.ts)?$/.test(source) && !importer?.endsWith('recovery-bank-fixture.ts')) return fileURLToPath(new URL('./recovery-bank-fixture.ts', import.meta.url))
      if (fixture === 'quickscan-browser' && /\/lib\/questionBank(?:\.ts)?$/.test(source) && !importer?.endsWith('quickscan-bank-fixture.ts')) {
        return fileURLToPath(new URL('./quickscan-bank-fixture.ts', import.meta.url))
      }
    }
  }, react(), VitePWA({
    registerType: 'autoUpdate',
    workbox: { navigateFallback: `scripts/tests/${fixture}.html`, globPatterns: ['**/*.{js,css,html}'] }
  })],
  build: {
    outDir: process.env.HYPERION_BROWSER_TEST_OUTPUT || '/tmp/hyperion-keyword-browser',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL(`./${fixture}.html`, import.meta.url)) }
  }
})
