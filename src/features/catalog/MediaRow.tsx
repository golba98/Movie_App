import { ErrorMessage } from '../../components/ui/ErrorMessage'
import { CardSkeleton } from '../../components/ui/LoadingSkeleton'
import { useDragScroll } from '../../hooks/useDragScroll'
import type { MediaItem } from '../../types/tmdb'
import { MediaCard, type MediaCardVariant } from './MediaCard'
import { mediaKey } from './pagination'

interface MediaRowProps {
  id?: string
  title: string
  items: MediaItem[]
  loading: boolean
  error: string | null
  onRetry?: () => void
  variant?: MediaCardVariant
}

export function MediaRow({ id, title, items, loading, error, onRetry, variant }: MediaRowProps) {
  const scrollRef = useDragScroll()
  const headingId = `${id ?? title.replaceAll(' ', '-').toLowerCase()}-heading`

  return (
    <section id={id} className="media-row-container" aria-labelledby={headingId}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 id={headingId} className="text-xl font-black tracking-tight text-white sm:text-2xl">
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
          // scroll-px must mirror px: snap-start aligns children to the scrollport
          // (padding) edge, so without it the row self-scrolls by the padding amount
          // and the first card lands out of line with the heading.
          // Only sideways gestures go to the row. With plain data-lenis-prevent, Lenis
          // ignored vertical wheel over the row and native scrolling fought its
          // animation, so the page stalled while the pointer was over a row.
          <div ref={scrollRef} data-lenis-prevent-horizontal className="scrollbar-subtle -mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-5 sm:-mx-6 sm:scroll-px-6 sm:gap-5 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8">
            {loading ? (
              <CardSkeleton />
            ) : (
              items.map((item) => (
                <div key={mediaKey(item)} className="snap-start">
                  <MediaCard item={item} row variant={variant} />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  )
}
