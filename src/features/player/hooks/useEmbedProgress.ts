import { useEffect, useRef, type RefObject } from 'react'
import { isRecord } from '../../../lib/is-record'
import type { PlaybackProgress } from '../../../types/watch-history'
import { playerDebug } from '../player-debug'

/**
 * A position reported by an embedded player. Players that follow vsembed's
 * event format also name their status ('playing', 'paused', 'seeked',
 * 'completed') and the episode they are playing.
 */
export interface EmbedProgress extends PlaybackProgress {
  status?: string
  season?: number
  episode?: number
}

function toNumber(value: unknown) {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) ? number : null
}

function parseDetails(data: Record<string, unknown>) {
  const details: Pick<EmbedProgress, 'status' | 'season' | 'episode'> = {}
  if (typeof data.player_status === 'string') details.status = data.player_status
  if (isRecord(data.player_info)) {
    const season = toNumber(data.player_info.season)
    const episode = toNumber(data.player_info.episode)
    if (season !== null && episode !== null) Object.assign(details, { season, episode })
  }
  return details
}

// Embedded providers report progress in different shapes, e.g.
// { type: 'PLAYER_EVENT', data: { event: 'timeupdate', currentTime, duration } },
// { type: 'PLAYER_EVENT', data: { player_status, player_progress, player_duration, player_info } } (vsembed, seconds),
// { currentTime, duration }, { timestamp, duration } or { progress: 0-100, duration }.
function parseEmbedProgress(raw: unknown): EmbedProgress | null {
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

  const duration = toNumber(data.duration) ?? toNumber(data.player_duration)
  if (!duration || duration <= 0) return null
  const position = toNumber(data.currentTime)
    ?? toNumber(data.time)
    ?? toNumber(data.timestamp)
    ?? toNumber(data.player_progress)
  if (position !== null) return position >= 0 ? { position: Math.min(position, duration), duration, ...parseDetails(data) } : null
  const percent = toNumber(data.progress)
  if (percent !== null && percent >= 0 && percent <= 100) return { position: (percent / 100) * duration, duration }
  return null
}

// Listens for progress messages posted by the embedded player. Only messages
// from that iframe's own window are trusted.
export function useEmbedProgress(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  onProgress: (progress: EmbedProgress) => void,
) {
  const onProgressRef = useRef(onProgress)

  useEffect(() => {
    onProgressRef.current = onProgress
  }, [onProgress])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frameWindow = iframeRef.current?.contentWindow
      if (!frameWindow || event.source !== frameWindow) return
      // vsembed blanks its player when it detects browser DevTools.
      if (isRecord(event.data) && event.data.type === 'VS_DEVTOOLS') {
        playerDebug('provider stopped its player because DevTools are open')
        return
      }
      const progress = parseEmbedProgress(event.data)
      if (progress) onProgressRef.current(progress)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframeRef])
}
