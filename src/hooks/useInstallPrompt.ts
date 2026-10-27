import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia('(display-mode: standalone)').matches
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return mq || ios
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const classicIos = /iphone|ipad|ipod/i.test(ua)
  // iPadOS may identify itself as macOS in desktop-style browsing.
  const ipadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return classicIos || ipadOs
}

function isAndroid(): boolean {
  if (typeof navigator === 'undefined') return false
  return /android/i.test(navigator.userAgent)
}

// Capture the browser event at module load instead of waiting for a component
// effect. Some Chromium browsers fire beforeinstallprompt early in page startup.
let deferredInstallEvent: BeforeInstallPromptEvent | null = null
let installedState = false
const installSubscribers = new Set<() => void>()
const notifyInstallSubscribers = () => {
  installSubscribers.forEach(subscriber => subscriber())
}

if (typeof window !== 'undefined') {
  installedState = isStandalone()

  window.addEventListener('beforeinstallprompt', (event: Event) => {
    event.preventDefault()
    deferredInstallEvent = event as BeforeInstallPromptEvent
    notifyInstallSubscribers()
  })

  window.addEventListener('appinstalled', () => {
    installedState = true
    deferredInstallEvent = null
    notifyInstallSubscribers()
  })

  document.addEventListener('visibilitychange', () => {
    if (isStandalone() && !installedState) {
      installedState = true
      deferredInstallEvent = null
      notifyInstallSubscribers()
    }
  })
}

export function useInstallPrompt() {
  const [, setVersion] = useState(0)
  const [dismissed, setDismissed] = useState(() => {
    try {
      // iOS dismissal is session-scoped so an old desktop/permanent dismissal
      // does not hide Safari instructions indefinitely.
      if (isIos()) return sessionStorage.getItem('hyperion-install-dismissed-ios') === '1'
      return localStorage.getItem('hyperion-install-dismissed') === '1'
    } catch {
      return false
    }
  })

  useEffect(() => {
    const subscriber = () => setVersion(version => version + 1)
    installSubscribers.add(subscriber)
    return () => {
      installSubscribers.delete(subscriber)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    const deferred = deferredInstallEvent
    if (!deferred || installedState || isStandalone()) return false

    try {
      // Call prompt directly within the click-triggered invocation so the
      // browser can associate it with the user's activation.
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (deferredInstallEvent === deferred) deferredInstallEvent = null
      if (choice.outcome === 'accepted') installedState = true
      notifyInstallSubscribers()
      return choice.outcome === 'accepted'
    } catch {
      if (deferredInstallEvent === deferred) deferredInstallEvent = null
      notifyInstallSubscribers()
      return false
    }
  }, [])

  const dismiss = useCallback(() => {
    setDismissed(true)
    try {
      if (isIos()) sessionStorage.setItem('hyperion-install-dismissed-ios', '1')
      else localStorage.setItem('hyperion-install-dismissed', '1')
    } catch {
      /* ignore */
    }
  }, [])

  const resetDismiss = useCallback(() => {
    setDismissed(false)
    try {
      localStorage.removeItem('hyperion-install-dismissed')
      sessionStorage.removeItem('hyperion-install-dismissed-ios')
    } catch {
      /* ignore */
    }
  }, [])

  const installed = installedState || isStandalone()
  return {
    canNativePrompt: !!deferredInstallEvent && !installed,
    installed,
    isIos: isIos(),
    isAndroid: isAndroid(),
    dismissed,
    promptInstall,
    dismiss,
    resetDismiss,
    showInstallUi: !installed
  }
}
