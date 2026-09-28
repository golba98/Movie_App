import type { MediaType } from './tmdb'

export type MediaMimeType = 'video/mp4' | 'video/webm'
export type RightsBasis = 'owned' | 'licensed'

/** A playable source for a movie or episode, as sent to viewers. */
export interface MediaSource {
  id: string
  mediaType: MediaType
  tmdbId: number
  seasonNumber: number | null
  episodeNumber: number | null
  label: string
  sourceUrl: string
  mimeType: MediaMimeType
  rightsBasis: RightsBasis
  // Built from a search provider rather than stored in the catalog.
  isDynamic?: boolean
}

// Returned by the extract endpoint when the resolved player explicitly refuses
// to be framed by this app (see worker/catalog/embed-policy.ts).
export type EmbedBlockReason = 'x-frame-options' | 'frame-ancestors'

export interface AdminMediaSource extends MediaSource {
  rightsNote: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface MediaSourceInput {
  mediaType: MediaType
  tmdbId: number
  seasonNumber: number | null
  episodeNumber: number | null
  label: string
  sourceUrl: string
  mimeType: MediaMimeType
  rightsBasis: RightsBasis
  rightsNote: string
  active: boolean
}

export interface SearchProvider {
  id: string
  label: string
  baseUrl: string
  movieUrlPattern: string
  tvUrlPattern: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface SearchProviderInput {
  label: string
  baseUrl: string
  movieUrlPattern: string
  tvUrlPattern: string
  active: boolean
}
