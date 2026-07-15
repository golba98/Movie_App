import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { FavouriteItem, MediaItem } from '../types/tmdb'

const STORAGE_KEY = 'cinescope:favourites:v1'

interface FavouritesContextValue {
  favourites: FavouriteItem[]
  isFavourite: (item: Pick<MediaItem, 'id' | 'mediaType'>) => boolean
  toggleFavourite: (item: MediaItem) => void
  removeFavourite: (item: Pick<MediaItem, 'id' | 'mediaType'>) => void
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

function readFavourites() {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isStoredFavourite) : []
  } catch {
    return []
  }
}

const itemKey = (item: Pick<MediaItem, 'id' | 'mediaType'>) => `${item.mediaType}:${item.id}`

export function FavouritesProvider({ children }: { children: React.ReactNode }) {
  const [favourites, setFavourites] = useState<FavouriteItem[]>(readFavourites)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favourites))
  }, [favourites])

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setFavourites(readFavourites())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])

  const isFavourite = useCallback(
    (item: Pick<MediaItem, 'id' | 'mediaType'>) =>
      favourites.some((favourite) => itemKey(favourite) === itemKey(item)),
    [favourites],
  )

  const removeFavourite = useCallback((item: Pick<MediaItem, 'id' | 'mediaType'>) => {
    setFavourites((current) =>
      current.filter((favourite) => itemKey(favourite) !== itemKey(item)),
    )
  }, [])

  const toggleFavourite = useCallback((item: MediaItem) => {
    setFavourites((current) => {
      const exists = current.some((favourite) => itemKey(favourite) === itemKey(item))
      if (exists) return current.filter((favourite) => itemKey(favourite) !== itemKey(item))
      return [{ ...item, addedAt: Date.now() }, ...current]
    })
  }, [])

  const value = useMemo(
    () => ({ favourites, isFavourite, toggleFavourite, removeFavourite }),
    [favourites, isFavourite, removeFavourite, toggleFavourite],
  )

  return <FavouritesContext.Provider value={value}>{children}</FavouritesContext.Provider>
}

export function useFavourites() {
  const context = useContext(FavouritesContext)
  if (!context) throw new Error('useFavourites must be used within FavouritesProvider')
  return context
}
