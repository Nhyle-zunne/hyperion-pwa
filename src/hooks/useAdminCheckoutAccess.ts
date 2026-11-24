import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAdminCheckoutAccess(userId: string | undefined) {
  const [result, setResult] = useState<{ userId: string; allowed: boolean } | null>(null)

  useEffect(() => {
    setResult(null)
    // Some isolated/offline shells have no Functions transport. Deny by default
    // instead of throwing and unmounting the existing purchase dialog.
    if (!userId || !supabase?.functions?.invoke) return

    let active = true
    void supabase.functions.invoke('admin-payment-review', { body: { action: 'check-admin' } })
      .then(({ data, error }) => {
        if (active) setResult({ userId, allowed: !error && data?.isAdmin === true })
      })
      .catch(() => { if (active) setResult({ userId, allowed: false }) })
    return () => { active = false }
  }, [userId])

  const checked = !userId || !supabase?.functions?.invoke || result?.userId === userId
  return { allowed: Boolean(userId && supabase && result?.userId === userId && result.allowed), checked }
}
