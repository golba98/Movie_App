import { createContext, useContext } from 'react'
import type { MediaItem, MediaType } from '../../types/tmdb'
import type { EpisodeRef, PlaybackProgress, TitleProgress, WatchedItem, WatchRecord } from '../../types/watch-history'

export interface WatchedHistoryContextValue {
  continueWatching: TitleProgress[]
  isEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number) => boolean
  toggleEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number) => void
  isMovieWatched: (movieId: number) => boolean
  toggleMovieWatched: (movieId: number) => void
  getResumeTarget: (showId: number) => EpisodeRef | null
  getTitleProgress: (mediaType: MediaType, id: number) => TitleProgress | null
  getProgress: (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) => PlaybackProgress | null
  getEntry: (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) => WatchedItem | null
  recordWatch: (record: WatchRecord) => void
  removeFromContinueWatching: (mediaType: MediaType, id: number) => void
  backfillTitle: (item: MediaItem) => void
}

export const WatchedHistoryContext = createContext<WatchedHistoryContextValue | null>(null)

export function useWatchedHistory() {
  const context = useContext(WatchedHistoryContext)
  if (!context) throw new Error('useWatchedHistory must be used within WatchedHistoryProvider')
  return context
}
