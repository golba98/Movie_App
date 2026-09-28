import { Pause, Play } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatClock } from '../../lib/format'
import type { PlaybackKind, WatchPartyClientRequest, WatchPartyState } from '../../types/watch-party'
import { logIframeConfiguration, PLAYER_IFRAME_ALLOW, PLAYER_IFRAME_REFERRER_POLICY } from '../player/player-debug'
import { driftCorrection, expectedPlaybackPosition } from './sync'
import { useHlsSource } from './useHlsSource'

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
// A rate nudge runs this long before the room's own rate is restored.
const RATE_CORRECTION_MS = 2_000

interface SynchronizedPlayerProps {
  state: WatchPartyState
  playbackUrl: string | null
  playbackKind: PlaybackKind
  canControl: boolean
  send: (event: WatchPartyClientRequest) => boolean
}

function EmbeddedPlayer({ playbackUrl }: { playbackUrl: string | null }) {
  if (!playbackUrl) {
    return (
      <div className="grid aspect-video place-items-center rounded-3xl bg-black text-sm text-red-200" role="alert">
        The player could not be prepared. Reload the page to try again.
      </div>
    )
  }

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-white/10">
        {/* No sandbox: providers refuse to run in sandboxed frames. See player/player-debug.ts. */}
        <iframe
          src={playbackUrl}
          className="block size-full border-0 bg-black object-contain"
          allow={PLAYER_IFRAME_ALLOW}
          allowFullScreen
          referrerPolicy={PLAYER_IFRAME_REFERRER_POLICY}
          onLoad={() => logIframeConfiguration('watch-party')}
        />
      </div>
      <p className="mt-3 rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-xs leading-5 text-amber-100">
        This source plays in an embedded third-party player, so play and pause can't be synchronised automatically. Count each other in over your call, or use a direct video source for full sync.
      </p>
    </div>
  )
}

/**
 * 'video' and 'hls' load into an app-owned <video>, so playback follows the
 * shared room state with drift correction. 'embed' is an opaque cross-origin
 * iframe the browser gives us no control over, which the UI states plainly.
 */
export function SynchronizedPlayer({ state, playbackUrl, playbackKind, canControl, send }: SynchronizedPlayerProps) {
  const isEmbed = playbackKind === 'embed'
  const videoRef = useRef<HTMLVideoElement>(null)
  // Media events caused by applying room state must not be echoed back.
  const applyingRemote = useRef(false)
  const [ready, setReady] = useState(false)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const playing = state.playbackState === 'playing'

  useHlsSource(videoRef, playbackUrl, playbackKind)

  const sync = useCallback(() => {
    const video = videoRef.current
    if (isEmbed || !video || !ready) return
    const expected = expectedPlaybackPosition(state, Date.now())
    const correction = driftCorrection(expected - video.currentTime * 1000)
    applyingRemote.current = true
    video.playbackRate = state.playbackRate * correction.rate
    if (correction.kind === 'seek') video.currentTime = Math.max(0, expected / 1000)
    if (state.playbackState === 'playing' && video.paused) void video.play().catch(() => undefined)
    if (state.playbackState !== 'playing' && !video.paused) video.pause()
    window.setTimeout(() => {
      applyingRemote.current = false
      video.playbackRate = state.playbackRate
    }, correction.kind === 'rate' ? RATE_CORRECTION_MS : 0)
  }, [ready, state, isEmbed])

  useEffect(() => {
    sync()
  }, [sync])

  if (isEmbed) return <EmbeddedPlayer playbackUrl={playbackUrl} />

  const reportBuffering = (buffering: boolean) => {
    if (!applyingRemote.current) send({ type: 'playback:buffering', buffering })
  }
  const requestSeek = (target: EventTarget) => {
    send({ type: 'playback:seek-request', positionMs: Number((target as HTMLInputElement).value) * 1000 })
  }

  return (
    <div className="relative overflow-hidden rounded-3xl bg-black shadow-2xl ring-1 ring-white/10">
      <video
        ref={videoRef}
        className="aspect-video w-full object-contain"
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration)
          setReady(true)
        }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime)}
        onWaiting={() => reportBuffering(true)}
        onCanPlay={() => reportBuffering(false)}
      />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 text-sm text-zinc-300" role="status">Synchronizing with room…</div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-4 pb-4 pt-14">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canControl}
            onClick={() => send({ type: playing ? 'playback:pause-request' : 'playback:play-request' })}
            className="grid size-11 place-items-center rounded-full bg-white text-black disabled:opacity-45"
            aria-label={playing ? 'Pause for everyone' : 'Play for everyone'}
          >
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <span className="text-xs tabular-nums text-zinc-200">{formatClock(position)} / {formatClock(duration)}</span>
          <input
            type="range"
            min="0"
            max={duration || 0}
            value={Math.min(position, duration || 0)}
            disabled={!canControl || !duration}
            onChange={(event) => setPosition(Number(event.target.value))}
            onMouseUp={(event) => requestSeek(event.target)}
            onTouchEnd={(event) => requestSeek(event.target)}
            className="min-w-24 flex-1 accent-white disabled:opacity-40"
            aria-label="Seek for everyone"
          />
          <select
            value={state.playbackRate}
            disabled={!canControl}
            onChange={(event) => send({ type: 'playback:rate-request', playbackRate: Number(event.target.value) })}
            className="rounded-xl bg-black/60 px-3 py-2 text-xs text-white disabled:opacity-45"
            aria-label="Playback speed"
          >
            {PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </div>
        {!canControl && <p className="mt-3 text-xs text-zinc-400">Only permitted participants can control playback.</p>}
      </div>
    </div>
  )
}
