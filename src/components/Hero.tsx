import { Info, Play, Star } from 'lucide-react'
import { Link } from 'react-router'
import type { MediaItem, Video } from '../types/tmdb'
import { backdropUrl } from '../utils/images'
import { formatRating, mediaPath } from '../utils/media'

export function Hero({
  item,
  trailer,
  onWatchTrailer,
}: {
  item: MediaItem
  trailer: Video | null
  onWatchTrailer: () => void
}) {
  const backdrop = backdropUrl(item.backdropPath)

  return (
    <section
      className="relative isolate flex min-h-[390px] items-end overflow-hidden sm:min-h-[470px] lg:min-h-[560px]"
      aria-labelledby="featured-title"
    >
      {backdrop ? (
        <img
          src={backdrop}
          alt=""
          role="presentation"
          fetchPriority="high"
          className="absolute inset-0 -z-20 size-full object-cover object-center"
        />
      ) : (
        <div className="absolute inset-0 -z-20 bg-gradient-to-br from-brand-600/30 via-zinc-900 to-black" />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-zinc-950 via-zinc-950/45 to-black/10" />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-zinc-950/80 via-transparent to-transparent" />

      <div className="mx-auto w-full max-w-7xl px-4 pb-9 sm:px-6 sm:pb-12 lg:px-8 lg:pb-16">
        <div className="max-w-2xl">
          <span className="inline-flex rounded-full border border-white/20 bg-black/30 px-3 py-1 text-xs font-black uppercase tracking-[0.18em] text-brand-400 backdrop-blur-sm">
            Featured this week
          </span>
          <h1 id="featured-title" className="mt-4 text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
            {item.title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-semibold text-zinc-200 sm:text-base">
            <span className="inline-flex items-center gap-1.5">
              <Star size={16} fill="currentColor" className="text-amber-400" aria-hidden="true" />
              {formatRating(item.voteAverage)} TMDB
            </span>
            <span aria-hidden="true" className="text-zinc-500">•</span>
            <span>{item.year ?? 'Release date TBA'}</span>
          </div>
          <p className="line-clamp-3 mt-4 max-w-xl text-sm leading-6 text-zinc-200 sm:text-base sm:leading-7">
            {item.overview || 'Discover cast, ratings, trailers, and legal availability for this title.'}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              to={mediaPath(item)}
              className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-white px-5 font-black text-zinc-950 shadow-lg transition hover:bg-zinc-200"
            >
              <Info size={19} aria-hidden="true" />
              View details
            </Link>
            {trailer && (
              <button
                type="button"
                onClick={onWatchTrailer}
                className="inline-flex min-h-12 items-center gap-2 rounded-xl border border-white/15 bg-black/45 px-5 font-black text-white backdrop-blur-md transition hover:bg-black/65"
              >
                <Play size={19} fill="currentColor" aria-hidden="true" />
                Watch trailer
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
