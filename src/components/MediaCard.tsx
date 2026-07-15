import { Heart, Star } from 'lucide-react'
import { Link } from 'react-router'
import { useFavourites } from '../hooks/useFavourites'
import type { MediaItem } from '../types/tmdb'
import { formatRating, mediaPath } from '../utils/media'
import { PosterImage } from './PosterImage'

export function MediaCard({ item, row = false }: { item: MediaItem; row?: boolean }) {
  const { isFavourite, toggleFavourite } = useFavourites()
  const favourite = isFavourite(item)

  return (
    <article className={`group min-w-0 ${row ? 'w-[148px] shrink-0 sm:w-[168px] lg:w-[184px]' : ''}`}>
      <div className="relative aspect-[2/3] overflow-hidden rounded-2xl bg-zinc-900 shadow-lg shadow-black/20 ring-1 ring-white/8 transition duration-300 group-hover:-translate-y-1 group-hover:ring-white/20 group-focus-within:ring-brand-400">
        <Link
          to={mediaPath(item)}
          aria-label={`View details for ${item.title}`}
          className="absolute inset-0 z-10 rounded-2xl"
        >
          <span className="sr-only">View details for {item.title}</span>
        </Link>
        <PosterImage path={item.posterPath} title={item.title} />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
        <button
          type="button"
          onClick={() => toggleFavourite(item)}
          className={`absolute right-2 top-2 z-20 grid size-11 place-items-center rounded-full border shadow-lg backdrop-blur-md transition ${
            favourite
              ? 'border-brand-400/50 bg-brand-600 text-white'
              : 'border-white/15 bg-black/60 text-white hover:bg-black/80'
          }`}
          aria-label={favourite ? `Remove ${item.title} from favourites` : `Add ${item.title} to favourites`}
          aria-pressed={favourite}
        >
          <Heart size={18} fill={favourite ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
        <span className="absolute bottom-2 left-2 z-0 rounded-md bg-black/65 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-zinc-100 backdrop-blur-sm">
          {item.mediaType === 'movie' ? 'Movie' : 'TV'}
        </span>
      </div>
      <div className="mt-3 min-w-0">
        <Link
          to={mediaPath(item)}
          className="line-clamp-2 rounded text-sm font-bold leading-5 text-zinc-100 transition hover:text-brand-400"
        >
          {item.title}
        </Link>
        <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-zinc-400">
          <span>{item.year ?? 'Date TBA'}</span>
          <span className="inline-flex items-center gap-1" aria-label={`TMDB rating ${formatRating(item.voteAverage)}`}>
            <Star size={12} fill="currentColor" className="text-amber-400" aria-hidden="true" />
            {formatRating(item.voteAverage)}
          </span>
        </div>
      </div>
    </article>
  )
}
