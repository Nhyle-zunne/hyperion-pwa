import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const useKeywordSettings = create<{
  enabled: boolean
  setEnabled: (enabled: boolean) => void
}>()(persist(set => ({
  enabled: false,
  setEnabled: enabled => set({ enabled })
}), { name: 'hyperion-keyword-settings' }))
