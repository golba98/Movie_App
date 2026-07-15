import { useCallback, useMemo, useState } from 'react'
import {
  getMovieDetails,
  getPopularMovies,
  getPopularTv,
  getTopRatedMovies,
  getTrendingMovies,
  getUpcomingMovies,
  isTmdbConfigured,
} from '../api/tmdb'
import { Hero } from '../components/Hero'
import { MediaRow } from '../components/MediaRow'
import { SetupMessage } from '../components/SetupMessage'
import { TrailerModal } from '../components/TrailerModal'
import { useRequest } from '../hooks/useRequest'
import { chooseTrailer, normalizeMediaList } from '../utils/media'

export function HomePage() {
  const trending = useRequest(getTrendingMovies)
  const popularMoviesLoader = useCallback((signal: AbortSignal) => getPopularMovies(1, signal), [])
  const popularMovies = useRequest(popularMoviesLoader)
  const topRated = useRequest(getTopRatedMovies)
  const upcoming = useRequest(getUpcomingMovies)
  const popularTvLoader = useCallback((signal: AbortSignal) => getPopularTv(1, signal), [])
  const popularTv = useRequest(popularTvLoader)

  const trendingItems = useMemo(
    () => normalizeMediaList(trending.data?.results ?? [], 'movie'),
    [trending.data],
  )
  const featured = trendingItems.find((item) => item.backdropPath) ?? trendingItems[0] ?? null
  const featuredLoader = useCallback(
    (signal: AbortSignal) =>
      featured ? getMovieDetails(featured.id, signal) : Promise.resolve(null),
    [featured],
  )
  const featuredDetails = useRequest(featuredLoader)
  const trailer = chooseTrailer(featuredDetails.data?.videos?.results)
  const [trailerOpen, setTrailerOpen] = useState(false)

  if (!isTmdbConfigured) return <SetupMessage />

  return (
    <div className="min-w-0">
      {featured ? (
        <Hero item={featured} trailer={trailer} onWatchTrailer={() => setTrailerOpen(true)} />
      ) : (
        <div className="mx-auto flex min-h-[390px] max-w-7xl items-end px-4 pb-12 sm:px-6 lg:px-8">
          {trending.error ? (
            <div className="max-w-xl">
              <h1 className="text-3xl font-black">Find your next story</h1>
              <p className="mt-3 text-zinc-400">Featured titles are temporarily unavailable. The other collections may still load below.</p>
            </div>
          ) : (
            <div className="h-36 w-full max-w-xl animate-pulse rounded-3xl bg-white/8" aria-label="Loading featured title" />
          )}
        </div>
      )}

      <div className="space-y-10 pb-14 sm:space-y-12 sm:pb-20">
        <MediaRow
          title="Trending movies"
          items={trendingItems}
          loading={trending.loading}
          error={trending.error}
          onRetry={trending.retry}
        />
        <MediaRow
          id="popular-movies"
          title="Popular movies"
          items={normalizeMediaList(popularMovies.data?.results ?? [], 'movie')}
          loading={popularMovies.loading}
          error={popularMovies.error}
          onRetry={popularMovies.retry}
        />
        <MediaRow
          title="Top-rated movies"
          items={normalizeMediaList(topRated.data?.results ?? [], 'movie')}
          loading={topRated.loading}
          error={topRated.error}
          onRetry={topRated.retry}
        />
        <MediaRow
          title="Upcoming movies"
          items={normalizeMediaList(upcoming.data?.results ?? [], 'movie')}
          loading={upcoming.loading}
          error={upcoming.error}
          onRetry={upcoming.retry}
        />
        <MediaRow
          id="popular-tv"
          title="Popular TV shows"
          items={normalizeMediaList(popularTv.data?.results ?? [], 'tv')}
          loading={popularTv.loading}
          error={popularTv.error}
          onRetry={popularTv.retry}
        />
      </div>
      <TrailerModal trailer={trailerOpen ? trailer : null} onClose={() => setTrailerOpen(false)} />
    </div>
  )
}
