import { apiRequest } from '../../lib/api-client'
import type { FavouriteItem } from '../../types/favourite'
import type { MediaItem } from '../../types/tmdb'

type MediaKey = Pick<MediaItem, 'id' | 'mediaType'>

const favouritePath = (item: MediaKey) => `/api/favourites/${item.mediaType}/${item.id}`

export function getFavourites() {
  return apiRequest<{ favourites: FavouriteItem[] }>('/api/favourites')
}

export function saveFavourite(favourite: FavouriteItem) {
  return apiRequest(favouritePath(favourite), { method: 'PUT', body: JSON.stringify(favourite) })
}

export function removeFavourite(item: MediaKey) {
  return apiRequest(favouritePath(item), { method: 'DELETE' })
}

export function importFavourites(favourites: FavouriteItem[]) {
  return apiRequest('/api/favourites/import', { method: 'POST', body: JSON.stringify({ favourites }) })
}
