import { UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams } from 'react-router'
import { ErrorMessage } from '../../../components/ui/ErrorMessage'
import { useRequest } from '../../../hooks/useRequest'
import { watchPartyEnabled } from '../../../lib/feature-flags'
import { formatResumeTime } from '../../../lib/format'
import type { MediaItem, MediaType, MovieDetails, TvDetails } from '../../../types/tmdb'
import type { EpisodeRef } from '../../../types/watch-history'
import { useFavourites } from '../../favourites/favourites-context'
import { resolveStartEpisode } from '../../player/episodes'
import { StreamingPlayer } from '../../player/StreamingPlayer'
import { useWatchedHistory } from '../../watch-history/watch-history-context'
import { CreateWatchPartyDialog } from '../../watch-party/CreateWatchPartyDialog'
import { getMovieDetails, getTvDetails } from '../api'
import { CastList } from '../CastList'
import { chooseTrailer, detailsToMediaItem, hasWatchProviders, normalizeMediaList } from '../media'
import { MediaRow } from '../MediaRow'
import { PosterImage } from '../PosterImage'
import { TrailerModal } from '../TrailerModal'
import { WatchProviders } from '../WatchProviders'
import { DetailsActions } from './DetailsActions'
import { DetailsBackdrop } from './DetailsBackdrop'
import { DetailsMeta } from './DetailsMeta'
import { DetailsSkeleton } from './DetailsSkeleton'
import { useMediaSources } from './useMediaSources'
import { useModalRouteTransition } from './useModalRouteTransition'

const CAST_LIMIT = 10
const PROVIDER_REGION = 'ZA'
// How long the skeleton lingers over loaded content while it fades out.
const SKELETON_FADE_MS = 220

function moviePlayLabel(resuming: boolean, position: number | null) {
  if (!resuming) return 'Watch Movie'
  return position ? `Resume from ${formatResumeTime(position)}` : 'Resume'
}

function tvPlayLabel(startEpisode: EpisodeRef | null, startsNextEpisode: boolean) {
  if (!startEpisode) return 'Watch Show'
  return `${startsNextEpisode ? 'Watch' : 'Resume'} S${startEpisode.seasonNumber} E${startEpisode.episodeNumber}`
}

function PlayerPlaceholder() {
  return (
    <section id="streaming-player" aria-labelledby="player-loading-heading" className="scroll-mt-20 rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Video player</p>
      <h2 id="player-loading-heading" className="mt-1 text-xl font-black text-white">Checking playback availability…</h2>
      <div className="mt-4 aspect-video animate-pulse rounded-2xl bg-black ring-1 ring-white/10" />
    </section>
  )
}

