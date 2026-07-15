import { Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import { isTmdbConfigured, searchMulti } from '../api/tmdb'
import { ErrorMessage } from '../components/ErrorMessage'
import { GridSkeleton } from '../components/LoadingSkeleton'
import { MediaCard } from '../components/MediaCard'
import { SearchBar } from '../components/SearchBar'
import { SetupMessage } from '../components/SetupMessage'
import { useDebounce } from '../hooks/useDebounce'
import type { MediaItem } from '../types/tmdb'
import { normalizeMediaList } from '../utils/media'

export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''
  const input = urlQuery
  const debouncedQuery = useDebounce(input.trim(), 350)
  const [items, setItems] = useState<MediaItem[]>([])
  const [page, setPage] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!isTmdbConfigured) return
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
        setTotalPages(Math.min(response.total_pages, 500))
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return
        setError(caught instanceof Error ? caught.message : 'Search failed. Please try again.')
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
      setItems((current) => {
        const combined = [...current, ...normalizeMediaList(response.results)]
        return [...new Map(combined.map((item) => [`${item.mediaType}-${item.id}`, item])).values()]
      })
      setPage(response.page)
      setTotalPages(Math.min(response.total_pages, 500))
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Search failed.')
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false)
    }
  }

  if (!isTmdbConfigured) return <SetupMessage />

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-12 lg:px-8">
      <header className="mx-auto max-w-3xl text-center sm:text-left">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-400">Search TMDB</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Find movies and TV shows</h1>
        <div className="mt-6 sm:mt-8">
          <SearchBar value={input} onChange={updateQuery} />
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
            <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-5 xl:grid-cols-6">
              {items.map((item) => <MediaCard key={`${item.mediaType}-${item.id}`} item={item} />)}
            </div>
            {error && <div className="mt-8"><ErrorMessage message={error} compact /></div>}
            {page < totalPages && (
              <div className="mt-10 flex justify-center">
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="min-h-12 rounded-xl bg-white px-6 font-black text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60"
                >
                  {loadingMore ? 'Loading…' : 'Load more results'}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
