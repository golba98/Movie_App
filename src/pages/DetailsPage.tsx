import { CalendarDays, Clock, Heart, Play, Star, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router'
import { getMediaSources } from '../api/media-sources'
import { getMovieDetails, getTvDetails } from '../api/tmdb'
import { CastList } from '../components/media/CastList'
import { StreamingPlayer } from '../components/media/StreamingPlayer'

import { ErrorMessage } from '../components/ui/ErrorMessage'
import { MediaRow } from '../components/media/MediaRow'
import { PosterImage } from '../components/media/PosterImage'
import { TrailerModal } from '../components/media/TrailerModal'
import { useFavourites } from '../hooks/useFavourites'
import { useRequest } from '../hooks/useRequest'
import type { MediaSource } from '../types/media-source'
import type { MediaItem, MediaType, MovieDetails, TvDetails } from '../types/tmdb'
import { backdropUrl } from '../utils/images'
import {
  chooseTrailer,
  formatDate,
  formatRating,
  formatRuntime,
  normalizeMediaList,
} from '../utils/media'

export function DetailsPage({ mediaType }: { mediaType: MediaType }) {
  const { id: idParam } = useParams()
  const id = Number(idParam)
  const validId = Number.isInteger(id) && id > 0
  const navigate = useNavigate()

  const loader = useCallback(
    (signal: AbortSignal): Promise<MovieDetails | TvDetails> => {
      if (!validId) return Promise.reject(new Error('This title has an invalid address.'))
      return mediaType === 'movie' ? getMovieDetails(id, signal) : getTvDetails(id, signal)
    },
    [id, mediaType, validId],
  )
  const request = useRequest(loader)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [mediaSources, setMediaSources] = useState<MediaSource[] | null>(null)
  const [sourceError, setSourceError] = useState(false)
  const [theaterMode, setTheaterMode] = useState(false)
  const { isFavourite, toggleFavourite } = useFavourites()

  // Transitions & loading delay states
  const [isMounted, setIsMounted] = useState(false)
  const [isClosing, setIsClosing] = useState(false)
  const [showSkeleton, setShowSkeleton] = useState(false)
  const [isFadingOutSkeleton, setIsFadingOutSkeleton] = useState(false)
  const [backdropLoaded, setBackdropLoaded] = useState(false)

  const isDataReady = !request.loading && request.data !== null

  // Prevent background scrolling while modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  // Mount transition trigger
  useEffect(() => {
    setIsMounted(true)
  }, [])

  // Delay skeleton display and control crossfade
  useEffect(() => {
    if (request.loading) {
      setShowSkeleton(false)
      setIsFadingOutSkeleton(false)
      const timer = setTimeout(() => {
        setShowSkeleton(true)
      }, 130)
      return () => clearTimeout(timer)
    } else if (isDataReady) {
      if (showSkeleton) {
        setIsFadingOutSkeleton(true)
        const timer = setTimeout(() => {
          setShowSkeleton(false)
          setIsFadingOutSkeleton(false)
        }, 200)
        return () => clearTimeout(timer)
      }
    }
  }, [request.loading, isDataReady, showSkeleton])

  // Reset backdrop loaded state on ID change
  useEffect(() => {
    setBackdropLoaded(false)
  }, [id])

  const handleClose = useCallback(() => {
    setIsClosing(true)
    setTimeout(() => {
      if (window.history.state && window.history.state.usr && window.history.state.usr.backgroundLocation) {
        navigate(-1)
      } else {
        navigate('/')
      }
    }, 300)
  }, [navigate])

  // Handle escape key closing. Theater mode owns Escape while it is open, so the
  // first press only exits the player rather than also navigating away.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !theaterMode) {
        handleClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleClose, theaterMode])

  useEffect(() => {
    if (!validId) {
      setMediaSources([])
      return
    }
    const controller = new AbortController()
    setMediaSources(null)
    setSourceError(false)
    getMediaSources(mediaType, id, controller.signal)
      .then((response) => setMediaSources(response.sources))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setMediaSources([])
        setSourceError(true)
      })
    return () => controller.abort()
  }, [id, mediaType, validId])

  const data = request.data
  const item = useMemo<MediaItem | null>(() => {
    if (!data) return null
    const isMovie = mediaType === 'movie'
    const title = isMovie ? (data as MovieDetails).title : (data as TvDetails).name
    const date = isMovie ? (data as MovieDetails).release_date : (data as TvDetails).first_air_date
    return {
      id: data.id,
      mediaType,
      title,
      overview: data.overview?.trim() ?? '',
      posterPath: data.poster_path ?? null,
      backdropPath: data.backdrop_path ?? null,
      voteAverage: data.vote_average ?? 0,
      date: date ?? null,
      year: date?.slice(0, 4) || null,
    }
  }, [data, mediaType])

  const movie = mediaType === 'movie' ? (data as MovieDetails) : null
  const tv = mediaType === 'tv' ? (data as TvDetails) : null
  const trailer = data ? chooseTrailer(data.videos?.results) : null
  const similar = data ? normalizeMediaList(data.similar?.results ?? [], mediaType) : []
  const cast = data ? (data.credits?.cast ?? []).slice(0, 10) : []
  const director = movie?.credits?.crew?.find((person) => person.job === 'Director')?.name
  const backdrop = item ? backdropUrl(item.backdropPath) : null
  const favourite = item ? isFavourite(item) : false

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden p-4 sm:p-6 md:p-10">
      {/* Backdrop overlay */}
      <div
        className={`absolute inset-0 bg-zinc-950/80 backdrop-blur-md transition-opacity duration-300 ease-out ${
          isMounted && !isClosing ? 'opacity-100' : 'opacity-0'
        }`}
        onClick={handleClose}
      />

      {/* Details Container Panel.
          While theater mode is open this panel must carry no scale/translate at all.
          Those properties establish a containing block for position:fixed descendants
          even at identity values, which would trap the full-viewport player inside
          this max-w-5xl panel. The transition is dropped too, otherwise `scale: 1`
          lingers for the duration while animating out to `none`. */}
      <div
        className={`relative z-10 w-full max-w-5xl h-full max-h-[92vh] sm:max-h-[85vh] overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl ease-out ${
          theaterMode
            ? 'opacity-100 transition-none'
            : `transition-all duration-300 ${
                isMounted && !isClosing
                  ? 'opacity-100 translate-y-0 scale-100'
                  : 'opacity-0 translate-y-3 scale-[0.985]'
              }`
        } motion-reduce:transition-none motion-reduce:transform-none`}
        style={{
          transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)'
        }}
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={handleClose}
          className="absolute right-4 top-4 z-50 grid size-10 place-items-center rounded-full border border-white/10 bg-zinc-900/80 text-zinc-400 hover:text-white transition"
          aria-label="Close details"
        >
          <X size={18} />
        </button>

        {/* Content & Crossfade Layers */}
        <div className="relative">
          {/* Loaded details content wrapper */}
          <div className={`transition-opacity duration-200 ${isDataReady ? 'opacity-100' : 'opacity-0'}`}>
            {isDataReady && data && item && (
              <article className="min-w-0 pb-14 sm:pb-20">
                <header className="relative isolate min-h-[260px] overflow-hidden sm:min-h-[390px] lg:min-h-[470px]">
                  {backdrop ? (
                    <img
                      src={backdrop}
                      alt=""
                      role="presentation"
                      className={`absolute inset-0 -z-20 size-full object-cover transition-opacity duration-350 ease-out ${
                        backdropLoaded ? 'opacity-100' : 'opacity-0'
                      }`}
                      fetchPriority="high"
                      onLoad={() => setBackdropLoaded(true)}
                    />
                  ) : (
                    <div className="absolute inset-0 -z-20 bg-gradient-to-br from-brand-600/25 via-zinc-900 to-zinc-950" />
                  )}
                  <div className="absolute inset-0 -z-10 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-black/20" />
                </header>

                <div className="mx-auto -mt-24 max-w-7xl px-4 sm:-mt-32 sm:px-6 lg:px-8">
                  <div className="relative grid min-w-0 gap-7 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
                    <div className="mx-auto aspect-[2/3] w-40 overflow-hidden rounded-2xl bg-zinc-900 shadow-2xl shadow-black/50 ring-1 ring-white/10 sm:w-52 md:mx-0 md:w-full">
                      <PosterImage path={item.posterPath} title={item.title} />
                    </div>

                    <div className="min-w-0 pt-0 text-center md:pt-14 md:text-left">
                      <span className="inline-flex rounded-full bg-brand-500/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-brand-400">
                        {mediaType === 'movie' ? 'Movie' : 'TV show'}
                      </span>
                      <h1 className="mt-3 text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">{item.title}</h1>
                      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm font-semibold text-zinc-300 md:justify-start">
                        <span className="inline-flex items-center gap-1.5"><Star size={16} fill="currentColor" className="text-amber-400" aria-hidden="true" />{formatRating(item.voteAverage)} TMDB</span>
                        <span className="inline-flex items-center gap-1.5"><CalendarDays size={16} aria-hidden="true" />{formatDate(item.date)}</span>
                        {movie && <span className="inline-flex items-center gap-1.5"><Clock size={16} aria-hidden="true" />{formatRuntime(movie.runtime)}</span>}
                        {tv && <span>{tv.number_of_seasons ? `${tv.number_of_seasons} season${tv.number_of_seasons === 1 ? '' : 's'}` : 'Seasons unavailable'}</span>}
                      </div>

                      <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
                        {(data.genres ?? []).map((genre) => <span key={genre.id} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-zinc-300">{genre.name}</span>)}
                      </div>

                      <p className="mx-auto mt-6 max-w-3xl text-left leading-7 text-zinc-300 md:mx-0">{item.overview || 'An overview is not available for this title.'}</p>

                      {movie && (
                        <p className="mt-4 inline-flex items-center gap-2 text-sm text-zinc-400">
                          <UserRound size={17} aria-hidden="true" />
                          <span><strong className="text-zinc-200">Director:</strong> {director ?? 'Not available'}</span>
                        </p>
                      )}

                      <div className="mt-7 flex flex-wrap justify-center gap-3 md:justify-start">
                        {mediaSources === null ? (
                          <span role="status" className="inline-flex min-h-12 items-center rounded-xl border border-white/10 bg-white/5 px-5 text-sm font-semibold text-zinc-400">
                            Checking authorised playback…
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (mediaSources.length > 0) {
                                setTheaterMode(true)
                                return
                              }
                              document.getElementById('streaming-player')?.scrollIntoView({ behavior: 'smooth' })
                            }}
                            className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-400 px-5 font-black text-zinc-950 transition hover:bg-brand-500"
                          >
                            <Play size={18} fill="currentColor" aria-hidden="true" />
                            {mediaSources.length > 0
                              ? (mediaType === 'movie' ? 'Watch Movie' : 'Watch Show')
                              : 'View video player'}
                          </button>
                        )}
                        {trailer && (
                          <button
                            type="button"
                            onClick={() => setTrailerOpen(true)}
                            className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/15 bg-white/7 px-5 font-black text-white transition hover:bg-white/12"
                          >
                            <Play size={18} fill="currentColor" aria-hidden="true" />Watch trailer
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleFavourite(item)}
                          aria-pressed={favourite}
                          className={`inline-flex min-h-12 items-center gap-2 rounded-xl border px-5 font-black transition ${favourite ? 'border-brand-400/50 bg-brand-600 text-white' : 'border-white/15 bg-white/7 text-white hover:bg-white/12'}`}
                        >
                          <Heart size={18} fill={favourite ? 'currentColor' : 'none'} aria-hidden="true" />
                          {favourite ? 'Remove favourite' : 'Add to favourites'}
                        </button>
                      </div>
                      {mediaSources !== null && mediaSources.length === 0 && (
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
                  {mediaSources === null ? (
                    <section id="streaming-player" aria-labelledby="player-loading-heading" className="scroll-mt-20 rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:p-7">
                      <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Video player</p>
                      <h2 id="player-loading-heading" className="mt-1 text-xl font-black text-white">Checking playback availability…</h2>
                      <div className="mt-4 aspect-video animate-pulse rounded-2xl bg-black ring-1 ring-white/10" />
                    </section>
                  ) : (
                    <StreamingPlayer
                      id={id}
                      mediaType={mediaType}
                      title={item.title}
                      numberOfSeasons={tv?.number_of_seasons}
                      sources={mediaSources}
                      theaterMode={theaterMode}
                      onTheaterModeChange={setTheaterMode}
                    />
                  )}
                  <section aria-labelledby="cast-heading">
                    <h2 id="cast-heading" className="mb-5 text-2xl font-black">Main cast</h2>
                    <CastList cast={cast} />
                  </section>
                </div>

                <div className="mt-14">
                  <MediaRow title={`Similar ${mediaType === 'movie' ? 'movies' : 'shows'}`} items={similar} loading={false} error={null} />
                </div>
                <TrailerModal trailer={trailerOpen ? trailer : null} onClose={() => setTrailerOpen(false)} />
              </article>
            )}
          </div>

          {/* Skeleton Layer */}
          {showSkeleton && (
            <div
              className={`absolute inset-0 z-10 bg-zinc-950 pointer-events-none transition-opacity duration-200 ${
                isFadingOutSkeleton ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <div className="min-w-0 pb-14 sm:pb-20 animate-pulse">
                <header className="relative min-h-[260px] overflow-hidden sm:min-h-[390px] lg:min-h-[470px] bg-zinc-900/50">
                  <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-black/20" />
                </header>

                <div className="mx-auto -mt-24 max-w-7xl px-4 sm:-mt-32 sm:px-6 lg:px-8">
                  <div className="relative grid min-w-0 gap-7 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
                    <div className="mx-auto aspect-[2/3] w-40 overflow-hidden rounded-2xl bg-zinc-900/80 shadow-2xl shadow-black/50 ring-1 ring-white/5 sm:w-52 md:mx-0 md:w-full" />

                    <div className="min-w-0 pt-0 text-center md:pt-14 md:text-left space-y-4">
                      <div className="inline-flex h-6 w-20 rounded-full bg-brand-500/10" />
                      <div className="mx-auto mt-3 h-10 w-3/4 rounded-xl bg-zinc-900/80 md:mx-0 md:w-1/2" />
                      <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 md:justify-start">
                        <div className="h-4 w-20 rounded bg-zinc-900/80" />
                        <div className="h-4 w-24 rounded bg-zinc-900/80" />
                        <div className="h-4 w-16 rounded bg-zinc-900/80" />
                      </div>
                      <div className="mt-5 flex flex-wrap justify-center gap-2 md:justify-start">
                        <div className="h-6 w-16 rounded-full bg-zinc-900/60" />
                        <div className="h-6 w-20 rounded-full bg-zinc-900/60" />
                        <div className="h-6 w-14 rounded-full bg-zinc-900/60" />
                      </div>
                      <div className="mt-6 space-y-2 max-w-3xl">
                        <div className="h-4 w-full rounded bg-zinc-900/70" />
                        <div className="h-4 w-11/12 rounded bg-zinc-900/70" />
                        <div className="h-4 w-4/5 rounded bg-zinc-900/70" />
                      </div>
                      {mediaType === 'movie' && (
                        <div className="mt-4 h-4 w-48 rounded bg-zinc-900/60 mx-auto md:mx-0" />
                      )}
                      <div className="mt-7 flex flex-wrap justify-center gap-3 md:justify-start">
                        <div className="h-12 w-32 rounded-xl bg-zinc-900/80" />
                        <div className="h-12 w-28 rounded-xl bg-zinc-900/80" />
                        <div className="h-12 w-36 rounded-xl bg-zinc-900/80" />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mx-auto mt-14 max-w-7xl space-y-14 px-4 sm:px-6 lg:px-8">
                  <section className="scroll-mt-20 rounded-3xl border border-white/5 bg-white/[0.01] p-5 sm:p-7">
                    <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-700">Video player</p>
                    <h2 className="mt-1 text-xl font-black text-zinc-800">Checking playback availability…</h2>
                    <div className="mt-4 aspect-video rounded-2xl bg-zinc-900/50 ring-1 ring-white/5" />
                  </section>
                  <section className="space-y-4">
                    <div className="h-6 w-32 rounded bg-zinc-900/80" />
                    <div className="flex gap-4 overflow-hidden">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex flex-col items-center gap-2">
                          <div className="size-20 rounded-full bg-zinc-900/80" />
                          <div className="h-3 w-16 rounded bg-zinc-900/60" />
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
                <div className="mt-14 space-y-4">
                  <div className="h-6 w-40 rounded bg-zinc-900/80 px-4 ml-8" />
                  <div className="flex gap-4 overflow-hidden px-8">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i} className="aspect-[2/3] w-28 rounded-2xl bg-zinc-900/80 shrink-0" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Error State Overlay */}
          {(request.error || (!request.loading && !data)) && (
            <div className="mx-auto flex min-h-[55vh] max-w-3xl items-center px-4 py-14 sm:px-6">
              <div className="w-full">
                <ErrorMessage message={request.error ?? 'This title could not be found.'} onRetry={request.retry} />
                <button
                  type="button"
                  onClick={handleClose}
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
