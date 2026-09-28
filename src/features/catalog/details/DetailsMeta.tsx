import { CalendarDays, Clock, Star } from 'lucide-react'
import { formatDate, formatRating, formatRuntime } from '../../../lib/format'
import type { MediaItem, MovieDetails, TvDetails } from '../../../types/tmdb'

function seasonCount(seasons: number | null | undefined) {
  if (!seasons) return 'Seasons unavailable'
  return `${seasons} season${seasons === 1 ? '' : 's'}`
}

export function DetailsMeta({
  item,
  movie,
  tv,
}: {
  item: MediaItem
  movie: MovieDetails | null
  tv: TvDetails | null
}) {
  return (
    <div className="mt-4 flex flex-wrap justify-start gap-x-5 gap-y-2 text-sm font-semibold text-zinc-300">
      <span className="inline-flex items-center gap-1.5">
        <Star size={16} fill="currentColor" className="text-amber-400" aria-hidden="true" />
        {formatRating(item.voteAverage)} TMDB
      </span>
      <span className="inline-flex items-center gap-1.5">
        <CalendarDays size={16} aria-hidden="true" />
        {formatDate(item.date)}
      </span>
      {movie && (
        <span className="inline-flex items-center gap-1.5">
          <Clock size={16} aria-hidden="true" />
          {formatRuntime(movie.runtime)}
        </span>
      )}
      {tv && <span>{seasonCount(tv.number_of_seasons)}</span>}
    </div>
  )
}
