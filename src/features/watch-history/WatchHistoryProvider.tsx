import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { MediaItem, MediaType } from '../../types/tmdb'
import type { HistoryState, WatchRecord } from '../../types/watch-history'
import { useAuth } from '../auth/auth-context'
import {
  applyWatchRecord,
  backfillTitleItem,
  continueWatchingTitles,
  entryKey,
  hasReachedEnd,
  isActiveTitle,
  markEpisode,
  markMovie,
  readHistory,
  recordEntryKey,
  removeTitle,
  titleKey,
  writeHistory,
} from './history-state'
import { useHistorySync } from './useHistorySync'
import { WatchedHistoryContext } from './watch-history-context'

export function WatchedHistoryProvider({ children }: { children: ReactNode }) {
  const { account } = useAuth()
  const accountId = account && !account.mustChangePassword ? account.id : null
  const [loadedFor, setLoadedFor] = useState(accountId)
  const [state, setState] = useState<HistoryState>(() => readHistory(accountId))
  if (loadedFor !== accountId) {
    setLoadedFor(accountId)
    setState(readHistory(accountId))
  }

  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
    if (accountId) writeHistory(accountId, state)
  }, [accountId, state])

  const requestUrgentPush = useHistorySync(accountId, state, setState)
  const { entries, titles } = state

  const isEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number) =>
      Boolean(entries[entryKey('tv', showId, seasonNumber, episodeNumber)]?.watched),
    [entries],
  )

  const toggleEpisodeWatched = useCallback((showId: number, seasonNumber: number, episodeNumber: number) => {
    const now = Date.now()
    setState((current) => markEpisode(current, showId, seasonNumber, episodeNumber, (watched) => !watched, now))
  }, [])

  const isMovieWatched = useCallback(
    (movieId: number) => Boolean(entries[entryKey('movie', movieId)]?.watched),
    [entries],
  )

  const toggleMovieWatched = useCallback((movieId: number) => {
    const now = Date.now()
    setState((current) => markMovie(current, movieId, (watched) => !watched, now))
  }, [])

  const getTitleProgress = useCallback(
    (mediaType: MediaType, id: number) => {
      const title = titles[titleKey(mediaType, id)]
      return isActiveTitle(title) ? title : null
    },
    [titles],
  )

  const getResumeTarget = useCallback(
    (showId: number) => {
      const title = titles[titleKey('tv', showId)]
      if (!isActiveTitle(title) || title.seasonNumber == null || title.episodeNumber == null) return null
      return { seasonNumber: title.seasonNumber, episodeNumber: title.episodeNumber }
    },
    [titles],
  )

  const getProgress = useCallback(
    (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) => {
      const entry = entries[entryKey(mediaType, id, seasonNumber, episodeNumber)]
      if (!entry?.position || !entry.duration) return null
      return { position: entry.position, duration: entry.duration }
    },
    [entries],
  )

  const getEntry = useCallback(
    (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) =>
      entries[entryKey(mediaType, id, seasonNumber, episodeNumber)] ?? null,
    [entries],
  )

  // Called by the player's watcher once a title has played for
  // MIN_COUNTED_WATCH_SECONDS, then as playback continues.
  const recordWatch = useCallback((record: WatchRecord) => {
    // Becoming watched is sent straight away, like a manual mark.
    const becameWatched = hasReachedEnd(record) && !stateRef.current.entries[recordEntryKey(record)]?.watched
    if (record.urgent || becameWatched) requestUrgentPush()
    const now = Date.now()
    setState((current) => applyWatchRecord(current, record, now))
  }, [requestUrgentPush])

  const removeFromContinueWatching = useCallback((mediaType: MediaType, id: number) => {
    const now = Date.now()
    setState((current) => removeTitle(current, mediaType, id, now))
  }, [])

  const backfillTitle = useCallback((item: MediaItem) => {
    setState((current) => backfillTitleItem(current, item))
  }, [])

  const continueWatching = useMemo(() => continueWatchingTitles(state), [state])

  const value = useMemo(
    () => ({
      continueWatching,
      isEpisodeWatched,
      toggleEpisodeWatched,
      isMovieWatched,
      toggleMovieWatched,
      getResumeTarget,
      getTitleProgress,
      getProgress,
      getEntry,
      recordWatch,
      removeFromContinueWatching,
      backfillTitle,
    }),
    [
      continueWatching,
      isEpisodeWatched,
      toggleEpisodeWatched,
      isMovieWatched,
      toggleMovieWatched,
      getResumeTarget,
      getTitleProgress,
      getProgress,
      getEntry,
      recordWatch,
      removeFromContinueWatching,
      backfillTitle,
    ],
  )

  return <WatchedHistoryContext.Provider value={value}>{children}</WatchedHistoryContext.Provider>
}
