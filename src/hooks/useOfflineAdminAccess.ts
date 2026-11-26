import { useEffect, useState, useSyncExternalStore } from 'react'
import { getCachedOfflineEntitlementSnapshot } from '../lib/offlineQuestionCache'
import { useLicenseStore } from '../stores/licenseStore'

function subscribeConnectivity(update: () => void) {
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  return () => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  }
}

export function useOnlineStatus() {
  return useSyncExternalStore(subscribeConnectivity, () => navigator.onLine)
}

export function useOfflineAdminAccess(enabled: boolean, userId?: string) {
  const revision = useLicenseStore(state => state.entitlementExpiryRevision)
  const [result, setResult] = useState<{ userId?: string; revision: number; allowed: boolean } | null>(null)

  useEffect(() => {
    if (!enabled) {
      setResult(null)
      return
    }

    let active = true
    let request = 0
    const verify = async () => {
      const current = ++request
      const snapshot = await getCachedOfflineEntitlementSnapshot(userId).catch(() => null)
      if (active && current === request) setResult({ userId, revision, allowed: snapshot?.isAdmin === true })
    }
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === 'hyperion-offline-entitlements' || event.key === 'hyperion-progress-owner') void verify()
    }

    void verify()
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', verify)
    window.addEventListener('hyperion:license-server-refreshed', verify)
    return () => {
      active = false
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', verify)
      window.removeEventListener('hyperion:license-server-refreshed', verify)
    }
  }, [enabled, userId, revision])

  const checked = enabled && result !== null && result.userId === userId && result.revision === revision
  return { allowed: checked && result.allowed, checked: !enabled || checked }
}
