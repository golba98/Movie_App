import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { ApiClientError, apiRequest } from '../api/client'
import type { MediaItem, MediaType } from '../types/tmdb'
import type { EpisodeRef } from '../utils/media'
import { useAuth } from './useAuth'

const STORAGE_PREFIX = 'fedora-movies:watched-history:v3:'
// Device-wide history from before it synced with the account; merged into the
// first account that signs in on this device.
const UNSCOPED_STORAGE_KEY = 'fedora-movies:watched-history:v2'
const LEGACY_STORAGE_KEY = 'fedora-movies:watched-history:v1'

// A title counts as finished once this share of it has played.
export const WATCHED_THRESHOLD = 0.9
// Playback shorter than this never enters history, so accidental plays don't count.
export const MIN_COUNTED_WATCH_SECONDS = 300

// Changes are pushed in batches: soon after the first change, then at most once
// a minute while playing. Manual changes and closing the page push immediately.
const PUSH_DELAY_MS = 2_000
const PUSH_INTERVAL_MS = 60_000
const PULL_INTERVAL_MS = 30_000
const MAX_PUSH_ENTRIES = 200
const MAX_PUSH_TITLES = 100

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
  // Removed from Continue Watching; kept so other devices learn about it.
  dismissed?: boolean
}

interface HistoryState {
  entries: Record<string, WatchedItem>
  titles: Record<string, TitleProgress>
}

export interface PlaybackProgress {
  position: number
  duration: number
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
  // Push to the account now, e.g. the player is stopping or the page is closing.
  urgent?: boolean
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
  getEntry: (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) => WatchedItem | null
  recordWatch: (record: WatchRecord) => void
  removeFromContinueWatching: (mediaType: MediaType, id: number) => void
  backfillTitle: (item: MediaItem) => void
}

const WatchedHistoryContext = createContext<WatchedHistoryContextValue | null>(null)

const EMPTY_STATE: HistoryState = { entries: {}, titles: {} }

const titleKey = (mediaType: MediaType, id: number) => `${mediaType}:${id}`

function entryKey(mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) {
  return mediaType === 'tv' ? `tv:${id}:${seasonNumber}:${episodeNumber}` : `movie:${id}`
}

// Mirrors the server's validation so one malformed local key can't block a sync.
const SYNCABLE_ENTRY_KEY = /^(movie:[1-9]\d*|tv:[1-9]\d*:\d+:[1-9]\d*)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const finiteOrNull = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

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

function asHistoryState(value: unknown): HistoryState | null {
  return isRecord(value) && isRecord(value.entries) && isRecord(value.titles)
    ? (value as unknown as HistoryState)
    : null
}

// Takes history saved before it was tied to an account, removing it from the device.
function takeUnscopedHistory(): HistoryState | null {
  try {
    const stored = localStorage.getItem(UNSCOPED_STORAGE_KEY)
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY)
    localStorage.removeItem(UNSCOPED_STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
    if (stored) return asHistoryState(JSON.parse(stored))
    return legacy ? migrateLegacyHistory(JSON.parse(legacy)) : null
  } catch {
    return null
  }
}

interface CachedHistory {
  state: HistoryState
  pendingEntries: string[]
  pendingTitles: string[]
}

function readCache(accountId: string): CachedHistory | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + accountId) ?? 'null')
    const state = asHistoryState(parsed)
    if (!state || !isRecord(parsed)) return null
    const pending = isRecord(parsed.pending) ? parsed.pending : {}
    const keys = (value: unknown) => (Array.isArray(value) ? value.filter((key) => typeof key === 'string') : [])
    return {
      state: { entries: state.entries, titles: state.titles },
      pendingEntries: keys(pending.entries),
      pendingTitles: keys(pending.titles),
    }
  } catch {
    return null
  }
}

interface WireEntry {
  key: string
  watched: boolean
  position: number | null
  duration: number | null
  watchSeconds: number
  updatedAt: number
}

