import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fetchManualCheckoutClaims, type ManualCheckoutClaim } from '../lib/manualCheckoutClaims'

type Snapshot = { owner: string | undefined; claims: ManualCheckoutClaim[]; loading: boolean; error: string }

export function useManualCheckoutClaims(userId?: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ owner: undefined, claims: [], loading: false, error: '' })
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const client = supabase
    if (!client || !userId) { setSnapshot({ owner: userId, claims: [], loading: false, error: '' }); return }
    let active = true
    let inFlight = false
    setSnapshot({ owner: userId, claims: [], loading: true, error: '' })
    const reload = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const claims = await fetchManualCheckoutClaims(client, userId)
        if (active) setSnapshot({ owner: userId, claims, loading: false, error: '' })
      } catch {
        if (active) setSnapshot(old => ({ owner: userId, claims: old.owner === userId ? old.claims : [], loading: false, error: 'Could not load your payment requests. Refresh to try again.' }))
      } finally { inFlight = false }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void reload() }
    void reload()
    window.addEventListener('focus', reload)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      window.removeEventListener('focus', reload)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [userId, revision])

  return {
    claims: snapshot.owner === userId ? snapshot.claims : [],
    loading: Boolean(userId) && (snapshot.owner !== userId || snapshot.loading),
    error: snapshot.owner === userId ? snapshot.error : '',
    reload: () => setRevision(value => value + 1),
  }
}
