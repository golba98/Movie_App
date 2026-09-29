import { AlertCircle, Play } from 'lucide-react'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { PLAYER_IFRAME_ALLOW, PLAYER_IFRAME_REFERRER_POLICY, playerDebug, urlHost } from '../player-debug'

const PANEL = 'grid size-full place-items-center bg-black px-5 py-8 text-center sm:px-6'
const PRIMARY_BUTTON = 'min-h-11 w-full rounded-xl sm:w-auto bg-white px-5 text-sm font-black text-black transition hover:bg-zinc-200'
const SECONDARY_BUTTON = 'min-h-11 w-full rounded-xl sm:w-auto border border-white/15 bg-white/5 px-5 text-sm font-black text-white transition hover:bg-white/10'

function Spinner({ label }: { label: string }) {
  return (
    <div>
      <div className="mx-auto size-8 animate-spin rounded-full border border-white/10 border-t-white" />
      <p className="mt-4 text-sm font-semibold text-zinc-300">{label}</p>
    </div>
  )
}

function IdlePanel({ itemKind, onPlay }: { itemKind: string; onPlay: () => void }) {
  return (
    <div className={PANEL}>
      <div className="max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-300 sm:size-14">
          <Play size={20} fill="currentColor" aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-base font-semibold text-white sm:mt-4">Ready when you are</h3>
        <p className="mt-1.5 text-xs leading-5 text-zinc-400 sm:mt-2 sm:text-sm sm:leading-6">
          Start playback here, or use Theater mode for a larger view.
        </p>
        <button
          type="button"
          onClick={onPlay}
          className="mt-4 min-h-11 rounded-xl bg-white px-5 text-sm font-black text-black transition hover:bg-zinc-200 sm:mt-5"
        >
          Play {itemKind}
        </button>
      </div>
    </div>
  )
}

interface FailedPanelProps {
  sourceLabel: string | null
  message: string
  fallbackLabel: string | null
  onRetry: () => void
  onFallback: () => void
  onStop: () => void
}