interface WireTitle {
  mediaType: MediaType
  id: number
  seasonNumber: number | null
  episodeNumber: number | null
  item: MediaItem | null
  dismissed: boolean
  updatedAt: number
}

function toWireEntry(key: string, entry: WatchedItem): WireEntry | null {
  if (!SYNCABLE_ENTRY_KEY.test(key)) return null
  const position = finiteOrNull(entry.position)
  const duration = finiteOrNull(entry.duration)
  return {
    key,
    watched: entry.watched,
    position: position !== null && position >= 0 ? position : null,
    duration: duration !== null && duration > 0 ? duration : null,
    watchSeconds: Math.max(0, finiteOrNull(entry.watchSeconds) ?? 0),
    updatedAt: Math.max(1, entry.updatedAt),
  }
}

function toWireTitle(title: TitleProgress): WireTitle | null {
  if (!Number.isInteger(title.id) || title.id <= 0) return null
  const hasEpisode = title.mediaType === 'tv'
    && Number.isInteger(title.seasonNumber) && title.seasonNumber! >= 0
    && Number.isInteger(title.episodeNumber) && title.episodeNumber! > 0
  return {
    mediaType: title.mediaType,
    id: title.id,
    seasonNumber: hasEpisode ? title.seasonNumber : null,
    episodeNumber: hasEpisode ? title.episodeNumber : null,
    item: title.item ?? null,
    dismissed: Boolean(title.dismissed),
    updatedAt: Math.max(1, title.updatedAt),
  }
}

// Newer updatedAt wins per entry and per title; ties keep the local copy.
function mergeRemote(local: HistoryState, remote: unknown): HistoryState {
  if (!isRecord(remote)) return local
  let entries = local.entries
  let titles = local.titles

  for (const wire of Array.isArray(remote.entries) ? remote.entries : []) {
    if (!isRecord(wire) || typeof wire.key !== 'string' || typeof wire.updatedAt !== 'number') continue
    const current = entries[wire.key]
    if (current && current.updatedAt >= wire.updatedAt) continue
    if (entries === local.entries) entries = { ...entries }
    entries[wire.key] = {
      watched: wire.watched === true,
      updatedAt: wire.updatedAt,
      position: finiteOrNull(wire.position) ?? undefined,
      duration: finiteOrNull(wire.duration) ?? undefined,
      watchSeconds: finiteOrNull(wire.watchSeconds) ?? undefined,
    }
  }

  for (const wire of Array.isArray(remote.titles) ? remote.titles : []) {
    if (!isRecord(wire) || typeof wire.updatedAt !== 'number' || !Number.isInteger(wire.id)) continue
    if (wire.mediaType !== 'movie' && wire.mediaType !== 'tv') continue
    const key = titleKey(wire.mediaType, wire.id as number)
    const current = titles[key]
    if (current && current.updatedAt >= wire.updatedAt) continue
    if (titles === local.titles) titles = { ...titles }
    const item = isRecord(wire.item) && typeof wire.item.title === 'string'
      ? (wire.item as unknown as MediaItem)
      : current?.item
    titles[key] = {
      mediaType: wire.mediaType,
      id: wire.id as number,
      item,
      seasonNumber: finiteOrNull(wire.seasonNumber),
      episodeNumber: finiteOrNull(wire.episodeNumber),
      updatedAt: wire.updatedAt,
      dismissed: wire.dismissed === true,
    }
  }

  return entries === local.entries && titles === local.titles ? local : { entries, titles }
}

function mergeLocal(base: HistoryState, incoming: HistoryState): HistoryState {
  return mergeRemote(base, {
    entries: Object.entries(incoming.entries).map(([key, entry]) => ({ key, ...entry })),
    titles: Object.values(incoming.titles),
  })
}

