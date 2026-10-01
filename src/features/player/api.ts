import { apiRequest } from '../../lib/api-client'
import type { ExtractedPlayer, MediaSource, SubtitleContext } from '../../types/media-source'
import type { MediaType } from '../../types/tmdb'

export function getMediaSources(mediaType: MediaType, tmdbId: number, signal?: AbortSignal) {
  return apiRequest<{ sources: MediaSource[] }>(`/api/media-sources/${mediaType}/${tmdbId}`, { signal })
}

/** Resolves a dynamic source's wrapper page to the embeddable player inside it. */
export function extractPlayer(sourceUrl: string, signal?: AbortSignal, refresh = false, context: SubtitleContext = {}) {
  const params = new URLSearchParams({ url: sourceUrl })
  if (refresh) params.set('refresh', '1')
  if (context.observedDuration) params.set('duration', String(context.observedDuration))
  if (context.releaseFingerprint) params.set('release', context.releaseFingerprint)
  if (context.subtitleId) params.set('subtitle', context.subtitleId)
  return apiRequest<ExtractedPlayer>(`/api/media-sources/extract?${params}`, { signal })
}
