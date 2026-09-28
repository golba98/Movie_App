import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ErrorMessage } from '../../components/ui/ErrorMessage'
import { GridSkeleton } from '../../components/ui/LoadingSkeleton'
import { SearchBar } from '../../components/ui/SearchBar'
import { useDebounce } from '../../hooks/useDebounce'
import { errorMessage } from '../../lib/errors'
import type { MediaItem } from '../../types/tmdb'
import { searchMulti } from './api'
import { normalizeMediaList } from './media'
import { LoadMoreButton, MediaGrid } from './MediaGrid'
import { pageLimit, uniqueMedia } from './pagination'

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  // The URL is the single source of truth, so searches are shareable and survive reloads.
  const query = searchParams.get('q') ?? ''
  const debouncedQuery = useDebounce(query.trim(), 350)
  const [items, setItems] = useState<MediaItem[]>([])
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    controllerRef.current?.abort()

    if (!debouncedQuery) {
      setItems([])
      setPage(0)
      setTotalPages(1)
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()
    controllerRef.current = controller
    setLoading(true)
    setError(null)

    searchMulti(debouncedQuery, 1, controller.signal)
      .then((response) => {
        setItems(normalizeMediaList(response.results))
        setPage(response.page)
        setTotalPages(pageLimit(response.total_pages))
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(errorMessage(caught, 'Search failed. Please try again.'))
        setItems([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [debouncedQuery])

  const updateQuery = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value.trim()) next.set('q', value)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }

  const loadMore = async () => {
    if (!debouncedQuery || loadingMore || page >= totalPages) return
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setLoadingMore(true)
    setError(null)
    try {
      const response = await searchMulti(debouncedQuery, page + 1, controller.signal)
      setItems((current) => uniqueMedia([...current, ...normalizeMediaList(response.results)]))
      setPage(response.page)
      setTotalPages(pageLimit(response.total_pages))
    } catch (caught) {
      if (!controller.signal.aborted) setError(errorMessage(caught, 'Search failed.'))
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-12 lg:px-8">
      <header className="mx-auto max-w-3xl text-center sm:text-left">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-400">Search TMDB</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Find movies and TV shows</h1>
        <div className="mt-6 sm:mt-8">
          <SearchBar value={query} onChange={updateQuery} />
        </div>
      </header>

      <div className="mt-9" aria-live="polite">
        {!debouncedQuery && !loading ? (
          <div className="mx-auto max-w-xl rounded-3xl border border-white/8 bg-white/4 p-8 text-center">
            <Search className="mx-auto text-zinc-600" size={38} aria-hidden="true" />
            <h2 className="mt-4 text-xl font-black">What are you looking for?</h2>
            <p className="mt-2 leading-6 text-zinc-400">Search by a movie or TV show title. People are excluded so every result opens a working details page.</p>
          </div>
        ) : loading ? (
          <GridSkeleton />
        ) : error && items.length === 0 ? (
          <ErrorMessage message={error} />
        ) : items.length === 0 ? (
          <div className="rounded-3xl border border-white/8 bg-white/4 p-8 text-center">
            <h2 className="text-xl font-black">No results found</h2>
            <p className="mt-2 text-zinc-400">Try a different spelling or a broader title.</p>
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-xl font-black">Results for “{debouncedQuery}”</h2>
              <span className="text-sm text-zinc-500">Movies and TV shows</span>
            </div>
            <MediaGrid items={items} />
            {error && <div className="mt-8"><ErrorMessage message={error} compact /></div>}
            {page < totalPages && <LoadMoreButton loading={loadingMore} label="Load more results" onClick={() => void loadMore()} />}
          </>
        )}
      </div>
    </div>
  )
}
