import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaSource } from '../../../types/media-source'
import { extractPlayer } from '../api'
import { logIframeConfiguration, playerDebug, urlHost } from '../player-debug'
import {
  getSourceLabel,
  isDynamicSource,
  isEmbeddableUrl,
  SOURCE_FAILURE_MESSAGES,
  withoutSource,
  type SourceFailureReason,
  type SourceStates,
} from '../sources'

const EXTRACTION_TIMEOUT_MS = 15_000
const IFRAME_LOAD_TIMEOUT_MS = 12_000
// Lets the provider paint its first frame before the loading overlay fades.
const IFRAME_REVEAL_DELAY_MS = 180

interface SourcePlaybackOptions {
  playableSources: MediaSource[]
  // A new key (another title or episode) forgets every source's state.
  resetKey: string
  // The viewer asked a dynamic source to play, inline or in theater mode.
  playbackRequested: boolean
}

/**
 * Chooses which source plays and drives dynamic sources through extraction
 * and iframe loading. Failed sources are skipped automatically unless the
 * viewer picked one explicitly, so they see that source's own error.
 */
export function useSourcePlayback({ playableSources, resetKey, playbackRequested }: SourcePlaybackOptions) {
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [sourceStates, setSourceStates] = useState<SourceStates>({})
  const [extractionAttempt, setExtractionAttempt] = useState(0)
  const [loadedIframeKey, setLoadedIframeKey] = useState<string | null>(null)
  // Bumped by "Reload player" to remount a provider player that got stuck.
  const [playerReload, setPlayerReload] = useState(0)
  const sourceStatesRef = useRef(sourceStates)
  const previousActiveSourceIdRef = useRef<string | null>(null)
  const iframeRevealTimerRef = useRef<number | null>(null)

  useEffect(() => {
    sourceStatesRef.current = sourceStates
  }, [sourceStates])

  useEffect(() => {
    setSelectedSourceId(null)
    setSourceStates({})
    setLoadedIframeKey(null)
    setPlayerReload(0)
  }, [resetKey])

  const failedSourceIds = useMemo(
    () => new Set(Object.keys(sourceStates).filter((sourceId) => sourceStates[sourceId].status === 'failed')),
    [sourceStates],
  )

  const activeSource = useMemo(() => {
    if (playableSources.length === 0) return undefined
    const selected = selectedSourceId ? playableSources.find((source) => source.id === selectedSourceId) : undefined
    return selected ?? playableSources.find((source) => !failedSourceIds.has(source.id)) ?? playableSources[0]
  }, [playableSources, selectedSourceId, failedSourceIds])

  const isDynamic = isDynamicSource(activeSource)
  const activeState = activeSource ? sourceStates[activeSource.id] : undefined
  const extractedUrl = activeState?.status === 'ready' ? activeState.extractedUrl : null
  const iframeKey = activeSource && extractedUrl ? `${activeSource.id}|${extractedUrl}|${playerReload}` : null
  const iframeLoaded = iframeKey !== null && loadedIframeKey === iframeKey
  const fallbackSource = activeSource
    ? playableSources.find((source) => source.id !== activeSource.id && !failedSourceIds.has(source.id))
    : undefined

  const markSourceFailed = useCallback((source: MediaSource, reason: SourceFailureReason, message?: string) => {
    playerDebug('source failed', { sourceId: source.id, label: getSourceLabel(source), reason })
    setSourceStates((prev) => ({
      ...prev,
      [source.id]: { status: 'failed', reason, message: message ?? SOURCE_FAILURE_MESSAGES[reason] },
    }))
  }, [])

  const selectSource = (sourceId: string) => {
    setSelectedSourceId(sourceId)
    if (failedSourceIds.has(sourceId)) setSourceStates((prev) => withoutSource(prev, sourceId))
  }

  const retryActiveSource = () => {
    if (!activeSource) return
    setSourceStates((prev) => withoutSource(prev, activeSource.id))
    setExtractionAttempt((attempt) => attempt + 1)
  }

  const reloadPlayer = () => setPlayerReload((count) => count + 1)

  const revealIframe = (loadedKey: string) => {
    if (iframeRevealTimerRef.current !== null) window.clearTimeout(iframeRevealTimerRef.current)
    iframeRevealTimerRef.current = window.setTimeout(() => {
      setLoadedIframeKey(loadedKey)
      iframeRevealTimerRef.current = null
    }, IFRAME_REVEAL_DELAY_MS)
  }

  useEffect(() => () => {
    if (iframeRevealTimerRef.current !== null) window.clearTimeout(iframeRevealTimerRef.current)
  }, [])

  useEffect(() => {
    const previousId = previousActiveSourceIdRef.current
    previousActiveSourceIdRef.current = activeSource?.id ?? null
    if (!activeSource || !previousId || previousId === activeSource.id) return
    playerDebug('switching source', {
      from: previousId,
      to: activeSource.id,
      label: getSourceLabel(activeSource),
      reason: selectedSourceId === activeSource.id ? 'user' : 'auto-fallback',
    })
  }, [activeSource, selectedSourceId])

  // A new playback session retries sources that failed in the previous one.
  useEffect(() => {
    if (playbackRequested) return
    setLoadedIframeKey(null)
    setSourceStates((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([, state]) => state.status === 'ready'))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [playbackRequested])

  useEffect(() => {
    if (!playbackRequested || !activeSource?.sourceUrl || !isDynamic) return
    const existing = sourceStatesRef.current[activeSource.id]
    if (existing?.status === 'ready' || existing?.status === 'failed') return

    const source = activeSource
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, EXTRACTION_TIMEOUT_MS)

    playerDebug('loading source', { sourceId: source.id, label: getSourceLabel(source), host: urlHost(source.sourceUrl) })
    setSourceStates((prev) => ({ ...prev, [source.id]: { status: 'extracting' } }))

    extractPlayer(source.sourceUrl, controller.signal)
      .then((data) => {
        window.clearTimeout(timeout)
        if (data.embedBlocked) {
          playerDebug('provider refused embedding', {
            sourceId: source.id,
            host: urlHost(data.extractedUrl),
            reason: data.embedBlocked,
          })
          markSourceFailed(source, 'embed-blocked')
          return
        }
        if (!isEmbeddableUrl(data.extractedUrl, source.sourceUrl)) {
          markSourceFailed(source, 'no-player')
          return
        }
        const extractedUrl = data.extractedUrl
        setSourceStates((prev) => ({ ...prev, [source.id]: { status: 'ready', extractedUrl } }))
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeout)
        if (controller.signal.aborted && !timedOut) return
        if (!timedOut) console.error('Extractor failed:', error)
        markSourceFailed(source, timedOut ? 'extract-timeout' : 'extract-error')
      })

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
      // Drop an interrupted extraction so the source is fetched again next time.
      setSourceStates((prev) => (
        prev[source.id]?.status === 'extracting' ? withoutSource(prev, source.id) : prev
      ))
    }
  }, [activeSource, isDynamic, playbackRequested, extractionAttempt, markSourceFailed])

  useEffect(() => {
    if (!playbackRequested || !iframeKey) return
    logIframeConfiguration('streaming-player')
  }, [playbackRequested, iframeKey])

  useEffect(() => {
    if (!playbackRequested || !iframeKey || iframeLoaded || !activeSource) return
    const source = activeSource
    const timeout = window.setTimeout(() => markSourceFailed(source, 'load-timeout'), IFRAME_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timeout)
  }, [playbackRequested, iframeKey, iframeLoaded, activeSource, markSourceFailed])

  return {
    activeSource,
    activeState,
    isDynamic,
    extractedUrl,
    iframeKey,
    iframeLoaded,
    fallbackSource,
    selectSource,
    retryActiveSource,
    reloadPlayer,
    revealIframe,
    markSourceFailed,
  }
}
