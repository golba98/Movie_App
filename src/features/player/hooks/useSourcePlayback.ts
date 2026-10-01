import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MediaSource, SubtitleContext } from '../../../types/media-source'
import { subtitleFitsRuntime } from '../../../lib/subtitle-timing'
import { ApiClientError } from '../../../lib/api-client'
import { extractPlayer } from '../api'
import { logIframeConfiguration, playerDebug, urlHost } from '../player-debug'
import { readViewingSession, writeViewingSession, sourceFingerprint } from '../viewing-session'
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
  accountId: string | null
  mediaKey: string
  // A new key (another title or episode) forgets every source's state.
  resetKey: string
  // The viewer asked a dynamic source to play, inline or in theater mode.
  playbackRequested: boolean
}

/**
 * Chooses which source plays and drives dynamic sources through extraction
 * and iframe loading. A failed source switches to another available source.
 */
export function useSourcePlayback({ playableSources, resetKey, playbackRequested, accountId, mediaKey }: SourcePlaybackOptions) {
  const savedSession = useMemo(() => readViewingSession(accountId, mediaKey), [accountId, mediaKey])
  const subtitleContextRef = useRef<{ mediaKey: string; sourceId: string; context: SubtitleContext } | null>(null)
  const correctedRef = useRef(new Set<string>())
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  // This source advanced inside its own frame. Keep that live frame until
  // the viewer requests a new player; its original URL now names an old episode.
  const [followingSourceId, setFollowingSourceId] = useState<string | null>(null)
  const [sourceStates, setSourceStates] = useState<SourceStates>({})
  const [extractionAttempt, setExtractionAttempt] = useState(0)
  const [loadedIframeKey, setLoadedIframeKey] = useState<string | null>(null)
  // Bumped by "Reload player" to remount a provider player that got stuck.
  const [playerReload, setPlayerReload] = useState(0)
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null)
  const refreshSourceIdRef = useRef<string | null>(null)
  const sourceStatesRef = useRef(sourceStates)
  const previousActiveSourceIdRef = useRef<string | null>(null)
  const iframeRevealTimerRef = useRef<number | null>(null)

  useEffect(() => {
    sourceStatesRef.current = sourceStates
  }, [sourceStates])

  useEffect(() => {
    setSelectedSourceId(null)
    setFollowingSourceId(null)
    // Cleared now as well: when playback carries on into the next episode, the
    // extraction effect below runs in this same commit and must not mistake
    // the previous episode's player for this one's.
    sourceStatesRef.current = {}
    setSourceStates({})
    setLoadedIframeKey(null)
    setPlayerReload(0)
    setFallbackNotice(null)
    refreshSourceIdRef.current = null
  }, [resetKey])

  const failedSourceIds = useMemo(
    () => new Set(Object.keys(sourceStates).filter((sourceId) => sourceStates[sourceId].status === 'failed')),
    [sourceStates],
  )

  const activeSource = useMemo(() => {
    if (playableSources.length === 0) return undefined
    const selected = selectedSourceId ? playableSources.find((source) => source.id === selectedSourceId) : undefined
    const remembered = savedSession ? playableSources.find((source) => source.id === savedSession.sourceId
      && sourceFingerprint(source) === savedSession.sourceFingerprint && !failedSourceIds.has(source.id)) : undefined
    return selected ?? remembered ?? playableSources.find((source) => !failedSourceIds.has(source.id)) ?? playableSources[0]
  }, [playableSources, selectedSourceId, failedSourceIds, savedSession])

  const isDynamic = isDynamicSource(activeSource)
  const cachedState = activeSource ? sourceStates[activeSource.id] : undefined
  const activeState = cachedState?.status === 'ready'
    && cachedState.sourceUrl !== activeSource?.sourceUrl
    && followingSourceId !== activeSource?.id
    ? undefined
    : cachedState
  const extractedUrl = activeState?.status === 'ready' ? activeState.extractedUrl : null
  const playbackKind = activeState?.status === 'ready' ? activeState.playbackKind : 'embed'
  const iframeKey = activeSource && extractedUrl && playbackKind === 'embed' ? `${activeSource.id}|${extractedUrl}|${playerReload}` : null
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
    const next = playableSources.find((candidate) => candidate.id !== source.id && sourceStatesRef.current[candidate.id]?.status !== 'failed')
    if (next) {
      setSelectedSourceId(next.id)
      setFallbackNotice(`${getSourceLabel(source)} is unavailable. Trying ${getSourceLabel(next)}.`)
    }
  }, [playableSources])

  const selectSource = (sourceId: string) => {
    setSelectedSourceId(sourceId)
    setFollowingSourceId(null)
    setFallbackNotice(null)
    if (failedSourceIds.has(sourceId)) setSourceStates((prev) => withoutSource(prev, sourceId))
  }

  const retryActiveSource = () => {
    if (!activeSource) return
    setFollowingSourceId(null)
    refreshSourceIdRef.current = activeSource.id
    setSourceStates((prev) => withoutSource(prev, activeSource.id))
    setExtractionAttempt((attempt) => attempt + 1)
  }

  const reloadPlayer = () => {
    retryActiveSource()
    setPlayerReload((count) => count + 1)
  }

  const followProviderEpisode = () => {
    if (!activeSource || activeState?.status !== 'ready') return
    // Pin the provider even if the newly selected episode has a catalog source.
    setSelectedSourceId(activeSource.id)
    // A custom track cannot follow an episode change inside an opaque frame.
    if (activeState.subtitles || new URL(activeState.extractedUrl).searchParams.has('sub_url')) {
      setFollowingSourceId(null)
      sourceStatesRef.current = {}
      setSourceStates({})
      setLoadedIframeKey(null)
      return
    }
    setFollowingSourceId(activeSource.id)
    const retained = { [activeSource.id]: activeState }
    sourceStatesRef.current = retained
    setSourceStates(retained)
    setFallbackNotice(null)
  }

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
    setFollowingSourceId(null)
    setFallbackNotice(null)
    setLoadedIframeKey(null)
    setSourceStates((prev) => {
      const next = Object.fromEntries(Object.entries(prev).filter(([sourceId, state]) => (
        state.status === 'ready' && playableSources.some((source) => source.id === sourceId && source.sourceUrl === state.sourceUrl)
      )))
      return Object.keys(next).length === Object.keys(prev).length ? prev : next
    })
  }, [playbackRequested, playableSources])

  useEffect(() => {
    if (!playbackRequested || !activeSource?.sourceUrl || !isDynamic) return
    const existing = sourceStatesRef.current[activeSource.id]
    if (existing?.status === 'failed') return
    if (existing?.status === 'ready'
      && (existing.sourceUrl === activeSource.sourceUrl || followingSourceId === activeSource.id)) return

    const source = activeSource
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, EXTRACTION_TIMEOUT_MS)

    playerDebug('loading source', { sourceId: source.id, label: getSourceLabel(source), host: urlHost(source.sourceUrl) })
    setSourceStates((prev) => ({ ...prev, [source.id]: { status: 'extracting' } }))

    const refresh = refreshSourceIdRef.current === source.id
    if (refresh) refreshSourceIdRef.current = null
    const observed = subtitleContextRef.current
    const stored = savedSession?.sourceId === source.id && savedSession.sourceFingerprint === sourceFingerprint(source) ? savedSession : null
    const context = observed?.mediaKey === mediaKey && observed.sourceId === source.id ? observed.context : {
      observedDuration: stored?.duration, releaseFingerprint: stored?.releaseFingerprint ?? stored?.subtitles?.releaseFingerprint,
      subtitleId: stored?.subtitles?.id,
    }
    extractPlayer(source.sourceUrl, controller.signal, refresh, context)
      .then((data) => {
        window.clearTimeout(timeout)
        if (controller.signal.aborted) return
        if (data.embedBlocked) {
          playerDebug('provider refused embedding', {
            sourceId: source.id,
            host: urlHost(data.extractedUrl),
            reason: data.embedBlocked,
          })
          markSourceFailed(source, 'embed-blocked')
          return
        }
        const kind = data.playbackKind ?? 'embed'
        if (!isEmbeddableUrl(data.extractedUrl, source.sourceUrl, kind)) {
          markSourceFailed(source, 'no-player')
          return
        }
        const extractedUrl = data.extractedUrl
        setSourceStates((prev) => ({ ...prev, [source.id]: { status: 'ready', sourceUrl: source.sourceUrl, extractedUrl, playbackKind: kind, subtitles: data.subtitles, subtitleNotice: data.subtitleNotice, subtitleContext: data.subtitleContext } }))
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeout)
        if (controller.signal.aborted && !timedOut) return
        if (!timedOut) console.error('Extractor failed:', error)
        const providerUnavailable = error instanceof ApiClientError && error.code === 'PROVIDER_UNAVAILABLE'
        const providerTimeout = error instanceof ApiClientError && error.code === 'PROVIDER_TIMEOUT'
        markSourceFailed(source, timedOut || providerTimeout ? 'extract-timeout' : providerUnavailable ? 'provider-unavailable' : 'extract-error')
      })

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
      // Drop an interrupted extraction so the source is fetched again next time.
      setSourceStates((prev) => (
        prev[source.id]?.status === 'extracting' ? withoutSource(prev, source.id) : prev
      ))
    }
  }, [activeSource, isDynamic, playbackRequested, extractionAttempt, markSourceFailed, followingSourceId, savedSession, mediaKey])

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

  useEffect(() => {
    if (!activeSource || (isDynamic && activeState?.status !== 'ready')) return
    const previous = readViewingSession(accountId, mediaKey)
    const matches = previous?.sourceFingerprint === sourceFingerprint(activeSource)
    writeViewingSession(accountId, mediaKey, {
      sourceId: activeSource.id, sourceFingerprint: sourceFingerprint(activeSource),
      duration: matches ? previous?.duration : undefined,
      releaseFingerprint: activeState?.status === 'ready' ? activeState.subtitleContext?.releaseFingerprint : undefined,
      subtitles: activeState?.status === 'ready' ? activeState.subtitles : null,
    })
    if (activeState?.status === 'ready') {
      playerDebug('subtitle session resolved', {
        media: mediaKey, sourceId: activeSource.id, subtitleId: activeState.subtitles?.id ?? null,
        provider: activeState.subtitles?.provider ?? null, language: activeState.subtitles?.language ?? null,
        release: activeState.subtitleContext?.releaseFingerprint ?? null,
        runtime: activeState.subtitleContext?.runtimeSeconds ?? null,
        lastCue: activeState.subtitles?.lastCueSeconds ?? null, captionReadiness: 'provider-owned', activeCue: 'unavailable',
      })
    }
  }, [accountId, mediaKey, activeSource, activeState, isDynamic])

  // Called only for accepted media reports, never startup positions held by resume.
  const observeDuration = (duration: number) => {
    if (!activeSource || !Number.isFinite(duration) || duration <= 0 || duration > 86400) return false
    const subtitles = activeState?.status === 'ready' ? activeState.subtitles : null
    const release = activeState?.status === 'ready' ? activeState.subtitleContext : undefined
    const context = { observedDuration: duration, releaseFingerprint: release?.releaseFingerprint ?? subtitles?.releaseFingerprint, subtitleId: subtitles?.id }
    subtitleContextRef.current = { mediaKey, sourceId: activeSource.id, context }
    writeViewingSession(accountId, mediaKey, {
      sourceId: activeSource.id, sourceFingerprint: sourceFingerprint(activeSource), duration, subtitles, releaseFingerprint: context.releaseFingerprint,
    })
    const cueMismatch = subtitles?.lastCueSeconds != null && !subtitleFitsRuntime(subtitles.lastCueSeconds, duration)
    const runtimeMismatch = release?.runtimeSeconds != null && Math.abs(release.runtimeSeconds - duration) > Math.max(5, duration * 0.02)
    if (!context.releaseFingerprint || (!cueMismatch && !runtimeMismatch)) return false
    const correctionKey = `${mediaKey}:${activeSource.id}:${context.releaseFingerprint}:${Math.round(duration)}`
    if (correctedRef.current.has(correctionKey)) return false
    correctedRef.current.add(correctionKey)
    playerDebug('subtitle runtime mismatch; selecting again', { media: mediaKey, duration,
      lastCue: subtitles?.lastCueSeconds, subtitleId: subtitles?.id, release: context.releaseFingerprint })
    // Keep the confirmed position in history before replacing the frame.
    setSourceStates((prev) => withoutSource(prev, activeSource.id))
    setExtractionAttempt((attempt) => attempt + 1)
    return true
  }

  return {
    activeSource,
    activeState,
    isDynamic,
    extractedUrl,
    playbackKind,
    fallbackNotice,
    iframeKey,
    iframeLoaded,
    fallbackSource,
    selectSource,
    retryActiveSource,
    reloadPlayer,
    followProviderEpisode,
    revealIframe,
    markSourceFailed,
    observeDuration,
    subtitleNotice: activeState?.status === 'ready' ? activeState.subtitleNotice : null,
  }
}
