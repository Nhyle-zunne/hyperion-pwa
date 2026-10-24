import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ThemeMode = 'dark' | 'light'

interface UIState {
  showPaywall: boolean
  paywallFeature: string
  theme: ThemeMode
  openPaywall: (feature?: string) => void
  closePaywall: () => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
}

function applyTheme(theme: ThemeMode) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', theme)
  // Update browser chrome color
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute('content', theme === 'dark' ? '#0B1220' : '#EEF2F6')
  }
}

export const useUIStore = create<UIState>()(
  persist(
    (set, get) => ({
      showPaywall: false,
      paywallFeature: 'this feature',
      theme: 'dark',
      openPaywall: (feature = 'this feature') =>
        set({ showPaywall: true, paywallFeature: feature }),
      closePaywall: () => set({ showPaywall: false }),
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
      toggleTheme: () => {
        const next: ThemeMode = get().theme === 'dark' ? 'light' : 'dark'
        applyTheme(next)
        set({ theme: next })
      }
    }),
    {
      name: 'hyperion-ui',
      partialize: (s) => ({ theme: s.theme }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme)
        else applyTheme('dark')
      }
    }
  )
)

// Apply before paint if possible (called from main.tsx too)
export function initTheme() {
  try {
    const raw = localStorage.getItem('hyperion-ui')
    if (raw) {
      const parsed = JSON.parse(raw)
      const theme = parsed?.state?.theme as ThemeMode | undefined
      if (theme === 'light' || theme === 'dark') {
        applyTheme(theme)
        return
      }
    }
  } catch {
    /* ignore */
  }
  applyTheme('dark')
}