// Keeps the account's history, its local cache and the server in step. State
// changes apply synchronously so a push during page close sends the latest data.
function createHistorySync(publish: (state: HistoryState) => void) {
  let accountId: string | null = null
  let state = EMPTY_STATE
  const pendingEntries = new Set<string>()
  const pendingTitles = new Set<string>()
  let pushTimer: number | null = null
  let lastPushAt = 0
  let lastPullAt = 0
  let pullController: AbortController | null = null

  const commit = (next: HistoryState) => {
    state = next
    publish(next)
  }

  const persist = () => {
    if (!accountId) return
    try {
      localStorage.setItem(
        STORAGE_PREFIX + accountId,
        JSON.stringify({ ...state, pending: { entries: [...pendingEntries], titles: [...pendingTitles] } }),
      )
    } catch (e) {
      console.error('Failed to save watched history to localStorage', e)
    }
  }

  const clearPushTimer = () => {
    if (pushTimer !== null) window.clearTimeout(pushTimer)
    pushTimer = null
  }

  const schedulePush = (urgent: boolean) => {
    if (!accountId || (!pendingEntries.size && !pendingTitles.size)) return
    if (urgent) {
      void push(true)
      return
    }
    if (pushTimer !== null) return
    const wait = Math.max(PUSH_DELAY_MS, lastPushAt + PUSH_INTERVAL_MS - Date.now())
    pushTimer = window.setTimeout(() => {
      pushTimer = null
      void push(false)
    }, wait)
  }

  async function push(urgent: boolean) {
    clearPushTimer()
    const id = accountId
    if (!id || (!pendingEntries.size && !pendingTitles.size)) return
    const entryKeys = [...pendingEntries].slice(0, MAX_PUSH_ENTRIES)
    const titleKeys = [...pendingTitles].slice(0, MAX_PUSH_TITLES)
    entryKeys.forEach((key) => pendingEntries.delete(key))
    titleKeys.forEach((key) => pendingTitles.delete(key))
    lastPushAt = Date.now()
    const body = {
      entries: entryKeys.flatMap((key) => {
        const wire = state.entries[key] ? toWireEntry(key, state.entries[key]) : null
        return wire ? [wire] : []
      }),
      titles: titleKeys.flatMap((key) => {
        const wire = state.titles[key] ? toWireTitle(state.titles[key]) : null
        return wire ? [wire] : []
      }),
    }
    persist()
    if (!body.entries.length && !body.titles.length) return

    try {
      await apiRequest('/api/watch-history/sync', {
        method: 'POST',
        body: JSON.stringify(body),
        // Lets the request finish while the page is being closed.
        keepalive: urgent,
      })
      if (accountId !== id) return
      // A full batch means a backlog (e.g. migrated history): keep draining it.
      if (entryKeys.length === MAX_PUSH_ENTRIES || titleKeys.length === MAX_PUSH_TITLES) void push(false)
      else schedulePush(false)
    } catch (error) {
      if (accountId !== id) return
      // A rejected batch would be rejected again; anything else is retried later.
      if (error instanceof ApiClientError && error.status === 400) return
      entryKeys.forEach((key) => pendingEntries.add(key))
      titleKeys.forEach((key) => pendingTitles.add(key))
      persist()
      schedulePush(false)
    }
  }

  async function pull(force = false) {
    const id = accountId
    if (!id) return
    if (!force && Date.now() - lastPullAt < PULL_INTERVAL_MS) return
    lastPullAt = Date.now()
    pullController?.abort()
    const controller = new AbortController()
    pullController = controller
    try {
      const remote = await apiRequest<unknown>('/api/watch-history', { signal: controller.signal })
      if (accountId !== id || controller.signal.aborted) return
      const merged = mergeRemote(state, remote)
      if (merged !== state) {
        commit(merged)
        persist()
      }
    } catch {
      // Offline or signed out: keep showing the cached history.
    } finally {
      if (pullController === controller) pullController = null
    }
  }

  return {
    getState: () => state,

    load(nextAccountId: string | null) {
      if (nextAccountId === accountId) return
      clearPushTimer()
      pullController?.abort()
      pullController = null
      accountId = nextAccountId
      pendingEntries.clear()
      pendingTitles.clear()
      lastPullAt = 0
      lastPushAt = 0
      if (!nextAccountId) {
        commit(EMPTY_STATE)
        return
      }

      const cached = readCache(nextAccountId)
      let initial = cached?.state ?? EMPTY_STATE
      cached?.pendingEntries.forEach((key) => pendingEntries.add(key))
      cached?.pendingTitles.forEach((key) => pendingTitles.add(key))
      const unscoped = takeUnscopedHistory()
      if (unscoped) {
        initial = mergeLocal(initial, unscoped)
        Object.keys(unscoped.entries).forEach((key) => pendingEntries.add(key))
        Object.keys(unscoped.titles).forEach((key) => pendingTitles.add(key))
      }
      commit(initial)
      persist()
      void pull(true)
      schedulePush(false)
    },

    apply(next: HistoryState, changed: { entries?: string[]; titles?: string[] }, urgent = false) {
      if (next === state) return
      commit(next)
      if (!accountId) return
      changed.entries?.forEach((key) => pendingEntries.add(key))
      changed.titles?.forEach((key) => pendingTitles.add(key))
      persist()
      schedulePush(urgent)
    },

    pull,
    push,
  }
}

