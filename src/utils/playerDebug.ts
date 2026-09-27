// Shared configuration for third-party player iframes. No `sandbox` attribute:
// providers refuse to run inside sandboxed frames, and the cross-origin boundary
// already isolates this app's DOM, cookies and storage from the player.
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

/** Development-only player diagnostics. Callers must pass non-sensitive details only. */
export function playerDebug(event: string, details?: Record<string, unknown>) {
  if (!import.meta.env.DEV) return
  console.info(`[player] ${event}`, details ?? {})
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
