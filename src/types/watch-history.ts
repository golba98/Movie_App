import type { MediaItem, MediaType } from './tmdb'

export interface EpisodeRef {
  seasonNumber: number
  episodeNumber: number
}

export interface PlaybackProgress {
  position: number
  duration: number
}

export interface WatchedItem {
  watched: boolean
  updatedAt: number
  position?: number
  duration?: number
  // Real playback time, counted by the player's watcher.
  watchSeconds?: number
}

// The most recent activity for a whole title; drives Continue Watching.
export interface TitleProgress {
  mediaType: MediaType
  id: number
  item?: MediaItem
  seasonNumber: number | null
  episodeNumber: number | null
  updatedAt: number
  // Removed from Continue Watching; kept so the removal syncs to other devices.
  removed?: boolean
}

export interface HistoryState {
  entries: Record<string, WatchedItem>
  titles: Record<string, TitleProgress>
}

export interface WatchRecord {
  item: MediaItem
  seasonNumber: number | null
  episodeNumber: number | null
  watchSeconds: number
  position?: number | null
  duration?: number | null
  // The watcher saw enough playback time to call the title finished.
  finished?: boolean
  // Send to the account now, e.g. the player is stopping or the page is hidden.
  urgent?: boolean
}
