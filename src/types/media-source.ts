import type { MediaType } from './tmdb'

export type MediaMimeType = 'video/mp4' | 'video/webm'
export type RightsBasis = 'owned' | 'licensed'

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
