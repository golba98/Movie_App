import { useCallback, useEffect, useState } from 'react'
import { browseFor } from '../api/tmdb'
import { ErrorMessage } from '../components/ui/ErrorMessage'
import { GridSkeleton } from '../components/ui/LoadingSkeleton'
import { MediaCard } from '../components/media/MediaCard'
import type { MediaItem, MediaType } from '../types/tmdb'
import { normalizeMediaList } from '../utils/media'

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
        const response = await browseFor(mediaType, nextPage, signal)
        const normalized = normalizeMediaList(response.results, mediaType)
        setItems((current) => {
          const combined = append ? [...current, ...normalized] : normalized
          return [...new Map(combined.map((item) => [`${item.mediaType}-${item.id}`, item])).values()]
        })
        setPage(response.page)
        setTotalPages(Math.min(response.total_pages, 500))
      } catch (caught) {
        if (signal?.aborted) return
        setError(caught instanceof Error ? caught.message : 'Unable to load titles.')
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

  const title = mediaType === 'movie' ? 'Popular movies' : 'Popular TV shows'
  const description =
    mediaType === 'movie'
      ? 'Explore the movies audiences are discovering on TMDB right now.'
      : 'Explore the TV series audiences are discovering on TMDB right now.'

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
            <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((item) => <MediaCard key={`${item.mediaType}-${item.id}`} item={item} />)}
            </div>
            {error && <div className="mt-8"><ErrorMessage message={error} compact /></div>}
            {page < totalPages && (
              <div className="mt-10 flex justify-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => void loadPage(page + 1, true)}
                  className="min-h-12 rounded-xl bg-white px-6 font-black text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
