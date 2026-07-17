import {
  AlertCircle,
  ChevronDown,
  Info,
  Maximize2,
  Minimize2,
  Play,
  ShieldCheck,
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
}

export function StreamingPlayer({
  id,
  mediaType,
  title,
  numberOfSeasons,
  sources,
}: StreamingPlayerProps) {
  const initialSource = sources[0]
  const [activeSeason, setActiveSeason] = useState(initialSource?.seasonNumber ?? 1)
  const [activeEpisode, setActiveEpisode] = useState(initialSource?.episodeNumber ?? 1)
  const [theaterMode, setTheaterMode] = useState(false)
  const [seasonDropdownOpen, setSeasonDropdownOpen] = useState(false)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(mediaType === 'tv')
  const [episodesError, setEpisodesError] = useState<string | null>(null)
  const [mediaError, setMediaError] = useState<{ sourceId: string; message: string } | null>(null)
  const [extractedUrl, setExtractedUrl] = useState<string | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const activeSource = useMemo(() => {
    if (mediaType === 'movie') {
      return sources[0]
    }
    const dbSource = sources.find(
      (source) => source.seasonNumber === activeSeason && source.episodeNumber === activeEpisode
    )
    if (dbSource) return dbSource

    const dynamicSource = sources.find(
      (source) => source.id === 'flixbaba' || source.id === 'soap2day'
    )
    if (dynamicSource) {
      const url = dynamicSource.id === 'flixbaba'
        ? `${dynamicSource.sourceUrl}/season/${activeSeason}?e=${activeEpisode}`
        : `${dynamicSource.sourceUrl}/${activeSeason}/${activeEpisode}`
      return {
        ...dynamicSource,
        seasonNumber: activeSeason,
        episodeNumber: activeEpisode,
        sourceUrl: url,
      }
    }
    return undefined
  }, [sources, mediaType, activeSeason, activeEpisode])

  const availableSeasons = useMemo(() => {
    const hasDynamic = sources.some((source) => source.id === 'flixbaba' || source.id === 'soap2day')
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

    const isIframe = activeSource.sourceUrl.includes('flixbaba') || activeSource.sourceUrl.includes('soap2day')
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
    const hasDynamic = sources.some((source) => source.id === 'flixbaba' || source.id === 'soap2day')

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
          rightsBasis: 'public-domain' as const
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
            <p className="mt-2 text-sm leading-6 text-zinc-400">An administrator can add an owned, licensed, or public-domain MP4 or WebM source for this title.</p>
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
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Authorised direct media</p>
              <h2 id="player-heading" className="mt-1 line-clamp-1 text-lg font-black text-white">
                {title}{mediaType === 'tv' ? ` — S${activeSeason} E${activeEpisode}` : ''}
              </h2>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/8 px-3 text-[11px] font-bold text-emerald-200">
                <ShieldCheck size={14} aria-hidden="true" />
                {activeSource.rightsBasis.replace('-', ' ')}
              </span>
              <button
                type="button"
                onClick={() => setTheaterMode((current) => !current)}
                className="grid size-10 place-items-center rounded-full bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white"
                aria-label={theaterMode ? 'Exit theater mode' : 'Theater mode'}
                title={theaterMode ? 'Exit theater mode' : 'Theater mode'}
              >
                {theaterMode ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
              </button>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10">
            {isExtracting && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black/95 text-zinc-450 backdrop-blur-md">
                <div className="size-8 animate-spin rounded-full border-2 border-zinc-700 border-t-white" />
                <span className="mt-4 text-xs font-black tracking-widest uppercase text-zinc-350">
                  De-wrapping Streaming Player...
                </span>
                <span className="mt-1 text-[10px] text-zinc-505 font-medium">Extracting direct video source to block ads</span>
              </div>
            )}
            {activeSource.sourceUrl.includes('flixbaba') || activeSource.sourceUrl.includes('soap2day') ? (
              <iframe
                src={extractedUrl ?? activeSource.sourceUrl}
                className="block aspect-video size-full bg-black object-contain border-0"
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
                className="block aspect-video size-full bg-black object-contain"
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

          <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-white/7 bg-white/[0.025] p-4">
            <div>
              <p className="text-sm font-semibold text-zinc-200">{activeSource.label}</p>
              {activeSource.sourceUrl.includes('flixbaba') || activeSource.sourceUrl.includes('soap2day') ? (
                <p className="mt-1 text-xs text-zinc-500">
                  {extractedUrl && extractedUrl !== activeSource.sourceUrl ? (
                    <span className="text-emerald-450 font-black">🟢 Direct video stream de-wrapped successfully</span>
                  ) : (
                    <span>External streaming source</span>
                  )}
                  {' · '}
                  <a
                    href={activeSource.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-400 hover:text-brand-300 underline font-bold"
                  >
                    Open raw page
                  </a>
                </p>
              ) : (
                <p className="mt-1 text-xs text-zinc-500">{activeSource.mimeType} · Native HTML5 playback · Capture state does not control playback</p>
              )}
            </div>
            <p className="max-w-lg text-xs leading-5 text-zinc-500">
              {activeSource.sourceUrl.includes('flixbaba') || activeSource.sourceUrl.includes('soap2day')
                ? 'Website layouts and surrounding ads are stripped. The direct embed video is streamed cleanly.'
                : 'Protected DRM or operating-system output restrictions can still prevent third-party media capture. This player does not bypass them.'}
            </p>
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
