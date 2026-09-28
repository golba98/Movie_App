import { apiRequest } from '../../lib/api-client'
import type { ExtractedPlayer, MediaSource } from '../../types/media-source'
import type { MediaType } from '../../types/tmdb'

export function getMediaSources(mediaType: MediaType, tmdbId: number, signal?: AbortSignal) {
  return apiRequest<{ sources: MediaSource[] }>(`/api/media-sources/${mediaType}/${tmdbId}`, { signal })
}

/** Resolves a dynamic source's wrapper page to the embeddable player inside it. */
export function extractPlayer(sourceUrl: string, signal?: AbortSignal, refresh = false) {
  return apiRequest<ExtractedPlayer>(`/api/media-sources/extract?url=${encodeURIComponent(sourceUrl)}${refresh ? '&refresh=1' : ''}`, { signal })
}
