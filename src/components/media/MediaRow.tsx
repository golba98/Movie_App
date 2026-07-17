import type { MediaItem } from '../../types/tmdb'
import { ErrorMessage } from '../ui/ErrorMessage'
import { CardSkeleton } from '../ui/LoadingSkeleton'
import { MediaCard } from './MediaCard'

export function MediaRow({
  id,
  title,
  items,
  loading,
  error,
  onRetry,
}: {
  id?: string
  title: string
  items: MediaItem[]
  loading: boolean
  error: string | null
  onRetry?: () => void
}) {
  return (
    <section id={id} aria-labelledby={`${id ?? title.replaceAll(' ', '-').toLowerCase()}-heading`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2
          id={`${id ?? title.replaceAll(' ', '-').toLowerCase()}-heading`}
          className="text-xl font-black tracking-tight text-white sm:text-2xl"
        >
          {title}
        </h2>
      </div>
      <div className="mx-auto mt-5 max-w-7xl px-4 sm:px-6 lg:px-8">
        {error ? (
          <ErrorMessage message={error} onRetry={onRetry} compact />
        ) : !loading && items.length === 0 ? (
          <p className="rounded-2xl border border-white/8 bg-white/4 p-5 text-zinc-400">
            No titles are available in this collection right now.
          </p>
        ) : (
          <div className="scrollbar-subtle -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-5 sm:-mx-6 sm:gap-5 sm:px-6 lg:-mx-8 lg:px-8">
            {loading ? (
              <CardSkeleton />
            ) : (
              items.map((item) => (
                <div key={`${item.mediaType}-${item.id}`} className="snap-start">
                  <MediaCard item={item} row />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  )
}