export function DetailsPage({ mediaType }: { mediaType: MediaType }) {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const validId = Number.isInteger(id) && id > 0
  const location = useLocation()
  const autoplayRequested = Boolean((location.state as { autoplay?: boolean } | null)?.autoplay)

  const loader = useCallback(
    (signal: AbortSignal): Promise<MovieDetails | TvDetails> => {
      if (!validId) return Promise.reject(new Error('This title has an invalid address.'))
      return mediaType === 'movie' ? getMovieDetails(id, signal) : getTvDetails(id, signal)
    },
    [id, mediaType, validId],
  )
  const request = useRequest(loader)
  const { sources: mediaSources, failed: sourceError } = useMediaSources(mediaType, id, validId)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [theaterMode, setTheaterMode] = useState(false)
  const [watchPartyOpen, setWatchPartyOpen] = useState(false)
  const [skeletonMounted, setSkeletonMounted] = useState(true)
  // Theater mode owns Escape while it is open, so the first press only exits
  // the player rather than also closing the details.
  const { visible, close } = useModalRouteTransition(theaterMode)

  const { isFavourite, toggleFavourite } = useFavourites()
  const {
    getResumeTarget,
    getTitleProgress,
    getProgress,
    isEpisodeWatched,
    isMovieWatched,
    toggleMovieWatched,
    backfillTitle,
  } = useWatchedHistory()
  const resumeTarget = mediaType === 'tv' && validId ? getResumeTarget(id) : null
  const resumeTargetWatched = resumeTarget ? isEpisodeWatched(id, resumeTarget.seasonNumber, resumeTarget.episodeNumber) : false
  const movieWatched = mediaType === 'movie' && validId && isMovieWatched(id)
  const movieResume = mediaType === 'movie' && validId && !movieWatched ? getTitleProgress('movie', id) : null
  const movieResumePosition = movieResume ? getProgress('movie', id)?.position ?? null : null

  const data = request.data
  const isDataReady = !request.loading && data !== null

  // The skeleton always renders while data is pending (so switching titles
  // never exposes an empty shell); this flag only keeps it mounted for the
  // fade-out once the details are ready.
  useEffect(() => {
    if (!isDataReady) {
      setSkeletonMounted(true)
      return
    }
    const timer = setTimeout(() => setSkeletonMounted(false), SKELETON_FADE_MS)
    return () => clearTimeout(timer)
  }, [isDataReady])

  const item = useMemo<MediaItem | null>(
    () => (data ? detailsToMediaItem(data, mediaType) : null),
    [data, mediaType],
  )

  // Titles migrated from older history have no artwork snapshot yet.
  useEffect(() => {
    if (item) backfillTitle(item)
  }, [item, backfillTitle])

  // Opening a title from Continue Watching starts playback straight away.
  const autoplayedIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (!autoplayRequested || !item || !mediaSources?.length || autoplayedIdRef.current === id) return
    autoplayedIdRef.current = id
    setTheaterMode(true)
  }, [autoplayRequested, item, mediaSources, id])

  const movie = mediaType === 'movie' ? (data as MovieDetails) : null
  const tv = mediaType === 'tv' ? (data as TvDetails) : null
  const trailer = data ? chooseTrailer(data.videos?.results) : null
  const similar = data ? normalizeMediaList(data.similar?.results ?? [], mediaType) : []
  const cast = data ? (data.credits?.cast ?? []).slice(0, CAST_LIMIT) : []
  const director = movie?.credits?.crew?.find((person) => person.job === 'Director')?.name
  const watchProviders = data?.['watch/providers']?.results?.[PROVIDER_REGION]
  // Name the episode the player will actually open: the unfinished one, or the next after a finished one.
  const tvStartEpisode = resumeTarget && mediaSources
    ? resolveStartEpisode(mediaSources, resumeTarget, resumeTargetWatched)
    : null
  const playLabel = mediaType === 'movie'
    ? moviePlayLabel(Boolean(movieResume), movieResumePosition)
    : tvPlayLabel(tvStartEpisode, resumeTargetWatched)
  const canWatchTogether = watchPartyEnabled && Boolean(mediaSources?.length)

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden p-0 sm:p-6 md:p-10 short:p-0">
      <div
        className={`absolute inset-0 bg-zinc-950/90 transition-opacity duration-200 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />

      {/* While theater mode is open this panel must carry no scale/translate at
          all. Those properties establish a containing block for position:fixed
          descendants even at identity values, which would trap the
          full-viewport player inside this panel. The transition is dropped too,
          otherwise `scale: 1` lingers while animating out to `none`. */}
      <div
        data-lenis-prevent
        className={`scrollbar-hidden relative z-10 w-full max-w-5xl lg:max-w-6xl h-full max-h-none sm:max-h-[85vh] overflow-y-auto rounded-none sm:rounded-3xl border-0 sm:border sm:border-white/10 short:max-h-none short:max-w-none short:rounded-none short:border-0 bg-zinc-950 shadow-2xl ease-out ${
          theaterMode
            ? 'opacity-100 transition-none'
            : `transition-all duration-200 ${visible ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-3 scale-[0.985]'}`
        } motion-reduce:transition-none motion-reduce:transform-none`}
        style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }}
      >
        <button
          type="button"
          onClick={close}
          className="absolute right-4 top-4 z-50 grid size-10 place-items-center rounded-full border border-white/10 bg-zinc-900/80 text-zinc-400 hover:text-white transition"
          aria-label="Close details"
        >
          <X size={18} />
        </button>

        {/* Loading and loaded states share this parent. The skeleton is in
            normal flow while pending, so it reserves the layout; once data is
            ready the content takes the flow and the skeleton becomes an
            absolute overlay that fades out, keeping the panel still. */}
        <div className="relative">
          {isDataReady && data && item && (
            <article className="min-w-0 pb-[calc(3.5rem+env(safe-area-inset-bottom))] sm:pb-20">
              <DetailsBackdrop item={item} />

              <div className="mx-auto -mt-24 max-w-7xl px-4 sm:-mt-32 sm:px-6 lg:px-8">
                <div className="relative grid min-w-0 gap-7 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
                  <div className="mx-auto aspect-[2/3] w-40 overflow-hidden rounded-2xl bg-zinc-900 shadow-2xl shadow-black/50 ring-1 ring-white/10 sm:w-52 md:mx-0 md:w-full">
                    <PosterImage path={item.posterPath} title={item.title} />
                  </div>

                  <div className="min-w-0 pt-0 text-left md:pt-14">
                    <span className="inline-flex rounded-full bg-brand-500/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-brand-400">
                      {mediaType === 'movie' ? 'Movie' : 'TV show'}
                    </span>
                    <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">{item.title}</h1>
                    <DetailsMeta item={item} movie={movie} tv={tv} />

                    <div className="mt-5 flex flex-wrap justify-start gap-2">
                      {(data.genres ?? []).map((genre) => (
                        <span key={genre.id} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">
                          {genre.name}
                        </span>
                      ))}
                    </div>

                    <p className="mt-6 max-w-3xl text-left leading-7 text-zinc-300">
                      {item.overview || 'An overview is not available for this title.'}
                    </p>

                    {movie && (
                      <p className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-400">
                        <UserRound size={17} aria-hidden="true" />
                        <span><strong className="text-zinc-200">Director:</strong> {director ?? 'Not available'}</span>
                      </p>
                    )}

                    <DetailsActions
                      sourceCount={mediaSources?.length ?? null}
                      playLabel={playLabel}
                      onPlay={() => setTheaterMode(true)}
                      onWatchParty={canWatchTogether ? () => setWatchPartyOpen(true) : undefined}
                      onTrailer={trailer ? () => setTrailerOpen(true) : undefined}
                      movieWatched={movieWatched}
                      onToggleWatched={movie ? () => toggleMovieWatched(id) : undefined}
                      favourite={isFavourite(item)}
                      onToggleFavourite={() => toggleFavourite(item)}
                    />
                    {mediaSources?.length === 0 && (
                      <p className="mt-3 text-sm text-zinc-500">
                        {sourceError
                          ? 'Authorised playback availability could not be checked. Legal provider links remain below.'
                          : 'No owned or licensed video is configured for in-app playback.'}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mx-auto mt-14 max-w-7xl space-y-14 px-4 sm:px-6 lg:px-8">
                {mediaSources === null && <PlayerPlaceholder />}
                {mediaSources && mediaSources.length > 0 && (
                  <StreamingPlayer
                    id={id}
                    mediaType={mediaType}
                    title={item.title}
                    media={item}
                    numberOfSeasons={tv?.number_of_seasons}
                    runtime={movie?.runtime}
                    sources={mediaSources}
                    theaterMode={theaterMode}
                    onTheaterModeChange={setTheaterMode}
                  />
                )}
                <section aria-labelledby="cast-heading">
                  <h2 id="cast-heading" className="mb-5 text-2xl font-black">Main cast</h2>
                  <CastList cast={cast} />
                </section>

                {hasWatchProviders(watchProviders) && (
                  <section aria-labelledby="watch-heading">
                    <div className="mb-5">
                      <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-400">South Africa</p>
                      <h2 id="watch-heading" className="mt-1 text-2xl font-black">Where it is legally available</h2>
                    </div>
                    <WatchProviders providers={watchProviders} />
                  </section>
                )}
              </div>

              <div className="mt-14">
                <MediaRow title={`Similar ${mediaType === 'movie' ? 'movies' : 'shows'}`} items={similar} loading={false} error={null} />
              </div>
              <TrailerModal trailer={trailerOpen ? trailer : null} onClose={() => setTrailerOpen(false)} />
              {watchPartyEnabled && (
                <CreateWatchPartyDialog
                  open={watchPartyOpen}
                  onClose={() => setWatchPartyOpen(false)}
                  sources={mediaSources ?? []}
                  mediaType={mediaType}
                  title={item.title}
                  posterPath={item.posterPath}
                  backdropPath={item.backdropPath}
                />
              )}
            </article>
          )}

          {(!isDataReady || skeletonMounted) && !request.error && (
            <div
              aria-hidden={isDataReady}
              className={`z-10 bg-zinc-950 pointer-events-none transition-opacity duration-200 ease-out motion-reduce:transition-none ${
                isDataReady ? 'absolute inset-0 opacity-0' : 'opacity-100'
              }`}
            >
              <DetailsSkeleton mediaType={mediaType} />
            </div>
          )}

          {(request.error || (!request.loading && !data)) && (
            <div className="mx-auto flex min-h-[55vh] max-w-3xl items-center px-4 py-14 sm:px-6">
              <div className="w-full">
                <ErrorMessage message={request.error ?? 'This title could not be found.'} onRetry={request.retry} />
                <button
                  type="button"
                  onClick={close}
                  className="mt-5 inline-flex min-h-11 items-center rounded-xl px-3 font-bold text-brand-400 hover:text-brand-300"
                >
                  Close details
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
