import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { MediaItem, MediaType } from '../types/tmdb'
import type { EpisodeRef } from '../utils/media'

const STORAGE_KEY = 'fedora-movies:watched-history:v2'
const LEGACY_STORAGE_KEY = 'fedora-movies:watched-history:v1'

// A title counts as finished once this share of it has played.
export const WATCHED_THRESHOLD = 0.9

export interface WatchedItem {
  watched: boolean
  updatedAt: number
  position?: number
  duration?: number
}

// The most recent activity for a whole title; drives Continue Watching.
export interface TitleProgress {
  mediaType: MediaType
  id: number
  item?: MediaItem
  seasonNumber: number | null
  episodeNumber: number | null
  updatedAt: number
}

interface HistoryState {
  entries: Record<string, WatchedItem>
  titles: Record<string, TitleProgress>
}

export interface PlaybackProgress {
  position: number
  duration: number
}

interface WatchedHistoryContextValue {
  history: Record<string, WatchedItem>
  continueWatching: TitleProgress[]
  isEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number) => boolean
  toggleEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number) => void
  setEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number, watched: boolean) => void
  isMovieWatched: (movieId: number) => boolean
  toggleMovieWatched: (movieId: number) => void
  setMovieWatched: (movieId: number, watched: boolean) => void
  getResumeTarget: (showId: number) => EpisodeRef | null
  getTitleProgress: (mediaType: MediaType, id: number) => TitleProgress | null
  getProgress: (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) => PlaybackProgress | null
  recordPlaybackStart: (item: MediaItem, seasonNumber?: number | null, episodeNumber?: number | null) => void
  recordProgress: (
    mediaType: MediaType,
    id: number,
    seasonNumber: number | null,
    episodeNumber: number | null,
    position: number,
    duration: number,
  ) => void
  removeFromContinueWatching: (mediaType: MediaType, id: number) => void
  backfillTitle: (item: MediaItem) => void
}

const WatchedHistoryContext = createContext<WatchedHistoryContextValue | null>(null)

const titleKey = (mediaType: MediaType, id: number) => `${mediaType}:${id}`

