import type { MediaType } from './tmdb'
import type { PlaybackKind } from './watch-party'

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

export interface ExtractedPlayer {
  extractedUrl: string | null
  embedBlocked?: EmbedBlockReason | null
  playbackKind?: PlaybackKind | null
}

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

/** A website the Worker builds dynamic sources from, as the admin API returns it. */
export interface SearchProvider {
  id: string
  label: string
  baseUrl: string
  movieUrlPattern: string
  tvUrlPattern: string
  movieEmbedPattern: string
  tvEmbedPattern: string
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface SearchProviderInput {
  label: string
  baseUrl: string
  movieUrlPattern: string
  tvUrlPattern: string
  // Direct embed URLs for providers whose pages can't be scraped; empty to scrape.
  movieEmbedPattern: string
  tvEmbedPattern: string
  active: boolean
}
