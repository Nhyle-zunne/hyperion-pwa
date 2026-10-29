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

/**
 * Return install instructions for the detected browser and device.
 *
 * The native beforeinstallprompt API is browser-controlled and not universally
 * available, so every branch includes a manual route or a supported alternative.
 */
export function getManualInstallInstructions(): string {
  if (typeof navigator === 'undefined') {
    return 'Open your browser menu and look for Install app or Add to Home Screen.'
  }

  const userAgent = navigator.userAgent
  const platform = navigator.platform || ''
  const nav = navigator as Navigator & { brave?: unknown }
  const isAppleMobile =
    /iphone|ipad|ipod/i.test(userAgent) ||
    (platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isAndroid = /android/i.test(userAgent)
  const isMac = /Macintosh|Mac OS X/i.test(userAgent) && navigator.maxTouchPoints <= 1

  // On iPhone/iPad, installation uses the system Share sheet in supported browsers.
  if (isAppleMobile) {
    if (/CriOS/i.test(userAgent)) {
      return 'Chrome on iPhone/iPad: tap Share beside the address bar → Add to Home Screen → Add. If that option is missing, open Hyperion in Safari and repeat.'
    }
    if (/EdgiOS/i.test(userAgent)) {
      return 'Edge on iPhone/iPad: open the Share or browser menu → Add to Home Screen. If it is not listed, open Hyperion in Safari and choose Share → Add to Home Screen.'
    }
    if (/FxiOS/i.test(userAgent)) {
      return 'Firefox on iPhone/iPad: open the Share menu → Add to Home Screen. If that option is missing, open Hyperion in Safari and choose Share → Add to Home Screen.'
    }
    if (/OPiOS/i.test(userAgent)) {
      return 'Opera on iPhone/iPad: use the Share menu → Add to Home Screen. If that option is missing, open Hyperion in Safari and choose Share → Add to Home Screen.'
    }
    return 'Safari on iPhone/iPad: tap Share → Add to Home Screen → Add. In another iPhone browser, look for Add to Home Screen in its Share menu; if unavailable, open Hyperion in Safari.'
  }

  // Android browsers use their own menu labels for installation or shortcuts.
  if (isAndroid) {
    if (/SamsungBrowser/i.test(userAgent)) {
      return 'Samsung Internet: open the browser menu and choose Add page to or Add to Home screen. Confirm the prompt to add Hyperion.'
    }
    if (/Firefox/i.test(userAgent)) {
      return 'Firefox on Android: tap ⋮ → More → Add to shortcuts. This creates a Home-screen shortcut. For a more app-like installation, try Chrome or Samsung Internet.'
    }
    if (/Vivaldi/i.test(userAgent)) {
      return 'Vivaldi on Android: open Menu → Add Page To → Home screen, then choose Install and confirm.'
    }
    if (/OPR|Opera/i.test(userAgent)) {
      return 'Opera on Android: open the browser menu and look for Add to Home screen or Install. If neither appears, try Chrome or Samsung Internet.'
    }
    if (nav.brave || /Brave/i.test(userAgent)) {
      return 'Brave on Android: open the browser menu (⋮) and choose Install app or Add to Home screen, then confirm.'
    }
    if (/EdgA|EdgiOS|Edg/i.test(userAgent)) {
      return 'Edge on Android: open the browser menu and look for Add to phone or Add to Home screen. If unavailable, try Chrome or Samsung Internet.'
    }
    if (/Chrome/i.test(userAgent)) {
      return 'Chrome on Android: tap ⋮ → Install app or Add to Home screen, then confirm. The wording can vary by device.'
    }
    return 'On Android, open your browser menu (often ⋮) and choose Install app or Add to Home screen. Firefox may call this Add to shortcuts. If no option appears, try Chrome or Samsung Internet.'
  }

  // Safari's standalone web app support on Mac uses Add to Dock.
  if (isMac && /Safari/i.test(userAgent) &&
      !/Chrome|CriOS|Edg|OPR|Opera|Brave|Firefox|Vivaldi/i.test(userAgent)) {
    return 'Safari on Mac (macOS Sonoma 14 or later): click Share in the toolbar → Add to Dock → Add. On older macOS versions, use Chrome or Edge to install Hyperion as an app.'
  }

  if (nav.brave || /Brave/i.test(userAgent)) {
    return 'Brave on desktop: open the menu → Save and Share → Install Hyperion. You can also use an Install icon beside the address bar. To check for an existing copy, open brave://apps.'
  }

  if (/Edg\//i.test(userAgent)) {
    return 'Microsoft Edge: open ⋯ → More tools → Apps → Install this site as an app. You can also use the Install icon beside the address bar.'
  }

  if (/Vivaldi/i.test(userAgent)) {
    return 'Vivaldi: click Install in the address bar, or right-click the tab → Progressive Web Apps → Install Hyperion. If Install is unavailable, right-click the tab → Progressive Web Apps → Create a shortcut and select Open as Window.'
  }

  if (/OPR|Opera/i.test(userAgent)) {
    return 'Opera desktop: look for an Install icon beside the address bar or an Install option in the browser menu. If this version has no install option, open Hyperion in Chrome, Edge, Brave, or Vivaldi to install it as an app.'
  }

  if (/Chrome\//i.test(userAgent)) {
    return 'Google Chrome: open ⋮ → Cast, save, and share → Install page as app. You can also click the Install icon beside the address bar.'
  }

  if (/Firefox/i.test(userAgent)) {
    if (/Windows/i.test(userAgent)) {
      return 'Firefox on Windows: click the web-app icon in the address bar if it appears. Firefox 143+ can pin web apps to the taskbar and Start menu. If the icon is missing, use Chrome, Edge, Brave, or Vivaldi instead.'
    }
    return 'Firefox on this desktop platform may not offer built-in web-app installation. Open Hyperion in Chrome, Edge, Brave, or Vivaldi to install it as a standalone app.'
  }

  return 'For this browser, open its main menu and look for Install app, Install site, or Create shortcut. You may also see an Install icon beside the address bar. If no option is available, open Hyperion in Chrome, Edge, Brave, or Vivaldi and install it there.'
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
