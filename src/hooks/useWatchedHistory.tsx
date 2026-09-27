import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import type { MediaItem, MediaType } from '../types/tmdb'
import type { EpisodeRef } from '../utils/media'
import { useAuth } from './useAuth'

const STORAGE_KEY = 'fedora-movies:watched-history:v2'
const LEGACY_STORAGE_KEY = 'fedora-movies:watched-history:v1'
const SYNC_ENDPOINT = '/api/watch-history'
// The first change after a quiet spell syncs quickly; progress saved during
// playback (every few seconds) is batched into one request per interval.
const SYNC_DELAY_MS = 2_000
const SYNC_INTERVAL_MS = 10_000
const PULL_INTERVAL_MS = 30_000
const MAX_SYNC_ITEMS = 500
// keepalive requests are limited to 64 KiB of body.
const MAX_KEEPALIVE_ITEMS = 100

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
  // Removed from Continue Watching; kept so the removal syncs to other devices.
  removed?: boolean
}

export interface HistoryState {
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

const emptyHistory = (): HistoryState => ({ entries: {}, titles: {} })
const accountStorageKey = (accountId: string) => `${STORAGE_KEY}:${accountId}`

function isHistoryState(value: unknown): value is HistoryState {
  return isRecord(value) && isRecord(value.entries) && isRecord(value.titles)
}

// Each account keeps its own cache. History saved before accounts were
// separated is adopted by the first account to sign in on this device, so
// it gets uploaded rather than lost.
function readStored(key: string): HistoryState | null {
  try {
    const stored = localStorage.getItem(key)
    if (!stored) return null
    const parsed: unknown = JSON.parse(stored)
    if (key === LEGACY_STORAGE_KEY) return migrateLegacyHistory(parsed)
    return isHistoryState(parsed) ? parsed : emptyHistory()
  } catch {
    return emptyHistory()
  }
}

function readHistory(accountId: string | null): HistoryState {
  if (!accountId) return emptyHistory()
  return [STORAGE_KEY, LEGACY_STORAGE_KEY].reduce(
    (history, key) => {
      const adopted = readStored(key)
      return adopted ? mergeHistory(history, adopted) : history
    },
    readStored(accountStorageKey(accountId)) ?? emptyHistory(),
  )
}

const isActiveTitle = (title: TitleProgress | undefined): title is TitleProgress => Boolean(title && !title.removed)

// Playing or marking a title again brings it back to Continue Watching.
function withoutRemoval(title: TitleProgress | undefined): Partial<TitleProgress> {
  if (!title) return {}
  const revived = { ...title }
  delete revived.removed
  return revived
}

// Combines this device's history with the server's: for every movie, episode
// and title the most recent update wins.
export function mergeHistory(local: HistoryState, remote: HistoryState): HistoryState {
  let entries = local.entries
  for (const [key, entry] of Object.entries(remote.entries)) {
    if (!isRecord(entry) || typeof entry.updatedAt !== 'number') continue
    if ((local.entries[key]?.updatedAt ?? -1) >= entry.updatedAt) continue
    if (entries === local.entries) entries = { ...local.entries }
    entries[key] = entry
  }
  let titles = local.titles
  for (const [key, title] of Object.entries(remote.titles)) {
    if (!isRecord(title) || typeof title.updatedAt !== 'number') continue
    const current = local.titles[key]
    if ((current?.updatedAt ?? -1) >= title.updatedAt) continue
    if (titles === local.titles) titles = { ...local.titles }
    titles[key] = { ...title, item: title.item ?? current?.item }
  }
  return entries === local.entries && titles === local.titles ? local : { entries, titles }
}

interface SyncedVersions {
  entries: Record<string, number>
  titles: Record<string, number>
}

// Everything changed on this device since the server last confirmed it.
function pendingChanges(state: HistoryState, synced: SyncedVersions, limit: number) {
  const entries = Object.entries(state.entries)
    .filter(([key, entry]) => entry.updatedAt > (synced.entries[key] ?? 0))
    .slice(0, limit)
    .map(([key, entry]) => ({ key, ...entry }))
  const titles = Object.entries(state.titles)
    .filter(([key, title]) => title.updatedAt > (synced.titles[key] ?? 0))
    .slice(0, limit - entries.length)
    .map(([key, title]) => ({ key, ...title }))
  return { entries, titles }
}

export function WatchedHistoryProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAuth()
  const accountId = account && !account.mustChangePassword ? account.id : null
  const [loadedFor, setLoadedFor] = useState(accountId)
  const [state, setState] = useState<HistoryState>(() => readHistory(accountId))
  if (loadedFor !== accountId) {
    setLoadedFor(accountId)
    setState(readHistory(accountId))
  }

