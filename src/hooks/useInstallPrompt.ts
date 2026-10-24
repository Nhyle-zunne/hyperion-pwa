import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  // iOS Safari
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return mq || ios
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
}

export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(isStandalone)
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem('hyperion-install-dismissed') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setInstalled(true)
      setDeferred(null)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    // Re-check standalone after focus (user may have installed)
    const onVis = () => {
      if (isStandalone()) setInstalled(true)
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    if (!deferred) return false
    await deferred.prompt()
    const choice = await deferred.userChoice
    setDeferred(null)
    if (choice.outcome === 'accepted') {
      setInstalled(true)
      return true
    }
    return false
  }, [deferred])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      localStorage.setItem('hyperion-install-dismissed', '1')
    } catch {
      /* ignore */
    }
  }, [])

  const resetDismiss = useCallback(() => {
    setDismissed(false)
    try {
      localStorage.removeItem('hyperion-install-dismissed')
    } catch {
      /* ignore */
    }
  }, [])

  return {
    canNativePrompt: !!deferred && !installed,
    installed,
    isIos: isIos(),
    isAndroid: isAndroid(),
    dismissed,
    promptInstall,
    dismiss,
    resetDismiss,
    /** Show install UI unless already installed */
    showInstallUi: !installed
  }
}
