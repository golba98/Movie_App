import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { errorMessage } from '../../lib/errors'
import type { FavouriteItem } from '../../types/favourite'
import type { MediaItem } from '../../types/tmdb'
import { useAuth } from '../auth/auth-context'
import * as favouritesApi from './api'
import { FavouritesContext } from './favourites-context'

// Favourites saved on this device before they were stored on the account.
const LEGACY_STORAGE_KEY = 'cinescope:favourites:v1'

const itemKey = (item: Pick<MediaItem, 'id' | 'mediaType'>) => `${item.mediaType}:${item.id}`

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
    const parsed: unknown = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isStoredFavourite) : []
  } catch {
    return []
  }
}

export function FavouritesProvider({ children }: { children: ReactNode }) {
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
    favouritesApi.getFavourites()
      .then((response) => {
        if (!cancelled) setFavourites(response.favourites)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(errorMessage(caught, 'Unable to load favourites.'))
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

  // Updates optimistically and rolls back if the account rejects the change.
  const toggleFavourite = useCallback(
    async (item: MediaItem) => {
      const previous = favourites
      setError(null)
      if (isFavourite(item)) {
        setFavourites((current) => current.filter((favourite) => itemKey(favourite) !== itemKey(item)))
        try {
          await favouritesApi.removeFavourite(item)
        } catch (caught) {
          setFavourites(previous)
          setError(errorMessage(caught, 'Unable to remove that favourite.'))
        }
        return
      }

      const favourite = { ...item, addedAt: Date.now() }
      setFavourites((current) => [favourite, ...current])
      try {
        await favouritesApi.saveFavourite(favourite)
      } catch (caught) {
        setFavourites(previous)
        setError(errorMessage(caught, 'Unable to save that favourite.'))
      }
    },
    [favourites, isFavourite],
  )

  const importLegacy = useCallback(async () => {
    setImporting(true)
    setError(null)
    try {
      await favouritesApi.importFavourites(legacy)
      setFavourites((current) => {
        const combined = [...legacy, ...current]
        return [...new Map(combined.map((item) => [itemKey(item), item])).values()]
      })
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      setLegacy([])
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to import favourites.'))
    } finally {
      setImporting(false)
    }
  }, [legacy])

  const dismissLegacy = useCallback(() => setLegacyDismissed(true), [])

  const value = useMemo(
    () => ({
      favourites,
      loading,
      error,
      legacyCount: legacyDismissed ? 0 : legacy.length,
      importing,
      isFavourite,
      toggleFavourite,
      importLegacy,
      dismissLegacy,
    }),
    [dismissLegacy, error, favourites, importLegacy, importing, isFavourite, legacy.length, legacyDismissed, loading, toggleFavourite],
  )

  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>
}