function entryKey(mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) {
  return mediaType === 'tv' ? `tv:${id}:${seasonNumber}:${episodeNumber}` : `movie:${id}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// v1 marked titles watched as soon as playback started, so those flags are
// unreliable. Keep the activity, but treat every entry as still in progress.
function migrateLegacyHistory(legacy: unknown): HistoryState {
  const state: HistoryState = { entries: {}, titles: {} }
  if (!isRecord(legacy)) return state

  for (const [key, value] of Object.entries(legacy)) {
    if (!isRecord(value)) continue
    const updatedAt = typeof value.updatedAt === 'number' ? value.updatedAt : 0
    const parts = key.split(':')
    const id = Number(parts[1])
    if (!Number.isInteger(id) || id <= 0) continue

    let title: TitleProgress | null = null
    if (parts[0] === 'movie' && parts.length === 2) {
      title = { mediaType: 'movie', id, seasonNumber: null, episodeNumber: null, updatedAt }
    } else if (parts[0] === 'tv' && parts.length === 4) {
      const seasonNumber = Number(parts[2])
      const episodeNumber = Number(parts[3])
      if (!Number.isInteger(seasonNumber) || !Number.isInteger(episodeNumber)) continue
      title = { mediaType: 'tv', id, seasonNumber, episodeNumber, updatedAt }
    }
    if (!title) continue

    state.entries[key] = { watched: false, updatedAt }
    const existing = state.titles[titleKey(title.mediaType, id)]
    if (!existing || updatedAt > existing.updatedAt) state.titles[titleKey(title.mediaType, id)] = title
  }
  return state
}

function readHistory(): HistoryState {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed: unknown = JSON.parse(stored)
      if (isRecord(parsed) && isRecord(parsed.entries) && isRecord(parsed.titles)) {
        return parsed as unknown as HistoryState
      }
      return { entries: {}, titles: {} }
    }
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    return legacy ? migrateLegacyHistory(JSON.parse(legacy)) : { entries: {}, titles: {} }
  } catch {
    return { entries: {}, titles: {} }
  }
}

export function WatchedHistoryProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HistoryState>(readHistory)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch (e) {
      console.error('Failed to save watched history to localStorage', e)
    }
  }, [state])

  const history = state.entries

  const setEntryWatched = useCallback((key: string, watched: boolean | ((current: boolean) => boolean)) => {
    setState((current) => {
      const previous = current.entries[key]
      const nextWatched = typeof watched === 'function' ? watched(Boolean(previous?.watched)) : watched
      return {
        ...current,
        entries: {
          ...current.entries,
          [key]: {
            ...previous,
            watched: nextWatched,
            updatedAt: Date.now(),
            // Unmarking restarts the title rather than resuming at the credits.
            ...(nextWatched ? {} : { position: undefined }),
          },
        },
      }
    })
  }, [])

  const isEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number) =>
      Boolean(history[entryKey('tv', showId, seasonNumber, episodeNumber)]?.watched),
    [history],
  )

  // Marking an episode watched moves the show's resume point past it.
  const markEpisode = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number, watched: boolean | ((current: boolean) => boolean)) => {
      const key = entryKey('tv', showId, seasonNumber, episodeNumber)
      setState((current) => {
        const nextWatched = typeof watched === 'function' ? watched(Boolean(current.entries[key]?.watched)) : watched
        const now = Date.now()
        const entries = {
          ...current.entries,
          [key]: {
            ...current.entries[key],
            watched: nextWatched,
            updatedAt: now,
            ...(nextWatched ? {} : { position: undefined }),
          },
        }
        if (!nextWatched) return { ...current, entries }
        const title = current.titles[titleKey('tv', showId)]
        return {
          entries,
          titles: {
            ...current.titles,
            [titleKey('tv', showId)]: { ...title, mediaType: 'tv', id: showId, seasonNumber, episodeNumber, updatedAt: now },
          },
        }
      })
    },
    [],
  )

  const setEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number, watched: boolean) =>
      markEpisode(showId, seasonNumber, episodeNumber, watched),
    [markEpisode],
  )

  const toggleEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number) =>
      markEpisode(showId, seasonNumber, episodeNumber, (current) => !current),
    [markEpisode],
  )

  const isMovieWatched = useCallback(
    (movieId: number) => Boolean(history[entryKey('movie', movieId)]?.watched),
    [history],
  )

  const setMovieWatched = useCallback(
    (movieId: number, watched: boolean) => setEntryWatched(entryKey('movie', movieId), watched),
    [setEntryWatched],
  )

  const toggleMovieWatched = useCallback(
    (movieId: number) => setEntryWatched(entryKey('movie', movieId), (current) => !current),
    [setEntryWatched],
  )

  const getTitleProgress = useCallback(
    (mediaType: MediaType, id: number) => state.titles[titleKey(mediaType, id)] ?? null,
    [state.titles],
  )

  const getResumeTarget = useCallback(
    (showId: number) => {
      const title = state.titles[titleKey('tv', showId)]
      if (!title || title.seasonNumber == null || title.episodeNumber == null) return null
      return { seasonNumber: title.seasonNumber, episodeNumber: title.episodeNumber }
    },
    [state.titles],
  )

  const getProgress = useCallback(
    (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) => {
      const entry = history[entryKey(mediaType, id, seasonNumber, episodeNumber)]
      if (!entry?.position || !entry.duration) return null
      return { position: entry.position, duration: entry.duration }
    },
    [history],
  )

  const recordPlaybackStart = useCallback(
    (item: MediaItem, seasonNumber: number | null = null, episodeNumber: number | null = null) => {
      const now = Date.now()
      const key = entryKey(item.mediaType, item.id, seasonNumber, episodeNumber)
      setState((current) => ({
        entries: {
          ...current.entries,
          [key]: { ...current.entries[key], watched: Boolean(current.entries[key]?.watched), updatedAt: now },
        },
        titles: {
          ...current.titles,
          [titleKey(item.mediaType, item.id)]: {
            mediaType: item.mediaType,
            id: item.id,
            item,
            seasonNumber: item.mediaType === 'tv' ? seasonNumber : null,
            episodeNumber: item.mediaType === 'tv' ? episodeNumber : null,
            updatedAt: now,
          },
        },
      }))
    },
    [],
  )

  const recordProgress = useCallback(
    (
      mediaType: MediaType,
      id: number,
      seasonNumber: number | null,
      episodeNumber: number | null,
      position: number,
      duration: number,
    ) => {
      if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0 || position < 0) return
      const now = Date.now()
      const key = entryKey(mediaType, id, seasonNumber, episodeNumber)
      setState((current) => {
        const previous = current.entries[key]
        const title = current.titles[titleKey(mediaType, id)]
        return {
          entries: {
            ...current.entries,
            [key]: {
              watched: Boolean(previous?.watched) || position / duration >= WATCHED_THRESHOLD,
              updatedAt: now,
              position,
              duration,
            },
          },
          titles: {
            ...current.titles,
            [titleKey(mediaType, id)]: {
              ...title,
              mediaType,
              id,
              seasonNumber: mediaType === 'tv' ? seasonNumber : null,
              episodeNumber: mediaType === 'tv' ? episodeNumber : null,
              updatedAt: now,
            },
          },
        }
      })
    },
    [],
  )

  const removeFromContinueWatching = useCallback((mediaType: MediaType, id: number) => {
    setState((current) => {
      const key = titleKey(mediaType, id)
      if (!(key in current.titles)) return current
      const titles = { ...current.titles }
      delete titles[key]
      return { ...current, titles }
    })
  }, [])

  const backfillTitle = useCallback((item: MediaItem) => {
    setState((current) => {
      const key = titleKey(item.mediaType, item.id)
      const title = current.titles[key]
      if (!title || title.item) return current
      return { ...current, titles: { ...current.titles, [key]: { ...title, item } } }
    })
  }, [])

  const continueWatching = useMemo(
    () =>
      Object.values(state.titles)
        .filter((title) => title.mediaType === 'tv' || !state.entries[entryKey('movie', title.id)]?.watched)
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [state],
  )

  const value = useMemo(
    () => ({
      history,
      continueWatching,
      isEpisodeWatched,
      toggleEpisodeWatched,
      setEpisodeWatched,
      isMovieWatched,
      toggleMovieWatched,
      setMovieWatched,
      getResumeTarget,
      getTitleProgress,
      getProgress,
      recordPlaybackStart,
      recordProgress,
      removeFromContinueWatching,
      backfillTitle,
    }),
    [
      history,
      continueWatching,
      isEpisodeWatched,
      toggleEpisodeWatched,
      setEpisodeWatched,
      isMovieWatched,
      toggleMovieWatched,
      setMovieWatched,
      getResumeTarget,
      getTitleProgress,
      getProgress,
      recordPlaybackStart,
      recordProgress,
      removeFromContinueWatching,
      backfillTitle,
    ],
  )

  return <WatchedHistoryContext.Provider value={value}>{children}</WatchedHistoryContext.Provider>
}

export function useWatchedHistory() {
  const context = useContext(WatchedHistoryContext)
  if (!context) throw new Error('useWatchedHistory must be used within WatchedHistoryProvider')
  return context
}
