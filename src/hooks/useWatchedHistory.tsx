import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const STORAGE_KEY = 'fedora-movies:watched-history:v1'

export interface WatchedItem {
  watched: boolean
  updatedAt: number
  progress?: number
}

interface WatchedHistoryContextValue {
  history: Record<string, WatchedItem>
  isEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number) => boolean
  toggleEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number) => void
  setEpisodeWatched: (showId: number, seasonNumber: number, episodeNumber: number, watched: boolean) => void
  isMovieWatched: (movieId: number) => boolean
  toggleMovieWatched: (movieId: number) => void
  setMovieWatched: (movieId: number, watched: boolean) => void
  getLastWatchedEpisode: (showId: number) => { seasonNumber: number; episodeNumber: number } | null
}

const WatchedHistoryContext = createContext<WatchedHistoryContextValue | null>(null)

function readHistory(): Record<string, WatchedItem> {
  try {
    const parsed = localStorage.getItem(STORAGE_KEY)
    return parsed ? JSON.parse(parsed) : {}
  } catch {
    return {}
  }
}

export function WatchedHistoryProvider({ children }: { children: React.ReactNode }) {
  const [history, setHistory] = useState<Record<string, WatchedItem>>(readHistory)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
    } catch (e) {
      console.error('Failed to save watched history to localStorage', e)
    }
  }, [history])

  const isEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number) => {
      const key = `tv:${showId}:${seasonNumber}:${episodeNumber}`
      return Boolean(history[key]?.watched)
    },
    [history]
  )

  const setEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number, watched: boolean) => {
      const key = `tv:${showId}:${seasonNumber}:${episodeNumber}`
      setHistory((current) => ({
        ...current,
        [key]: {
          watched,
          updatedAt: Date.now(),
        },
      }))
    },
    []
  )

  const toggleEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number) => {
      const key = `tv:${showId}:${seasonNumber}:${episodeNumber}`
      setHistory((current) => {
        const wasWatched = Boolean(current[key]?.watched)
        return {
          ...current,
          [key]: {
            watched: !wasWatched,
            updatedAt: Date.now(),
          },
        }
      })
    },
    []
  )

  const isMovieWatched = useCallback(
    (movieId: number) => {
      const key = `movie:${movieId}`
      return Boolean(history[key]?.watched)
    },
    [history]
  )

  const setMovieWatched = useCallback(
    (movieId: number, watched: boolean) => {
      const key = `movie:${movieId}`
      setHistory((current) => ({
        ...current,
        [key]: {
          watched,
          updatedAt: Date.now(),
        },
      }))
    },
    []
  )

  const toggleMovieWatched = useCallback(
    (movieId: number) => {
      const key = `movie:${movieId}`
      setHistory((current) => {
        const wasWatched = Boolean(current[key]?.watched)
        return {
          ...current,
          [key]: {
            watched: !wasWatched,
            updatedAt: Date.now(),
          },
        }
      })
    },
    []
  )

  const getLastWatchedEpisode = useCallback(
    (showId: number) => {
      const prefix = `tv:${showId}:`
      let latestWatched: { seasonNumber: number; episodeNumber: number; updatedAt: number } | null = null

      for (const [key, item] of Object.entries(history)) {
        if (key.startsWith(prefix) && item.watched) {
          const parts = key.split(':')
          if (parts.length === 4) {
            const seasonNumber = Number(parts[2])
            const episodeNumber = Number(parts[3])
            if (
              Number.isInteger(seasonNumber) &&
              Number.isInteger(episodeNumber) &&
              (!latestWatched || item.updatedAt > latestWatched.updatedAt)
            ) {
              latestWatched = { seasonNumber, episodeNumber, updatedAt: item.updatedAt }
            }
          }
        }
      }
      return latestWatched ? { seasonNumber: latestWatched.seasonNumber, episodeNumber: latestWatched.episodeNumber } : null
    },
    [history]
  )

  const value = useMemo(
    () => ({
      history,
      isEpisodeWatched,
      toggleEpisodeWatched,
      setEpisodeWatched,
      isMovieWatched,
      toggleMovieWatched,
      setMovieWatched,
      getLastWatchedEpisode,
    }),
    [
      history,
      isEpisodeWatched,
      toggleEpisodeWatched,
      setEpisodeWatched,
      isMovieWatched,
      toggleMovieWatched,
      setMovieWatched,
      getLastWatchedEpisode,
    ]
  )

  return <WatchedHistoryContext.Provider value={value}>{children}</WatchedHistoryContext.Provider>
}

export function useWatchedHistory() {
  const context = useContext(WatchedHistoryContext)
  if (!context) throw new Error('useWatchedHistory must be used within WatchedHistoryProvider')
  return context
}
