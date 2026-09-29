// Shared configuration for third-party player iframes. There is no `sandbox`
// attribute: providers refuse to run inside sandboxed frames, and the
// cross-origin boundary already isolates this app's DOM, cookies and storage.
export const PLAYER_IFRAME_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
export const PLAYER_IFRAME_REFERRER_POLICY = 'origin'

/** Hostname only, so logs never carry paths, query strings or signed tokens. */
export function urlHost(url: string | null | undefined) {
  if (!url) return null
  try {
    return new URL(url, window.location.origin).hostname
  } catch {
    return null
  }
}

// Lets a viewer turn the logs on in production to report a playback problem:
// localStorage.setItem('fedora:player-debug', '1'), then reload.
const DEBUG_FLAG = 'fedora:player-debug'

function debugEnabled() {
  if (import.meta.env.DEV) return true
  try {
    return localStorage.getItem(DEBUG_FLAG) === '1'
  } catch {
    return false
  }
}

/** Player diagnostics, on in development or behind a flag. Callers must pass non-sensitive details only. */
export function playerDebug(event: string, details?: Record<string, unknown>) {
  if (!debugEnabled()) return
  console.info(`[player] ${new Date().toISOString().slice(11, 19)} ${event}`, details ?? {})
}

export function logIframeConfiguration(context: string) {
  playerDebug('iframe sandbox configuration', {
    context,
    sandbox: 'none',
    allow: PLAYER_IFRAME_ALLOW,
    allowFullScreen: true,
    referrerPolicy: PLAYER_IFRAME_REFERRER_POLICY,
  })
}
