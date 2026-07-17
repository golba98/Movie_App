import { type RefObject, useEffect } from 'react'

const mediaEvents = [
  'play',
  'pause',
  'waiting',
  'stalled',
  'suspend',
  'error',
  'emptied',
  'abort',
  'encrypted',
] as const

function sanitizeUrl(value: string) {
  if (!value) return '(none)'
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin ? url.pathname : `${url.origin}${url.pathname}`
  } catch {
    return '(invalid source)'
  }
}

function videoSnapshot(video: HTMLVideoElement) {
  return {
    source: sanitizeUrl(video.currentSrc || video.src),
    currentTime: Number(video.currentTime.toFixed(2)),
    duration: Number.isFinite(video.duration) ? Number(video.duration.toFixed(2)) : null,
    paused: video.paused,
    ended: video.ended,
    readyState: video.readyState,
    networkState: video.networkState,
    error: video.error ? { code: video.error.code, message: video.error.message } : null,
  }
}

export function useVideoDiagnostics(
  videoRef: RefObject<HTMLVideoElement | null>,
  label: string,
  sourceUrl: string,
  observePage = true,
) {
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const video = videoRef.current
    if (!video) return

    const handleMediaEvent = (event: Event) => {
      console.debug('[video-diagnostics]', label, event.type, videoSnapshot(video))
    }
    mediaEvents.forEach((eventName) => video.addEventListener(eventName, handleMediaEvent))
    console.debug('[video-diagnostics]', label, 'mounted', videoSnapshot(video))

    return () => {
      mediaEvents.forEach((eventName) => video.removeEventListener(eventName, handleMediaEvent))
      console.debug('[video-diagnostics]', label, 'unmounted', videoSnapshot(video))
    }
  }, [label, videoRef])

  useEffect(() => {
    if (!import.meta.env.DEV) return
    console.debug('[video-diagnostics]', label, 'source-change', {
      source: sanitizeUrl(sourceUrl),
    })
  }, [label, sourceUrl])

  useEffect(() => {
    if (!import.meta.env.DEV || !observePage) return
    const handleVisibility = () => {
      console.debug('[video-diagnostics]', label, 'visibilitychange', {
        hidden: document.hidden,
        visibilityState: document.visibilityState,
      })
    }
    const handleFocus = () => console.debug('[video-diagnostics]', label, 'window-focus')
    const handleBlur = () => console.debug('[video-diagnostics]', label, 'window-blur')

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('focus', handleFocus)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('focus', handleFocus)
      window.removeEventListener('blur', handleBlur)
    }
  }, [label, observePage])
}
