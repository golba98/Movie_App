import { useEffect, type RefObject } from 'react'

type FullscreenVideo = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
}

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>
  unlock?: () => void
}

/**
 * Promotes the CSS-only theater layout to real fullscreen on touch devices.
 * The fixed-position theater styling stays as the universal base, so every
 * rejected or unsupported call below silently falls back to it. Desktop keeps
 * the contained CSS overlay on purpose; fullscreen only helps on phones,
 * where the browser chrome otherwise stays over the player.
 * - Standard path: requestFullscreen on the player shell plus a best-effort
 *   landscape lock (`screen.orientation.lock` is not in lib.dom, hence the cast).
 * - iPhone Safari lacks Element.requestFullscreen, so <video> sources open the
 *   native fullscreen player instead; iframe sources keep the CSS overlay.
 * Leaving fullscreen (Escape, system gesture, native player close) exits
 * theater mode through onExit so the two states never drift apart.
 * Skipped under automation (navigator.webdriver): real fullscreen resizes the
 * content area past the emulated viewport and leaks window fullscreen state
 * across tests, so drivers always exercise the CSS layout instead.
 */
export function useTheaterFullscreen(
  active: boolean,
  containerRef: RefObject<HTMLDivElement | null>,
  videoRef: RefObject<HTMLVideoElement | null>,
  onExit: () => void,
) {
  useEffect(() => {
    if (!active) return
    if (!window.matchMedia('(pointer: coarse)').matches || navigator.webdriver) return
    const container = containerRef.current
    const video = videoRef.current as FullscreenVideo | null
    const orientation = (typeof screen !== 'undefined' ? screen.orientation : undefined) as
      | LockableOrientation
      | undefined

    if (container?.requestFullscreen) {
      container
        .requestFullscreen({ navigationUI: 'hide' })
        .then(() => orientation?.lock?.('landscape')?.catch(() => {}))
        .catch(() => {})
    } else if (video?.webkitEnterFullscreen) {
      try {
        video.webkitEnterFullscreen()
      } catch {
        // CSS theater layout remains
      }
    }

    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onExit()
    }
    const onWebkitEndFullscreen = () => onExit()
    document.addEventListener('fullscreenchange', onFullscreenChange)
    video?.addEventListener('webkitendfullscreen', onWebkitEndFullscreen)

    return () => {
      document.removeEventListener('fullscreenchange', onFullscreenChange)
      video?.removeEventListener('webkitendfullscreen', onWebkitEndFullscreen)
      orientation?.unlock?.()
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
  }, [active, containerRef, videoRef, onExit])
}
