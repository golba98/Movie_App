import { CalendarDays, Clock, Heart, Play, Star, UserRound } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getMediaSources } from '../api/media-sources'
import { getMovieDetails, getTvDetails } from '../api/tmdb'
import { CastList } from '../components/media/CastList'
import { StreamingPlayer } from '../components/media/StreamingPlayer'

import { DetailsSkeleton } from '../components/ui/LoadingSkeleton'
import { ErrorMessage } from '../components/ui/ErrorMessage'
import { MediaRow } from '../components/media/MediaRow'
import { PosterImage } from '../components/media/PosterImage'
import { TrailerModal } from '../components/media/TrailerModal'
import { WatchProviders } from '../components/media/WatchProviders'
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
  const loader = useCallback(
    (signal: AbortSignal): Promise<MovieDetails | TvDetails> => {
      if (!validId) return Promise.reject(new Error('This title has an invalid address.'))
      return mediaType === 'movie' ? getMovieDetails(id, signal) : getTvDetails(id, signal)
    },
    [id, mediaType, validId],
  )
  const request = useRequest(loader)
  const [trailerOpen, setTrailerOpen] = useState(false)
  const [playerOpen, setPlayerOpen] = useState(false)
  const [mediaSources, setMediaSources] = useState<MediaSource[] | null>(null)
  const [sourceError, setSourceError] = useState(false)
  const { isFavourite, toggleFavourite } = useFavourites()

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

  if (request.loading) return <DetailsSkeleton />
  if (request.error || !data || !item) {
    return (
      <div className="mx-auto flex min-h-[55vh] max-w-3xl items-center px-4 py-14 sm:px-6">
        <div className="w-full">
          <ErrorMessage message={request.error ?? 'This title could not be found.'} onRetry={request.retry} />
          <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-xl px-3 font-bold text-brand-400 hover:text-brand-300">Return home</Link>
        </div>
      </div>
    )
  }

  const movie = mediaType === 'movie' ? (data as MovieDetails) : null
  const tv = mediaType === 'tv' ? (data as TvDetails) : null
  const trailer = chooseTrailer(data.videos?.results)
  const similar = normalizeMediaList(data.similar?.results ?? [], mediaType)
  const cast = (data.credits?.cast ?? []).slice(0, 10)
  const director = movie?.credits?.crew?.find((person) => person.job === 'Director')?.name
  const backdrop = backdropUrl(item.backdropPath)
  const favourite = isFavourite(item)

  return (
    <article className="min-w-0 pb-14 sm:pb-20">
      <header className="relative isolate min-h-[260px] overflow-hidden sm:min-h-[390px] lg:min-h-[470px]">
        {backdrop ? (
          <img src={backdrop} alt="" role="presentation" className="absolute inset-0 -z-20 size-full object-cover" fetchPriority="high" />
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
              ) : mediaSources.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setPlayerOpen(true)
                    setTimeout(() => {
                      document.getElementById('streaming-player')?.scrollIntoView({ behavior: 'smooth' })
                    }, 100)
                  }}
                  className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-brand-400 px-5 font-black text-zinc-950 transition hover:bg-brand-500"
                >
                  <Play size={18} fill="currentColor" aria-hidden="true" />Watch authorised video
                </button>
              ) : null}
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
                  : 'No owned, licensed, or public-domain video is configured for in-app playback.'}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-7xl space-y-14 px-4 sm:px-6 lg:px-8">
        {playerOpen && mediaSources && mediaSources.length > 0 && (
          <StreamingPlayer
            id={id}
            mediaType={mediaType}
            title={item.title}
            numberOfSeasons={tv?.number_of_seasons}
            sources={mediaSources}
          />
        )}
        <section aria-labelledby="cast-heading">
          <h2 id="cast-heading" className="mb-5 text-2xl font-black">Main cast</h2>
          <CastList cast={cast} />
        </section>

        <section aria-labelledby="watch-heading">
          <div className="mb-5">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-400">South Africa</p>
            <h2 id="watch-heading" className="mt-1 text-2xl font-black">Where it is legally available</h2>
          </div>
          <WatchProviders providers={data['watch/providers']?.results?.ZA} />
        </section>
      </div>

      <div className="mt-14">
        <MediaRow title={`Similar ${mediaType === 'movie' ? 'movies' : 'shows'}`} items={similar} loading={false} error={null} />
      </div>
      <TrailerModal trailer={trailerOpen ? trailer : null} onClose={() => setTrailerOpen(false)} />
    </article>
  )
}
