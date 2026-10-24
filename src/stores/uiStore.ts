import { create } from 'zustand'

interface UIState {
  showPaywall: boolean
  paywallFeature: string
  openPaywall: (feature?: string) => void
  closePaywall: () => void
}

export const useUIStore = create<UIState>((set) => ({
  showPaywall: false,
  paywallFeature: 'this feature',
  openPaywall: (feature = 'this feature') =>
    set({ showPaywall: true, paywallFeature: feature }),
  closePaywall: () => set({ showPaywall: false })
}))
