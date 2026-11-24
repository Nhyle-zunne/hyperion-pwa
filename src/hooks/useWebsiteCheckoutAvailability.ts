import { useEffect } from 'react'
import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { isWebsiteCheckoutEnabled } from '../lib/pwaPurchaseAvailability'

type CheckoutAvailability = { enabled: boolean; checked: boolean; error: boolean }

const useCheckoutAvailabilityStore = create<CheckoutAvailability>(() => ({ enabled: false, checked: false, error: false }))
let lastCheckedAt = 0
let revision = 0
let inFlight: Promise<boolean> | null = null

export async function refreshWebsiteCheckoutAvailability(force = false): Promise<boolean> {
  const current = useCheckoutAvailabilityStore.getState()
  if (!force && current.checked && Date.now() - lastCheckedAt < 60_000) return current.enabled
  if (inFlight) return inFlight

  const requestRevision = ++revision
  const task = (async () => {
    try {
      if (!supabase) throw new Error('Checkout status unavailable')
      const { data, error } = await supabase.from('payment_settings')
        .select('website_checkout_enabled').eq('id', 1).single()
      if (error) throw error
      const enabled = isWebsiteCheckoutEnabled(data)
      if (revision === requestRevision) {
        useCheckoutAvailabilityStore.setState({ enabled, checked: true, error: false })
        lastCheckedAt = Date.now()
      }
      return enabled
    } catch {
      // If the switch cannot be verified, never expose a public payment action.
      if (revision === requestRevision) {
        useCheckoutAvailabilityStore.setState({ enabled: false, checked: true, error: true })
        lastCheckedAt = 0
      }
      return false
    }
  })()
  inFlight = task
  try { return await task } finally { if (inFlight === task) inFlight = null }
}

export function applyAdminCheckoutAvailability(enabled: boolean) {
  ++revision
  lastCheckedAt = Date.now()
  useCheckoutAvailabilityStore.setState({ enabled, checked: true, error: false })
}

export function useWebsiteCheckoutAvailability(active = true) {
  const enabled = useCheckoutAvailabilityStore(state => state.enabled)
  const checked = useCheckoutAvailabilityStore(state => state.checked)
  const error = useCheckoutAvailabilityStore(state => state.error)

  useEffect(() => {
    if (!active) return
    void refreshWebsiteCheckoutAvailability()
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void refreshWebsiteCheckoutAvailability(true)
    }
    window.addEventListener('focus', refreshIfVisible)
    window.addEventListener('online', refreshIfVisible)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.removeEventListener('focus', refreshIfVisible)
      window.removeEventListener('online', refreshIfVisible)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [active])

  return { enabled, checked, error }
}
