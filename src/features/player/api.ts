import { apiRequest } from '../../lib/api-client'
import type { EmbedBlockReason, MediaSource } from '../../types/media-source'
import type { MediaType } from '../../types/tmdb'

export interface ExtractedPlayer {
  extractedUrl: string | null
  embedBlocked?: EmbedBlockReason | null
}

export function getMediaSources(mediaType: MediaType, tmdbId: number, signal?: AbortSignal) {
  return apiRequest<{ sources: MediaSource[] }>(`/api/media-sources/${mediaType}/${tmdbId}`, { signal })
}

/** Resolves a dynamic source's wrapper page to the embeddable player inside it. */
export function extractPlayer(sourceUrl: string, signal?: AbortSignal) {
  return apiRequest<ExtractedPlayer>(`/api/media-sources/extract?url=${encodeURIComponent(sourceUrl)}`, { signal })
}
