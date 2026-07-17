import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/client'
import type { FavouriteItem, MediaItem } from '../types/tmdb'
import { useAuth } from './useAuth'

const STORAGE_KEY = 'cinescope:favourites:v1'

interface FavouritesContextValue {
  favourites: FavouriteItem[]
  loading: boolean
  error: string | null
  legacyCount: number
  importing: boolean
  isFavourite: (item: Pick<MediaItem, 'id' | 'mediaType'>) => boolean
  toggleFavourite: (item: MediaItem) => Promise<void>
  removeFavourite: (item: Pick<MediaItem, 'id' | 'mediaType'>) => Promise<void>
  importLegacy: () => Promise<void>
  dismissLegacy: () => void
}

const FavouritesContext = createContext<FavouritesContextValue | null>(null)

function isStoredFavourite(value: unknown): value is FavouriteItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<FavouriteItem>
  return (
    Number.isInteger(item.id) &&
    item.id! > 0 &&
    (item.mediaType === 'movie' || item.mediaType === 'tv') &&
    typeof item.title === 'string' &&
    typeof item.addedAt === 'number'
  )
}

function readLegacyFavourites() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isStoredFavourite) : []
  } catch {
    return []
  }
}

const itemKey = (item: Pick<MediaItem, 'id' | 'mediaType'>) => `${item.mediaType}:${item.id}`

export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAuth()
  const [favourites, setFavourites] = useState<FavouriteItem[]>([])
  const [legacy, setLegacy] = useState<FavouriteItem[]>(readLegacyFavourites)
  const [legacyDismissed, setLegacyDismissed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!account || account.mustChangePassword) {
      setFavourites([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiRequest<{ favourites: FavouriteItem[] }>('/api/favourites')
      .then((response) => {
        if (!cancelled) setFavourites(response.favourites)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Unable to load favourites.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [account])

  const isFavourite = useCallback(
    (item: Pick<MediaItem, 'id' | 'mediaType'>) =>
      favourites.some((favourite) => itemKey(favourite) === itemKey(item)),
    [favourites],
  )

  const removeFavourite = useCallback(
    async (item: Pick<MediaItem, 'id' | 'mediaType'>) => {
      const previous = favourites
      setFavourites((current) => current.filter((favourite) => itemKey(favourite) !== itemKey(item)))
      setError(null)
      try {
        await apiRequest(`/api/favourites/${item.mediaType}/${item.id}`, { method: 'DELETE' })
      } catch (caught) {
        setFavourites(previous)
        setError(caught instanceof Error ? caught.message : 'Unable to remove that favourite.')
      }
    },
    [favourites],
  )

  const toggleFavourite = useCallback(
    async (item: MediaItem) => {
      const existing = favourites.some((favourite) => itemKey(favourite) === itemKey(item))
      if (existing) return removeFavourite(item)
      const favourite = { ...item, addedAt: Date.now() }
      const previous = favourites
      setFavourites((current) => [favourite, ...current])
      setError(null)
      try {
        await apiRequest(`/api/favourites/${item.mediaType}/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify(favourite),
        })
      } catch (caught) {
        setFavourites(previous)
        setError(caught instanceof Error ? caught.message : 'Unable to save that favourite.')
      }
    },
    [favourites, removeFavourite],
  )

  const importLegacy = useCallback(async () => {
    setImporting(true)
    setError(null)
    try {
      await apiRequest('/api/favourites/import', {
        method: 'POST',
        body: JSON.stringify({ favourites: legacy }),
      })
      setFavourites((current) => {
        const combined = [...legacy, ...current]
        return [...new Map(combined.map((item) => [itemKey(item), item])).values()]
      })
      localStorage.removeItem(STORAGE_KEY)
      setLegacy([])
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to import favourites.')
    } finally {
      setImporting(false)
    }
  }, [legacy])

  const value = useMemo(
    () => ({
      favourites,
      loading,
      error,
      legacyCount: legacyDismissed ? 0 : legacy.length,
      importing,
      isFavourite,
      toggleFavourite,
      removeFavourite,
      importLegacy,
      dismissLegacy: () => setLegacyDismissed(true),
    }),
    [
      error,
      favourites,
      importLegacy,
      importing,
      isFavourite,
      legacy.length,
      legacyDismissed,
      loading,
      removeFavourite,
      toggleFavourite,
    ],
  )

  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>
}

export function useFavourites() {
  const context = useContext(FavouritesContext)
  if (!context) throw new Error('useFavourites must be used within FavouritesProvider')
  return context
}
