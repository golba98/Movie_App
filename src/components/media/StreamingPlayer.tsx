import {
  AlertCircle,
  ChevronDown,
  Info,
  Maximize2,
  Minimize2,
  Play,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../../api/client'
import { getTvSeasonDetails } from '../../api/tmdb'
import { useVideoDiagnostics } from '../../hooks/useVideoDiagnostics'
import type { MediaSource } from '../../types/media-source'
import type { Episode, MediaType } from '../../types/tmdb'
import { imageUrl } from '../../utils/images'

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
  const [isExtracting, setIsExtracting] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null)

  useEffect(() => {
    setSelectedSourceId(null)
  }, [id, activeSeason, activeEpisode])

  useEffect(() => {
    if (!theaterMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onTheaterModeChange(false)
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
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
    if (selectedSourceId) {
      const selected = playableSources.find((s) => s.id === selectedSourceId)
      if (selected) return selected
    }
    return playableSources[0]
  }, [playableSources, selectedSourceId])

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
    if (!activeSource || !activeSource.sourceUrl) {
      setExtractedUrl(null)
      setIsExtracting(false)
      return
    }

    const isIframe = activeSource.sourceUrl.includes('flixbaba') || activeSource.sourceUrl.includes('soap2day') || activeSource.isDynamic
    if (!isIframe) {
      setExtractedUrl(null)
      setIsExtracting(false)
      return
    }

    const controller = new AbortController()
    setIsExtracting(true)
    setExtractedUrl(null)

    apiRequest<{ extractedUrl: string | null }>(
      `/api/media-sources/extract?url=${encodeURIComponent(activeSource.sourceUrl)}`,
      { signal: controller.signal }
    )
      .then((data) => {
        setExtractedUrl(data.extractedUrl ?? activeSource.sourceUrl)
        setIsExtracting(false)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        console.error('Extractor failed:', err)
        setExtractedUrl(activeSource.sourceUrl)
        setIsExtracting(false)
      })

    return () => controller.abort()
  }, [activeSource])



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
            <div className="mb-4 flex flex-wrap items-center gap-2 px-1">
              <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500 mr-1">Source Server:</span>
              {playableSources.map((source) => (
                <button
                  key={source.id}
                  type="button"
                  onClick={() => setSelectedSourceId(source.id)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition duration-200 active:scale-95 ${
                    activeSource?.id === source.id
                      ? 'bg-emerald-500/12 border border-emerald-400/30 text-emerald-300 shadow-md shadow-emerald-500/10'
                      : 'bg-white/5 border border-white/5 text-zinc-400 hover:bg-white/10 hover:border-white/10 hover:text-zinc-200'
                  }`}
                >
                  {source.label.replace(' Stream (Dynamic)', '')}
                </button>
              ))}
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
                type="button"
                onClick={() => onTheaterModeChange(false)}
                className="absolute right-4 top-4 z-20 grid size-11 place-items-center rounded-full bg-black/70 text-zinc-200 ring-1 ring-white/15 backdrop-blur transition hover:bg-black/90 hover:text-white"
                aria-label="Exit theater mode"
              >
                <Minimize2 size={18} aria-hidden="true" />
              </button>
            )}
            {isExtracting && (
              <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/85 backdrop-blur-sm transition-all duration-300">
                <div className="size-8 rounded-full border border-white/10 border-t-white animate-spin" />
              </div>
            )}
            {activeSource.sourceUrl.includes('flixbaba') || activeSource.sourceUrl.includes('soap2day') || activeSource.isDynamic ? (
              <iframe
                src={extractedUrl ?? activeSource.sourceUrl}
                className={`block size-full border-0 bg-black object-contain ${theaterMode ? '' : 'aspect-video'}`}
                allowFullScreen
                allow="autoplay; encrypted-media; picture-in-picture"
                sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
                aria-label={`Video player for ${title}`}
              />
            ) : (
              <video
                ref={videoRef}
                src={activeSource.sourceUrl}
                controls
                playsInline
                preload="metadata"
                className={`block size-full bg-black object-contain ${theaterMode ? '' : 'aspect-video'}`}
                aria-label={`Video player for ${title}`}
                onLoadedMetadata={() => setMediaError(null)}
                onError={(event) => {
                  const video = event.currentTarget
                  setMediaError({
                    sourceId: activeSource.id,
                    message: video.error?.message || 'The authorised video could not be loaded. Check the source format and host response.',
                  })
                }}
              />
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
