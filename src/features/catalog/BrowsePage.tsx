import { useCallback, useEffect, useState } from 'react'
import { ErrorMessage } from '../../components/ui/ErrorMessage'
import { GridSkeleton } from '../../components/ui/LoadingSkeleton'
import { errorMessage } from '../../lib/errors'
import type { MediaItem, MediaType } from '../../types/tmdb'
import { getPopular } from './api'
import { normalizeMediaList } from './media'
import { LoadMoreButton, MediaGrid } from './MediaGrid'
import { pageLimit, uniqueMedia } from './pagination'

const COPY = {
  movie: {
    title: 'Popular movies',
    description: 'Explore the movies audiences are discovering on TMDB right now.',
  },
  tv: {
    title: 'Popular TV shows',
    description: 'Explore the TV series audiences are discovering on TMDB right now.',
  },
}

export function BrowsePage({ mediaType }: { mediaType: MediaType }) {
  const [items, setItems] = useState<MediaItem[]>([])
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPage = useCallback(
    async (nextPage: number, append: boolean, signal?: AbortSignal) => {
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const response = await getPopular(mediaType, nextPage, signal)
        const normalized = normalizeMediaList(response.results, mediaType)
        setItems((current) => uniqueMedia(append ? [...current, ...normalized] : normalized))
        setPage(response.page)
        setTotalPages(pageLimit(response.total_pages))
      } catch (caught) {
        if (signal?.aborted) return
        setError(errorMessage(caught, 'Unable to load titles.'))
      } finally {
        if (!signal?.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [mediaType],
  )

  useEffect(() => {
    const controller = new AbortController()
    setItems([])
    setPage(0)
    void loadPage(1, false, controller.signal)
    return () => controller.abort()
  }, [loadPage])

  const { title, description } = COPY[mediaType]

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="max-w-2xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-400">Discover</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">{title}</h1>
        <p className="mt-4 leading-7 text-zinc-400">{description}</p>
      </header>

      <div className="mt-9">
        {loading ? (
          <GridSkeleton />
        ) : items.length === 0 && error ? (
          <ErrorMessage message={error} onRetry={() => void loadPage(1, false)} />
        ) : items.length === 0 ? (
          <p className="rounded-2xl border border-white/8 bg-white/4 p-8 text-center text-zinc-400">No titles are available right now.</p>
        ) : (
          <>
            <MediaGrid items={items} />
            {error && <div className="mt-8"><ErrorMessage message={error} compact /></div>}
            {page < totalPages && <LoadMoreButton loading={loadingMore} label="Load more" onClick={() => void loadPage(page + 1, true)} />}
          </>
        )}
      </div>
    </div>
  )
}
