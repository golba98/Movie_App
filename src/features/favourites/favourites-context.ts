import { createContext, useContext } from 'react'
import type { FavouriteItem } from '../../types/favourite'
import type { MediaItem } from '../../types/tmdb'

export interface FavouritesContextValue {
  favourites: FavouriteItem[]
  loading: boolean
  error: string | null
  legacyCount: number
  importing: boolean
  isFavourite: (item: Pick<MediaItem, 'id' | 'mediaType'>) => boolean
  toggleFavourite: (item: MediaItem) => Promise<void>
  importLegacy: () => Promise<void>
  dismissLegacy: () => void
}

export const FavouritesContext = createContext<FavouritesContextValue | null>(null)

export function useFavourites() {
  const context = useContext(FavouritesContext)
  if (!context) throw new Error('useFavourites must be used within FavouritesProvider')
  return context
}
