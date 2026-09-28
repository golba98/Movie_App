import { useEffect, useRef, type RefObject } from 'react'
import { isRecord } from '../../../lib/is-record'
import type { PlaybackProgress } from '../../../types/watch-history'

function toNumber(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : null
}

// Embedded providers report progress in different shapes, e.g.
// { type: 'PLAYER_EVENT', data: { event: 'timeupdate', currentTime, duration } },
// { currentTime, duration }, { timestamp, duration } or { progress: 0-100, duration }.
function parseEmbedProgress(raw: unknown): PlaybackProgress | null {
  let data = raw
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return null
    }
  }
  if (!isRecord(data)) return null
  if (isRecord(data.data)) data = data.data
  if (!isRecord(data)) return null

  const duration = toNumber(data.duration)
  if (!duration || duration <= 0) return null
  const position = toNumber(data.currentTime) ?? toNumber(data.time) ?? toNumber(data.timestamp)
  if (position !== null) return position >= 0 ? { position: Math.min(position, duration), duration } : null
  const percent = toNumber(data.progress)
  if (percent !== null && percent >= 0 && percent <= 100) return { position: (percent / 100) * duration, duration }
  return null
}

// Listens for progress messages posted by the embedded player. Only messages
// from that iframe's own window are trusted.
export function useEmbedProgress(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  onProgress: (progress: PlaybackProgress) => void,
) {
  const onProgressRef = useRef(onProgress)

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) return
      const progress = parseEmbedProgress(event.data)
      if (progress) onProgressRef.current(progress)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframeRef])
}
