import {
  AlertCircle,
  ChevronDown,
  Info,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../../api/client'
import { getTvSeasonDetails } from '../../api/tmdb'
import { useVideoDiagnostics } from '../../hooks/useVideoDiagnostics'
import type { MediaSource } from '../../types/media-source'
import type { Episode, MediaType } from '../../types/tmdb'
import { imageUrl } from '../../utils/images'

const EXTRACTION_TIMEOUT_MS = 15_000
const IFRAME_LOAD_TIMEOUT_MS = 12_000
const IFRAME_REVEAL_DELAY_MS = 180

type DynamicPlayerStatus = 'idle' | 'extracting' | 'ready' | 'error'

function isDynamicSource(source: MediaSource | undefined) {
  if (!source) return false
  const sourceUrl = source.sourceUrl.toLowerCase()
  return Boolean(source.isDynamic || sourceUrl.includes('flixbaba') || sourceUrl.includes('soap2day'))
}

function isEmbeddableUrl(candidate: string | null, wrapperUrl: string) {
  if (!candidate) return false
  try {
    const extracted = new URL(candidate)
    const wrapper = new URL(wrapperUrl, window.location.origin)
    const hostname = extracted.hostname.toLowerCase()
    return extracted.protocol === 'https:'
      && extracted.href !== wrapper.href
      && !hostname.includes('flixbaba')
      && !hostname.includes('soap2day')
  } catch {
    return false
  }
}

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const totalSeconds = Math.floor(seconds)
  const minutes = Math.floor(totalSeconds / 60)
  const remainingSeconds = totalSeconds % 60
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

interface StreamingPlayerProps {
  id: number
  mediaType: MediaType
  title: string
  numberOfSeasons?: number | null
  sources: MediaSource[]
  theaterMode: boolean
  onTheaterModeChange: (open: boolean) => void
}

export function StreamingPlayer({
  id,
  mediaType,
  title,
  numberOfSeasons,
  sources,
  theaterMode,
  onTheaterModeChange,
}: StreamingPlayerProps) {
  const initialSource = sources[0]
  const [activeSeason, setActiveSeason] = useState(initialSource?.seasonNumber ?? 1)
  const [activeEpisode, setActiveEpisode] = useState(initialSource?.episodeNumber ?? 1)
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(mediaType === 'tv')
  const [episodesError, setEpisodesError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<{ sourceId: string; message: string } | null>(null)
  const [extractedUrl, setExtractedUrl] = useState<string | null>(null)
  const [dynamicPlayerStatus, setDynamicPlayerStatus] = useState<DynamicPlayerStatus>('idle')
  const [dynamicPlayerError, setDynamicPlayerError] = useState<string | null>(null)
  const [extractionAttempt, setExtractionAttempt] = useState(0)
  const [inlinePlaybackRequested, setInlinePlaybackRequested] = useState(false)
  const [iframeLoaded, setIframeLoaded] = useState(false)
  const [videoCurrentTime, setVideoCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [videoPlaying, setVideoPlaying] = useState(false)
  const [videoMuted, setVideoMuted] = useState(false)
  const [videoVolume, setVideoVolume] = useState(1)
  const videoRef = useRef<HTMLVideoElement>(null)
  const exitButtonRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const iframeRevealTimerRef = useRef<number | null>(null)

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)
  const [failedSourceIds, setFailedSourceIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setSelectedSourceId(null)
    setFailedSourceIds(new Set())
    setInlinePlaybackRequested(false)
  }, [id, activeSeason, activeEpisode])

  useEffect(() => {
    if (!theaterMode) return
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onTheaterModeChange(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    exitButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
      returnFocusRef.current = null
    }
  }, [theaterMode, onTheaterModeChange])

  const playableSources = useMemo(() => {
    if (mediaType === 'movie') {
      return sources
    }
    const dbSources = sources.filter(
      (source) => source.seasonNumber === activeSeason && source.episodeNumber === activeEpisode
    )
    const dynamicSources = sources.filter(
      (source) => source.isDynamic
    ).map((source) => {
      let url = source.sourceUrl
      if (url.includes('{season}') || url.includes('{episode}')) {
        url = url
          .replace(/{season}/g, String(activeSeason))
          .replace(/{episode}/g, String(activeEpisode))
      } else {
        url = `${url}/season/${activeSeason}?e=${activeEpisode}`
      }
      return {
        ...source,
        seasonNumber: activeSeason,
        episodeNumber: activeEpisode,
        sourceUrl: url,
      }
    })
    return [...dbSources, ...dynamicSources]
  }, [sources, mediaType, activeSeason, activeEpisode])

  const activeSource = useMemo(() => {
    if (playableSources.length === 0) return undefined
    const nonFailedSources = playableSources.filter((s) => !failedSourceIds.has(s.id))
    if (nonFailedSources.length > 0) {
      if (selectedSourceId) {
        const selected = nonFailedSources.find((s) => s.id === selectedSourceId)
        if (selected) return selected
      }
      return nonFailedSources[0]
    }
    if (selectedSourceId) {
      const selected = playableSources.find((s) => s.id === selectedSourceId)
      if (selected) return selected
    }
    return playableSources[0]
  }, [playableSources, selectedSourceId, failedSourceIds])
  const activeSourceIsDynamic = isDynamicSource(activeSource)
  const activeSourceIndex = playableSources.findIndex((s) => s.id === activeSource?.id)
  const activeSourceLabel = activeSourceIndex !== -1 ? `Server ${activeSourceIndex + 1}` : (activeSource?.label ?? '')
  const dynamicPlaybackRequested = theaterMode || inlinePlaybackRequested

  const availableSeasons = useMemo(() => {
    const hasDynamic = sources.some((source) => source.isDynamic)
    if (hasDynamic && numberOfSeasons) {
      return Array.from({ length: numberOfSeasons }, (_, i) => i + 1)
    }
    return [...new Set(sources.flatMap((source) => source.seasonNumber ?? []))].sort((a, b) => a - b)
  }, [sources, numberOfSeasons])

  useVideoDiagnostics(
    videoRef,
    `player:${mediaType}:${id}`,
    activeSource?.sourceUrl ?? '',
  )

  useEffect(() => {
    if (mediaType !== 'tv') return
    const controller = new AbortController()
    setLoadingEpisodes(true)
    setEpisodesError(null)
    getTvSeasonDetails(id, activeSeason, controller.signal)
      .then((data) => {
        setEpisodes(data.episodes ?? [])
        setLoadingEpisodes(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setEpisodes([])
        setEpisodesError('Episode metadata is unavailable. Authorised episodes remain playable.')
        setLoadingEpisodes(false)
      })
    return () => controller.abort()
  }, [activeSeason, id, mediaType])

  useEffect(() => {
    if (!dynamicPlaybackRequested || !activeSource || !activeSource.sourceUrl || !activeSourceIsDynamic) {
      setExtractedUrl(null)
      setDynamicPlayerStatus('idle')
      setDynamicPlayerError(null)
      return
    }

    const currentSource = activeSource
    const controller = new AbortController()
    let timedOut = false
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, EXTRACTION_TIMEOUT_MS)

    setDynamicPlayerStatus('extracting')
    setDynamicPlayerError(null)
    setExtractedUrl(null)

    apiRequest<{ extractedUrl: string | null }>(
      `/api/media-sources/extract?url=${encodeURIComponent(currentSource.sourceUrl)}`,
      { signal: controller.signal },
    )
      .then((data) => {
        window.clearTimeout(timeout)
        if (!isEmbeddableUrl(data.extractedUrl, currentSource.sourceUrl)) {
          const otherSource = playableSources.find((s) => s.id !== currentSource.id && !failedSourceIds.has(s.id))
          if (otherSource) {
            setFailedSourceIds((prev) => {
              const next = new Set(prev)
              next.add(currentSource.id)
              return next
            })
          } else {
            setDynamicPlayerStatus('error')
            setDynamicPlayerError('This source did not return a usable embedded player. You can retry or exit safely.')
          }
          return
        }
        setExtractedUrl(data.extractedUrl)
        setDynamicPlayerStatus('ready')
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeout)
        if (controller.signal.aborted && !timedOut) return
        if (!timedOut) console.error('Extractor failed:', error)
        const otherSource = playableSources.find((s) => s.id !== currentSource.id && !failedSourceIds.has(s.id))
        if (otherSource) {
          setFailedSourceIds((prev) => {
            const next = new Set(prev)
            next.add(currentSource.id)
            return next
          })
        } else {
          setDynamicPlayerStatus('error')
          setDynamicPlayerError(
            timedOut
              ? 'The player took too long to prepare. You can retry or exit safely.'
              : 'The player could not be prepared. You can retry or exit safely.',
          )
        }
      })

    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [activeSource, activeSourceIsDynamic, dynamicPlaybackRequested, extractionAttempt, playableSources, failedSourceIds])

  useEffect(() => {
    setIframeLoaded(false)
    if (iframeRevealTimerRef.current !== null) {
      window.clearTimeout(iframeRevealTimerRef.current)
      iframeRevealTimerRef.current = null
    }
    return () => {
      if (iframeRevealTimerRef.current !== null) {
        window.clearTimeout(iframeRevealTimerRef.current)
        iframeRevealTimerRef.current = null
      }
    }
  }, [dynamicPlayerStatus, extractedUrl])

  useEffect(() => {
    if (dynamicPlayerStatus !== 'ready' || !extractedUrl || iframeLoaded || !activeSource) return

    const currentSource = activeSource
    const timeout = window.setTimeout(() => {
      const otherSource = playableSources.find((s) => s.id !== currentSource.id && !failedSourceIds.has(s.id))
      if (otherSource) {
        setFailedSourceIds((prev) => {
          const next = new Set(prev)
          next.add(currentSource.id)
          return next
        })
      } else {
        setDynamicPlayerStatus('error')
        setDynamicPlayerError('The embedded player did not finish loading. You can retry or stop safely.')
      }
    }, IFRAME_LOAD_TIMEOUT_MS)

    return () => window.clearTimeout(timeout)
  }, [dynamicPlayerStatus, extractedUrl, iframeLoaded, activeSource, playableSources, failedSourceIds])



  const catalogEpisodes = useMemo(() => {
    const byEpisode = new Map(episodes.map((episode) => [episode.episode_number, episode]))
    const hasDynamic = sources.some((source) => source.isDynamic)

    if (hasDynamic) {
      return episodes.map((episode) => {
        const dbSource = sources.find(
          (source) => source.seasonNumber === activeSeason && source.episodeNumber === episode.episode_number
        )
        const source = dbSource || {
          id: `dynamic-${activeSeason}-${episode.episode_number}`,
          mediaType: 'tv' as MediaType,
          tmdbId: id,
          seasonNumber: activeSeason,
          episodeNumber: episode.episode_number,
          label: `Episode ${episode.episode_number}`,
          sourceUrl: '',
          mimeType: 'video/mp4' as const,
          rightsBasis: 'licensed' as const
        }
        return { source, episode: byEpisode.get(episode.episode_number) }
      })
    }

    return sources
      .filter((source) => source.seasonNumber === activeSeason && source.episodeNumber !== null)
      .sort((a, b) => (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0))
      .map((source) => ({ source, episode: byEpisode.get(source.episodeNumber!) }))
  }, [activeSeason, episodes, sources, id])

  if (!activeSource) {
    return (
      <section id="streaming-player" aria-labelledby="empty-player-heading" className="scroll-mt-20">
        <div className="mb-4 px-1">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Video player</p>
          <h2 id="empty-player-heading" className="mt-1 text-lg font-black text-white">Authorised playback</h2>
        </div>
        <div className="relative grid aspect-video place-items-center overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10">
          <div className="max-w-lg px-6 text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full border border-amber-300/20 bg-amber-300/10 text-amber-200">
              <Info aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-white">No authorised source is available</h3>
            <p className="mt-2 text-sm leading-6 text-zinc-400">An administrator can add an owned or licensed MP4 or WebM source for this title.</p>
          </div>
        </div>
        <p className="mt-4 rounded-2xl border border-white/7 bg-white/[0.025] p-4 text-xs leading-5 text-zinc-500">
          The player remains visible so playback availability is clear. It will never load an unapproved third-party stream automatically.
        </p>
      </section>
    )
  }

  const currentMediaError = mediaError?.sourceId === activeSource.id ? mediaError.message : null
  const safeDuration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : 0

  const toggleVideoPlayback = () => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => {
        setMediaError({
          sourceId: activeSource.id,
          message: 'The video could not start. Check the source format and host response.',
        })
      })
      return
    }
    video.pause()
  }

  const seekVideo = (time: number) => {
    const video = videoRef.current
    if (!video || !Number.isFinite(time)) return
    video.currentTime = time
    setVideoCurrentTime(time)
  }

  const setVideoMutedState = (muted: boolean) => {
    const video = videoRef.current
    if (!video) return
    video.muted = muted
    setVideoMuted(muted)
  }

  const setVideoVolumeState = (volume: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = volume === 0
    setVideoVolume(volume)
    setVideoMuted(volume === 0)
  }

  const revealIframe = () => {
    if (iframeRevealTimerRef.current !== null) window.clearTimeout(iframeRevealTimerRef.current)
    iframeRevealTimerRef.current = window.setTimeout(() => {
      setIframeLoaded(true)
      iframeRevealTimerRef.current = null
    }, IFRAME_REVEAL_DELAY_MS)
  }

  return (
    <section id="streaming-player" className="scroll-mt-20" aria-labelledby="player-heading">
      <div className={`grid grid-cols-1 gap-6 ${theaterMode || mediaType === 'movie' ? '' : 'lg:grid-cols-3'}`}>
        <div className={theaterMode || mediaType === 'movie' ? 'w-full' : 'lg:col-span-2'}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <h2 id="player-heading" className="mt-1 line-clamp-1 text-lg font-black text-white">
                {title}{mediaType === 'tv' ? ` — S${activeSeason} E${activeEpisode}` : ''}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              {activeSourceIsDynamic && inlinePlaybackRequested && !theaterMode && (
                <button
                  type="button"
                  onClick={() => setInlinePlaybackRequested(false)}
                  className="grid size-10 place-items-center rounded-full bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
                  aria-label="Stop player"
                  title="Stop player"
                >
                  <X size={17} aria-hidden="true" />
                </button>
              )}
              <button
                type="button"
                onClick={() => onTheaterModeChange(true)}
                className="grid size-10 place-items-center rounded-full bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Theater mode"
                title="Theater mode"
              >
                <Maximize2 size={17} aria-hidden="true" />
              </button>
            </div>
          </div>

          {playableSources.length > 1 && (
            <div className="mb-6 flex flex-wrap items-center gap-3.5 px-1 py-1">
              <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Source Server</span>
              <div className="inline-flex rounded-full bg-zinc-950/80 p-1 ring-1 ring-white/10 backdrop-blur">
                {playableSources.map((source, index) => {
                  const isActive = activeSource?.id === source.id
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => {
                        setInlinePlaybackRequested(false)
                        setSelectedSourceId(source.id)
                        setFailedSourceIds((prev) => {
                          const next = new Set(prev)
                          next.delete(source.id)
                          return next
                        })
                      }}
                      className={`inline-flex min-h-8 items-center rounded-full px-4 text-xs font-bold transition-all duration-300 ease-out active:scale-95 ${
                        isActive
                          ? 'bg-white text-zinc-950 shadow-lg shadow-white/10 font-semibold'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Server {index + 1}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Promoted to full-viewport with CSS rather than reparented — moving the
              iframe/video in the DOM would remount it and restart playback. */}
          <div
            className={
              theaterMode
                ? 'fixed inset-0 z-50 flex items-center justify-center bg-black'
                : 'relative overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10'
            }
          >
            {theaterMode && (
              <button
                ref={exitButtonRef}
                type="button"
                onClick={() => onTheaterModeChange(false)}
                className="absolute right-4 top-4 z-20 grid size-11 place-items-center rounded-full bg-black/70 text-zinc-200 ring-1 ring-white/15 backdrop-blur transition hover:bg-black/90 hover:text-white"
                aria-label="Exit theater mode"
              >
                <Minimize2 size={18} aria-hidden="true" />
              </button>
            )}
            {activeSourceIsDynamic ? (
              !dynamicPlaybackRequested ? (
                <div className="grid aspect-video size-full place-items-center bg-black px-6 text-center">
                  <div className="max-w-md">
                    <span className="mx-auto grid size-14 place-items-center rounded-full border border-white/10 bg-white/5 text-zinc-300">
                      <Play size={20} fill="currentColor" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-white">Ready when you are</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Start playback here, or use Theater mode for a larger view.
                    </p>
                    <button
                      type="button"
                      onClick={() => setInlinePlaybackRequested(true)}
                      className="mt-5 min-h-11 rounded-xl bg-white px-5 text-sm font-black text-black transition hover:bg-zinc-200"
                    >
                      Play {mediaType === 'movie' ? 'movie' : 'episode'}
                    </button>
                  </div>
                </div>
              ) : dynamicPlayerStatus === 'ready' && extractedUrl ? (
                <div className={`relative size-full bg-black ${theaterMode ? '' : 'aspect-video'}`}>
                  <iframe
                    src={extractedUrl}
                    className={`block size-full border-0 bg-black object-contain transition-opacity duration-200 ${iframeLoaded ? 'opacity-100' : 'opacity-0'}`}
                    allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                    allowFullScreen
                    sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
                    aria-label={`Video player for ${title}`}
                    onLoad={revealIframe}
                  />
                  {!iframeLoaded && (
                    <div role="status" className="absolute inset-0 z-10 grid place-items-center bg-black px-6 text-center">
                      <div>
                        <div className="mx-auto size-8 animate-spin rounded-full border border-white/10 border-t-white" />
                        <p className="mt-4 text-sm font-semibold text-zinc-300">
                          Loading player ({activeSourceLabel})…
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              ) : dynamicPlayerStatus === 'error' ? (
                <div className={`grid size-full place-items-center bg-black px-6 text-center ${theaterMode ? '' : 'aspect-video'}`}>
                  <div role="alert" className="max-w-md">
                    <span className="mx-auto grid size-14 place-items-center rounded-full border border-red-400/20 bg-red-400/10 text-red-200">
                      <AlertCircle aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 text-lg font-semibold text-white">Player unavailable</h3>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">{dynamicPlayerError}</p>
                    <div className="mt-5 flex flex-wrap justify-center gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setFailedSourceIds(new Set())
                          setMediaError(null)
                          setDynamicPlayerError(null)
                          setExtractionAttempt((attempt) => attempt + 1)
                        }}
                        className="min-h-11 rounded-xl bg-white px-5 text-sm font-black text-black transition hover:bg-zinc-200"
                      >
                        Retry player
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setInlinePlaybackRequested(false)
                          onTheaterModeChange(false)
                        }}
                        className="min-h-11 rounded-xl border border-white/15 bg-white/5 px-5 text-sm font-black text-white transition hover:bg-white/10"
                      >
                        Stop player
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div role="status" className={`grid size-full place-items-center bg-black px-6 text-center ${theaterMode ? '' : 'aspect-video'}`}>
                  <div>
                    <div className="mx-auto size-8 animate-spin rounded-full border border-white/10 border-t-white" />
                    <p className="mt-4 text-sm font-semibold text-zinc-300">
                      Preparing player ({activeSourceLabel})…
                    </p>
                  </div>
                </div>
              )
            ) : (
              <>
                <video
                  ref={videoRef}
                  src={activeSource.sourceUrl}
                  playsInline
                  preload="metadata"
                  className={`block size-full bg-black object-contain ${theaterMode ? '' : 'aspect-video'}`}
                  aria-label={`Video player for ${title}`}
                  onDoubleClick={(event) => event.preventDefault()}
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget
                    setMediaError(null)
                    setVideoDuration(video.duration)
                    setVideoCurrentTime(video.currentTime)
                    setVideoVolume(video.volume)
                    setVideoMuted(video.muted)
                  }}
                  onDurationChange={(event) => setVideoDuration(event.currentTarget.duration)}
                  onTimeUpdate={(event) => setVideoCurrentTime(event.currentTarget.currentTime)}
                  onPlay={() => setVideoPlaying(true)}
                  onPause={() => setVideoPlaying(false)}
                  onVolumeChange={(event) => {
                    setVideoMuted(event.currentTarget.muted)
                    setVideoVolume(event.currentTarget.volume)
                  }}
                  onError={(event) => {
                    const video = event.currentTarget
                    const errorMessage = video.error?.message || 'The authorised video could not be loaded. Check the source format and host response.'
                    const otherSource = playableSources.find((s) => s.id !== activeSource.id && !failedSourceIds.has(s.id))
                    if (otherSource) {
                      setFailedSourceIds((prev) => {
                        const next = new Set(prev)
                        next.add(activeSource.id)
                        return next
                      })
                    } else {
                      setMediaError({
                        sourceId: activeSource.id,
                        message: errorMessage,
                      })
                    }
                  }}
                />
                <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-3 pb-3 pt-12 sm:px-4 sm:pb-4">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-200">
                    <button
                      type="button"
                      onClick={toggleVideoPlayback}
                      className="grid size-10 shrink-0 place-items-center rounded-full bg-white text-black transition hover:bg-zinc-200"
                      aria-label={videoPlaying ? 'Pause video' : 'Play video'}
                    >
                      {videoPlaying ? <Pause size={17} fill="currentColor" aria-hidden="true" /> : <Play size={17} fill="currentColor" aria-hidden="true" />}
                    </button>
                    <span className="shrink-0 tabular-nums" aria-live="off">{formatPlaybackTime(videoCurrentTime)} / {formatPlaybackTime(safeDuration)}</span>
                    <input
                      type="range"
                      min="0"
                      max={safeDuration || 0}
                      step="0.1"
                      value={Math.min(videoCurrentTime, safeDuration || 0)}
                      onChange={(event) => seekVideo(Number(event.target.value))}
                      disabled={safeDuration === 0}
                      className="min-w-20 flex-1 accent-white disabled:opacity-40"
                      aria-label="Seek video"
                    />
                    <button
                      type="button"
                      onClick={() => setVideoMutedState(!videoMuted)}
                      className="grid size-10 shrink-0 place-items-center rounded-full text-zinc-100 transition hover:bg-white/10"
                      aria-label={videoMuted ? 'Unmute video' : 'Mute video'}
                    >
                      {videoMuted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={videoMuted ? 0 : videoVolume}
                      onChange={(event) => setVideoVolumeState(Number(event.target.value))}
                      className="w-20 accent-white sm:w-24"
                      aria-label="Video volume"
                    />
                  </div>
                </div>
              </>
            )}
          </div>



          {currentMediaError && (
            <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/8 px-4 py-3 text-sm text-red-200">
              <AlertCircle className="mt-0.5 shrink-0" size={17} aria-hidden="true" />
              {currentMediaError}
            </p>
          )}
        </div>

        {mediaType === 'tv' && !theaterMode && (
          <aside className="flex flex-col rounded-3xl border border-white/7 bg-white/[0.025] p-4" aria-labelledby="episodes-heading">
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/7 pb-3">
              <div>
                <h3 id="episodes-heading" className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-white">
                  <Play size={12} className="fill-current" aria-hidden="true" />Authorised episodes
                </h3>
                <p className="mt-1 text-[10px] text-zinc-500">{numberOfSeasons ?? availableSeasons.length} catalog season(s)</p>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setSeasonDropdownOpen((current) => !current)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-white hover:bg-white/10"
                >
                  Season {activeSeason}<ChevronDown size={14} aria-hidden="true" />
                </button>
                {seasonDropdownOpen && (
                  <div className="absolute right-0 z-30 mt-1.5 max-h-48 w-32 overflow-y-auto rounded-2xl border border-white/7 bg-zinc-950 py-1 shadow-2xl">
                    {availableSeasons.map((seasonNumber) => (
                      <button
                        key={seasonNumber}
                        type="button"
                        onClick={() => {
                          const firstSource = sources.find((source) => source.seasonNumber === seasonNumber)
                          setActiveSeason(seasonNumber)
                          setActiveEpisode(firstSource?.episodeNumber ?? 1)
                          setSeasonDropdownOpen(false)
                        }}
                        className={`w-full px-3 py-2.5 text-left text-xs font-bold hover:bg-white/5 ${activeSeason === seasonNumber ? 'bg-white/5 text-white' : 'text-zinc-400'}`}
                      >
                        Season {seasonNumber}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="max-h-[500px] flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-subtle">
              {loadingEpisodes && <p role="status" className="py-6 text-center text-xs text-zinc-500">Loading episode details…</p>}
              {episodesError && <p className="rounded-xl bg-amber-300/5 px-3 py-2 text-xs text-amber-100">{episodesError}</p>}
              {catalogEpisodes.map(({ source, episode }) => {
                const selected = source.id === activeSource.id
                const stillUrl = imageUrl(episode?.still_path, 'w185')
                return (
                  <button
                    key={source.id}
                    type="button"
                    onClick={() => setActiveEpisode(source.episodeNumber!)}
                    aria-pressed={selected}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-2 text-left transition ${selected ? 'border-white/20 bg-white/10 text-white' : 'border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
                      {stillUrl ? <img src={stillUrl} alt="" className="size-full object-cover" loading="lazy" /> : <span className="grid size-full place-items-center"><Play size={14} aria-hidden="true" /></span>}
                      <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-[8px] font-black text-zinc-200">EP {source.episodeNumber}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-1 block text-xs font-black">{episode?.name || source.label}</span>
                      <span className="mt-1 line-clamp-2 block text-[9px] leading-relaxed text-zinc-500">{episode?.overview || 'Authorised episode available.'}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}
