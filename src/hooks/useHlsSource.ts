import type HlsType from 'hls.js'
import { useEffect, useEffectEvent, type RefObject } from 'react'
import type { PlaybackKind } from '../types/watch-party'

/**
 * Loads a stream into a <video>. HLS needs hls.js on browsers without
 * native HLS (Chrome/Firefox); Safari plays it directly, as do mp4/webm.
 * hls.js is large, so it is imported only when an HLS stream must play.
 */
export function useHlsSource(videoRef: RefObject<HTMLVideoElement | null>, url: string | null, kind: PlaybackKind, onPlaybackError?: (message: string) => void) {
  const reportError = useEffectEvent((message: string) => onPlaybackError?.(message))
  useEffect(() => {
    const video = videoRef.current
    if (!video || kind === 'embed' || !url) return
    if (kind !== 'hls' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      return () => {
        video.pause()
        video.removeAttribute('src')
        video.load()
      }
    }
    let destroyed = false
    let hls: HlsType | null = null
    void import('hls.js').then(({ default: Hls }) => {
      const target = videoRef.current
      if (destroyed || !target) return
      if (!Hls.isSupported()) {
        target.src = url
        return
      }
      hls = new Hls({ enableWorker: true })
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!destroyed && data.fatal) {
          hls?.stopLoad()
          reportError('The video stream could not be loaded. Try another source.')
        }
      })
      hls.loadSource(url)
      hls.attachMedia(target)
    }).catch(() => {
      if (!destroyed) reportError('The video stream could not be prepared. Try another source.')
    })
    return () => {
      destroyed = true
      video.pause()
      hls?.destroy()
    }
  }, [videoRef, url, kind])
}
