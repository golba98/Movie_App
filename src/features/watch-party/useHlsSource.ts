import type HlsType from 'hls.js'
import { useEffect, type RefObject } from 'react'
import type { PlaybackKind } from '../../types/watch-party'

/**
 * Loads a room's stream into a <video>. HLS needs hls.js on browsers without
 * native HLS (Chrome/Firefox); Safari plays it directly, as do mp4/webm.
 * hls.js is large, so it is imported only when an HLS stream must play.
 */
export function useHlsSource(videoRef: RefObject<HTMLVideoElement | null>, url: string | null, kind: PlaybackKind) {
  useEffect(() => {
    const video = videoRef.current
    if (!video || kind === 'embed' || !url) return
    if (kind !== 'hls' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      return
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
      hls.loadSource(url)
      hls.attachMedia(target)
    })
    return () => {
      destroyed = true
      hls?.destroy()
    }
  }, [videoRef, url, kind])
}