  useEffect(() => {
    if (!accountId) return
    try {
      localStorage.setItem(accountStorageKey(accountId), JSON.stringify(state))
      localStorage.removeItem(STORAGE_KEY)
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch (e) {
      console.error('Failed to save watched history to localStorage', e)
    }
  }, [accountId, state])

  // --- Server sync -------------------------------------------------------
  // localStorage is the instant, offline cache; the server makes history
  // follow the account across devices.
  const stateRef = useRef(state)
  const accountIdRef = useRef(accountId)
  const syncedRef = useRef<SyncedVersions>({ entries: {}, titles: {} })
  const pulledRef = useRef(false)
  const pushingRef = useRef(false)
  const pushTimerRef = useRef<number | null>(null)
  const lastPushRef = useRef(0)
  const lastPullRef = useRef(0)
  // Bumped after each pull and push so the scheduling effect re-checks for
  // changes that are still unsent.
  const [syncTick, setSyncTick] = useState(0)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const markSynced = useCallback((kind: keyof SyncedVersions, key: string, updatedAt: number) => {
    const versions = syncedRef.current[kind]
    versions[key] = Math.max(versions[key] ?? 0, updatedAt)
  }, [])

  const push = useCallback(async (keepalive = false) => {
    const syncAccountId = accountIdRef.current
    if (!syncAccountId || !pulledRef.current || (pushingRef.current && !keepalive)) return
    const changes = pendingChanges(stateRef.current, syncedRef.current, keepalive ? MAX_KEEPALIVE_ITEMS : MAX_SYNC_ITEMS)
    if (!changes.entries.length && !changes.titles.length) return
    pushingRef.current = true
    lastPushRef.current = Date.now()
    try {
      await apiRequest(SYNC_ENDPOINT, { method: 'POST', body: JSON.stringify(changes), keepalive })
      if (accountIdRef.current !== syncAccountId) return
      for (const { key, updatedAt } of changes.entries) markSynced('entries', key, updatedAt)
      for (const { key, updatedAt } of changes.titles) markSynced('titles', key, updatedAt)
    } catch (error) {
      console.warn('Watch history sync failed; it will retry.', error)
    } finally {
      pushingRef.current = false
    }
  }, [markSynced])

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current !== null) return
    const delay = Math.max(SYNC_DELAY_MS, lastPushRef.current + SYNC_INTERVAL_MS - Date.now())
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null
      void push().then(() => setSyncTick((tick) => tick + 1))
    }, delay)
  }, [push])

  const pull = useCallback(async () => {
    const syncAccountId = accountIdRef.current
    if (!syncAccountId) return
    lastPullRef.current = Date.now()
    try {
      const remote = await apiRequest<unknown>(SYNC_ENDPOINT)
      if (accountIdRef.current !== syncAccountId || !isHistoryState(remote)) return
      for (const [key, entry] of Object.entries(remote.entries)) {
        if (typeof entry?.updatedAt === 'number') markSynced('entries', key, entry.updatedAt)
      }
      for (const [key, title] of Object.entries(remote.titles)) {
        if (typeof title?.updatedAt === 'number') markSynced('titles', key, title.updatedAt)
      }
      pulledRef.current = true
      setState((current) => mergeHistory(current, remote))
      // Uploads anything only this device knows about, even if the merge
      // changed nothing locally.
      setSyncTick((tick) => tick + 1)
    } catch (error) {
      console.warn('Unable to load watch history from the server.', error)
    }
  }, [markSynced])

  useEffect(() => {
    accountIdRef.current = accountId
    syncedRef.current = { entries: {}, titles: {} }
    pulledRef.current = false
    lastPushRef.current = 0
    if (!accountId) return
    void pull()
    return () => {
      if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current)
      pushTimerRef.current = null
    }
  }, [accountId, pull])

  useEffect(() => {
    if (!accountId || !pulledRef.current) return
    const changes = pendingChanges(state, syncedRef.current, 1)
    if (changes.entries.length || changes.titles.length) schedulePush()
  }, [accountId, state, syncTick, schedulePush])

  // Pick up changes from other devices when the app comes back into view, and
  // send ours before the page is hidden or closed.
  useEffect(() => {
    if (!accountId) return
    const refresh = () => {
      if (Date.now() - lastPullRef.current >= PULL_INTERVAL_MS) void pull()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
      else void push(true)
    }
    const onPageHide = () => void push(true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [accountId, pull, push])

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
            [titleKey('tv', showId)]: { ...withoutRemoval(title), mediaType: 'tv', id: showId, seasonNumber, episodeNumber, updatedAt: now },
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
    (mediaType: MediaType, id: number) => {
      const title = state.titles[titleKey(mediaType, id)]
      return isActiveTitle(title) ? title : null
    },
    [state.titles],
  )

  const getResumeTarget = useCallback(
    (showId: number) => {
      const title = state.titles[titleKey('tv', showId)]
      if (!isActiveTitle(title) || title.seasonNumber == null || title.episodeNumber == null) return null
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
              ...withoutRemoval(title),
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
      const title = current.titles[key]
      if (!isActiveTitle(title)) return current
      return { ...current, titles: { ...current.titles, [key]: { ...title, removed: true, updatedAt: Date.now() } } }
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
        .filter((title) => !title.removed)
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
