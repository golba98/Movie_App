import type { MediaItem } from '../../types/tmdb'

// TMDB refuses pages past 500 even when total_pages says there are more.
const MAX_TMDB_PAGES = 500

export const mediaKey = (item: Pick<MediaItem, 'id' | 'mediaType'>) => `${item.mediaType}-${item.id}`

export const pageLimit = (totalPages: number) => Math.min(totalPages, MAX_TMDB_PAGES)

/** Joins result pages, dropping titles TMDB repeats across pages. */
export function uniqueMedia(items: MediaItem[]) {
  return [...new Map(items.map((item) => [mediaKey(item), item])).values()]
}