function FailedPanel({ sourceLabel, message, fallbackLabel, onRetry, onFallback, onStop }: FailedPanelProps) {
  return (
    <div className={PANEL}>
      <div role="alert" className="w-full max-w-md">
        <span className="mx-auto grid size-12 place-items-center rounded-full border border-red-400/20 bg-red-400/10 text-red-200 sm:size-14">
          <AlertCircle aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-base font-semibold text-white sm:mt-4 sm:text-lg">Player unavailable</h3>
        {sourceLabel && <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">{sourceLabel}</p>}
        <p className="mt-1.5 text-xs leading-5 text-zinc-400 sm:mt-2 sm:text-sm sm:leading-6">{message}</p>
        <div className="mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
          <button type="button" onClick={onRetry} className={PRIMARY_BUTTON}>Retry player</button>
          {fallbackLabel && (
            <button type="button" onClick={onFallback} className={SECONDARY_BUTTON}>Try {fallbackLabel}</button>
          )}
          <button type="button" onClick={onStop} className={SECONDARY_BUTTON}>Stop player</button>
        </div>
      </div>
    </div>
  )
}

interface ProviderFrameProps {
  iframeRef: RefObject<HTMLIFrameElement | null>
  iframeKey: string
  src: string
  loaded: boolean
  title: string
  sourceLabel: string
  onLoad: () => void
}

function ProviderFrame({ iframeRef, iframeKey, src, loaded, title, sourceLabel, onLoad }: ProviderFrameProps) {
  // A second load for the same frame means the provider navigated or reloaded
  // its own player; a remount means this app replaced the frame.
  const loadCountRef = useRef(0)
  const host = urlHost(src)

  useEffect(() => {
    loadCountRef.current = 0
    playerDebug('frame mounted', { sourceLabel, host })
    return () => playerDebug('frame unmounted', { sourceLabel, host })
  }, [iframeKey, sourceLabel, host])

  const srcRef = useRef(src)
  useEffect(() => {
    if (srcRef.current === src) return
    srcRef.current = src
    playerDebug('frame src changed by app', { sourceLabel, host })
  }, [src, sourceLabel, host])

  const handleLoad = () => {
    loadCountRef.current += 1
    playerDebug(loadCountRef.current === 1 ? 'frame loaded' : 'frame reloaded by provider', {
      sourceLabel,
      host,
      loads: loadCountRef.current,
    })
    onLoad()
  }

  return (
    <div className="relative size-full bg-black">
      {/* No sandbox: providers refuse to run in sandboxed frames. See player-debug.ts. */}
      <iframe
        ref={iframeRef}
        key={iframeKey}
        src={src}
        className={`block size-full border-0 bg-black object-contain transition-opacity duration-200 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        allow={PLAYER_IFRAME_ALLOW}
        allowFullScreen
        referrerPolicy={PLAYER_IFRAME_REFERRER_POLICY}
        aria-label={`Video player for ${title}`}
        onLoad={handleLoad}
      />
      {!loaded && (
        <div role="status" className="absolute inset-0 z-10 grid place-items-center bg-black px-6 text-center">
          <Spinner label={`Loading player (${sourceLabel})…`} />
        </div>
      )}
    </div>
  )
}

// Freezes the start offset per player load, so saving progress never reloads the
// iframe. Forgotten once the frame is gone, so playing again starts from the
// latest saved position rather than the one this frame opened at.
function useFrozenSrc(iframeKey: string | null, url: string | null, withStart: (url: string) => string) {
  const [frozen, setFrozen] = useState<{ key: string; src: string } | null>(null)
  if (iframeKey && url && frozen?.key !== iframeKey) {
    setFrozen({ key: iframeKey, src: withStart(url) })
  } else if (!iframeKey && frozen) {
    setFrozen(null)
  }
  return frozen?.key === iframeKey ? frozen.src : url
}

export type DynamicStage =
  | { kind: 'idle' }
  | { kind: 'frame'; iframeKey: string; url: string; loaded: boolean }
  | { kind: 'failed'; message: string }
  | { kind: 'preparing' }

interface DynamicPlayerStageProps {
  stage: DynamicStage
  iframeRef: RefObject<HTMLIFrameElement | null>
  title: string
  itemKind: string
  sourceLabel: string
  showSourceLabel: boolean
  fallbackLabel: string | null
  withStartTime: (url: string) => string
  onPlay: () => void
  onFrameLoad: (iframeKey: string) => void
  onRetry: () => void
  onFallback: () => void
  onStop: () => void
}

export function DynamicPlayerStage({
  stage,
  iframeRef,
  title,
  itemKind,
  sourceLabel,
  showSourceLabel,
  fallbackLabel,
  withStartTime,
  onPlay,
  onFrameLoad,
  onRetry,
  onFallback,
  onStop,
}: DynamicPlayerStageProps) {
  const frame = stage.kind === 'frame' ? stage : null
  const src = useFrozenSrc(frame?.iframeKey ?? null, frame?.url ?? null, withStartTime)

  switch (stage.kind) {
    case 'idle':
      return <IdlePanel itemKind={itemKind} onPlay={onPlay} />
    case 'frame':
      return (
        <ProviderFrame
          iframeRef={iframeRef}
          iframeKey={stage.iframeKey}
          src={src ?? stage.url}
          loaded={stage.loaded}
          title={title}
          sourceLabel={sourceLabel}
          onLoad={() => onFrameLoad(stage.iframeKey)}
        />
      )
    case 'failed':
      return (
        <FailedPanel
          sourceLabel={showSourceLabel ? sourceLabel : null}
          message={stage.message}
          fallbackLabel={fallbackLabel}
          onRetry={onRetry}
          onFallback={onFallback}
          onStop={onStop}
        />
      )
    case 'preparing':
      return (
        <div role="status" className={PANEL}>
          <Spinner label={`Preparing player (${sourceLabel})…`} />
        </div>
      )
  }
}