export function WatchedHistoryProvider({ children }: { children: React.ReactNode }) {
  const { account } = useAuth()
  const accountId = account && !account.mustChangePassword ? account.id : null
  const [state, setState] = useState<HistoryState>(EMPTY_STATE)
  const [sync] = useState(() => createHistorySync(setState))

  useEffect(() => {
    sync.load(accountId)
  }, [sync, accountId])

  // Pick up changes made on other devices when this one comes back into use,
  // and push anything outstanding when it is hidden or closed.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void sync.pull()
      else void sync.push(true)
    }
    const onFocus = () => void sync.pull()
    const onPageHide = () => void sync.push(true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [sync])

  const history = state.entries

  const setMovieEntry = useCallback((movieId: number, watched: boolean | ((current: boolean) => boolean)) => {
    const current = sync.getState()
    const key = entryKey('movie', movieId)
    const previous = current.entries[key]
    const nextWatched = typeof watched === 'function' ? watched(Boolean(previous?.watched)) : watched
    sync.apply(
      {
        ...current,
        entries: {
          ...current.entries,
          [key]: {
            ...previous,
            watched: nextWatched,
            updatedAt: Date.now(),
            // Unmarking restarts the title rather than resuming at the credits.
            ...(nextWatched ? {} : { position: undefined, watchSeconds: 0 }),
          },
        },
      },
      { entries: [key] },
      true,
    )
  }, [sync])

  const isEpisodeWatched = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number) =>
      Boolean(history[entryKey('tv', showId, seasonNumber, episodeNumber)]?.watched),
    [history],
  )

  // Marking an episode watched moves the show's resume point past it.
  const markEpisode = useCallback(
    (showId: number, seasonNumber: number, episodeNumber: number, watched: boolean | ((current: boolean) => boolean)) => {
      const current = sync.getState()
      const key = entryKey('tv', showId, seasonNumber, episodeNumber)
      const nextWatched = typeof watched === 'function' ? watched(Boolean(current.entries[key]?.watched)) : watched
      const now = Date.now()
      const entries = {
        ...current.entries,
        [key]: {
          ...current.entries[key],
          watched: nextWatched,
          updatedAt: now,
          ...(nextWatched ? {} : { position: undefined, watchSeconds: 0 }),
        },
      }
      if (!nextWatched) {
        sync.apply({ ...current, entries }, { entries: [key] }, true)
        return
      }
      const tKey = titleKey('tv', showId)
      sync.apply(
        {
          entries,
          titles: {
            ...current.titles,
            [tKey]: {
              ...current.titles[tKey],
              mediaType: 'tv',
              id: showId,
              seasonNumber,
              episodeNumber,
              updatedAt: now,
              dismissed: false,
            },
          },
        },
        { entries: [key], titles: [tKey] },
        true,
      )
    },
    [sync],
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
    (movieId: number, watched: boolean) => setMovieEntry(movieId, watched),
    [setMovieEntry],
  )

  const toggleMovieWatched = useCallback(
    (movieId: number) => setMovieEntry(movieId, (current) => !current),
    [setMovieEntry],
  )

  const getTitleProgress = useCallback(
    (mediaType: MediaType, id: number) => {
      const title = state.titles[titleKey(mediaType, id)]
      return title && !title.dismissed ? title : null
    },
    [state.titles],
  )

  const getResumeTarget = useCallback(
    (showId: number) => {
      const title = state.titles[titleKey('tv', showId)]
      if (!title || title.dismissed || title.seasonNumber == null || title.episodeNumber == null) return null
      return { seasonNumber: title.seasonNumber, episodeNumber: title.episodeNumber }
    },
    [state.titles],
  )

  const getEntry = useCallback(
    (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) =>
      history[entryKey(mediaType, id, seasonNumber, episodeNumber)] ?? null,
    [history],
  )

  const getProgress = useCallback(
    (mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) => {
      const entry = history[entryKey(mediaType, id, seasonNumber, episodeNumber)]
      if (!entry?.position || !entry.duration) return null
      return { position: entry.position, duration: entry.duration }
    },
    [history],
  )

  const recordWatch = useCallback(
    ({ item, seasonNumber, episodeNumber, watchSeconds, position, duration, finished, urgent }: WatchRecord) => {
      const current = sync.getState()
      const { mediaType, id } = item
      const season = mediaType === 'tv' ? seasonNumber : null
      const episode = mediaType === 'tv' ? episodeNumber : null
      const key = entryKey(mediaType, id, season, episode)
      const tKey = titleKey(mediaType, id)
      const previous = current.entries[key]
      const hasPosition = position != null && duration != null
        && Number.isFinite(position) && Number.isFinite(duration) && position >= 0 && duration > 0
      const watched = Boolean(previous?.watched)
        || Boolean(finished)
        || (hasPosition && position / duration >= WATCHED_THRESHOLD)
      const now = Date.now()
      sync.apply(
        {
          entries: {
            ...current.entries,
            [key]: {
              watched,
              updatedAt: now,
              position: hasPosition ? position : previous?.position,
              duration: hasPosition ? duration : previous?.duration,
              watchSeconds: Number.isFinite(watchSeconds) ? Math.max(0, watchSeconds) : previous?.watchSeconds,
            },
          },
          titles: {
            ...current.titles,
            [tKey]: {
              ...current.titles[tKey],
              mediaType,
              id,
              item,
              seasonNumber: season,
              episodeNumber: episode,
              updatedAt: now,
              dismissed: false,
            },
          },
        },
        { entries: [key], titles: [tKey] },
        Boolean(urgent) || (watched && !previous?.watched),
      )
    },
    [sync],
  )

  const removeFromContinueWatching = useCallback((mediaType: MediaType, id: number) => {
    const current = sync.getState()
    const key = titleKey(mediaType, id)
    const title = current.titles[key]
    if (!title || title.dismissed) return
    sync.apply(
      { ...current, titles: { ...current.titles, [key]: { ...title, dismissed: true, updatedAt: Date.now() } } },
      { titles: [key] },
      true,
    )
  }, [sync])

  const backfillTitle = useCallback((item: MediaItem) => {
    const current = sync.getState()
    const key = titleKey(item.mediaType, item.id)
    const title = current.titles[key]
    if (!title || title.item) return
    // Same updatedAt: the artwork is shared without counting as new activity.
    sync.apply({ ...current, titles: { ...current.titles, [key]: { ...title, item } } }, { titles: [key] })
  }, [sync])

  const continueWatching = useMemo(
    () =>
      Object.values(state.titles)
        .filter((title) => !title.dismissed)
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
      getEntry,
      recordWatch,
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
      getEntry,
      recordWatch,
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
