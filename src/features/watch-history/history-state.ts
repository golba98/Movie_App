import { isRecord } from '../../lib/is-record'
import type { MediaItem, MediaType } from '../../types/tmdb'
import type { HistoryState, TitleProgress, WatchRecord } from '../../types/watch-history'

const STORAGE_KEY = 'fedora-movies:watched-history:v2'
const LEGACY_STORAGE_KEY = 'fedora-movies:watched-history:v1'

// A title counts as finished once this share of it has played.
export const WATCHED_THRESHOLD = 0.9
// Playback shorter than this never enters history, so accidental plays don't count.
export const MIN_COUNTED_WATCH_SECONDS = 300

type WatchedUpdate = boolean | ((current: boolean) => boolean)

export const titleKey = (mediaType: MediaType, id: number) => `${mediaType}:${id}`

export function entryKey(mediaType: MediaType, id: number, seasonNumber?: number | null, episodeNumber?: number | null) {
  return mediaType === 'tv' ? `tv:${id}:${seasonNumber}:${episodeNumber}` : `movie:${id}`
}

const emptyHistory = (): HistoryState => ({ entries: {}, titles: {} })

export function isHistoryState(value: unknown): value is HistoryState {
  return isRecord(value) && isRecord(value.entries) && isRecord(value.titles)
}

export const isActiveTitle = (title: TitleProgress | undefined): title is TitleProgress =>
  Boolean(title && !title.removed)

// v1 marked titles watched as soon as playback started, so those flags are
// unreliable. Keep the activity, but treat every entry as still in progress.
function migrateLegacyHistory(legacy: unknown): HistoryState {
  const state = emptyHistory()
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

const accountStorageKey = (accountId: string) => `${STORAGE_KEY}:${accountId}`

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

// Each account keeps its own cache. History saved before accounts were
// separated is adopted by the first account to sign in on this device, so
// it gets uploaded rather than lost.
export function readHistory(accountId: string | null): HistoryState {
  if (!accountId) return emptyHistory()
  return [STORAGE_KEY, LEGACY_STORAGE_KEY].reduce(
    (history, key) => {
      const adopted = readStored(key)
      return adopted ? mergeHistory(history, adopted) : history
    },
    readStored(accountStorageKey(accountId)) ?? emptyHistory(),
  )
}

export function writeHistory(accountId: string, state: HistoryState) {
  try {
    localStorage.setItem(accountStorageKey(accountId), JSON.stringify(state))
    localStorage.removeItem(STORAGE_KEY)
    localStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch (error) {
    console.error('Failed to save watched history to localStorage', error)
  }
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

export interface SyncedVersions {
  entries: Record<string, number>
  titles: Record<string, number>
}

// Everything changed on this device since the server last confirmed it.
export function pendingChanges(state: HistoryState, synced: SyncedVersions, limit: number) {
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

export type HistoryChanges = ReturnType<typeof pendingChanges>

// Playing or marking a title again brings it back to Continue Watching.
function withoutRemoval(title: TitleProgress | undefined): Partial<TitleProgress> {
  if (!title) return {}
  const revived = { ...title }
  delete revived.removed
  return revived
}

function markEntry(state: HistoryState, key: string, watched: WatchedUpdate, now: number) {
  const previous = state.entries[key]
  const nextWatched = typeof watched === 'function' ? watched(Boolean(previous?.watched)) : watched
  const entry = {
    ...previous,
    watched: nextWatched,
    updatedAt: now,
    // Unmarking restarts the title rather than resuming at the credits.
    ...(nextWatched ? {} : { position: undefined, watchSeconds: 0 }),
  }
  return { entries: { ...state.entries, [key]: entry }, watched: nextWatched }
}

export function markMovie(state: HistoryState, movieId: number, watched: WatchedUpdate, now: number): HistoryState {
  const { entries } = markEntry(state, entryKey('movie', movieId), watched, now)
  return { ...state, entries }
}

// Marking an episode watched moves the show's resume point past it.
export function markEpisode(
  state: HistoryState,
  showId: number,
  seasonNumber: number,
  episodeNumber: number,
  watched: WatchedUpdate,
  now: number,
): HistoryState {
  const marked = markEntry(state, entryKey('tv', showId, seasonNumber, episodeNumber), watched, now)
  if (!marked.watched) return { ...state, entries: marked.entries }
  const key = titleKey('tv', showId)
  return {
    entries: marked.entries,
    titles: {
      ...state.titles,
      [key]: { ...withoutRemoval(state.titles[key]), mediaType: 'tv', id: showId, seasonNumber, episodeNumber, updatedAt: now },
    },
  }
}

function hasValidPosition(position: number | null | undefined, duration: number | null | undefined): position is number {
  return position != null && duration != null
    && Number.isFinite(position) && Number.isFinite(duration) && position >= 0 && duration > 0
}

export function hasReachedEnd({ position, duration, finished }: WatchRecord) {
  return Boolean(finished) || (hasValidPosition(position, duration) && position / duration! >= WATCHED_THRESHOLD)
}

export function recordEntryKey({ item, seasonNumber, episodeNumber }: WatchRecord) {
  return item.mediaType === 'tv'
    ? entryKey('tv', item.id, seasonNumber, episodeNumber)
    : entryKey('movie', item.id)
}

export function applyWatchRecord(state: HistoryState, record: WatchRecord, now: number): HistoryState {
  const { item, watchSeconds, position, duration } = record
  const { mediaType, id } = item
  const key = recordEntryKey(record)
  const previous = state.entries[key]
  const hasPosition = hasValidPosition(position, duration)
  const title = titleKey(mediaType, id)
  return {
    entries: {
      ...state.entries,
      [key]: {
        watched: Boolean(previous?.watched) || hasReachedEnd(record),
        updatedAt: now,
        position: hasPosition ? position : previous?.position,
        duration: hasPosition ? duration! : previous?.duration,
        watchSeconds: Number.isFinite(watchSeconds) ? Math.max(0, watchSeconds) : previous?.watchSeconds,
      },
    },
    titles: {
      ...state.titles,
      [title]: {
        ...withoutRemoval(state.titles[title]),
        mediaType,
        id,
        item,
        seasonNumber: mediaType === 'tv' ? record.seasonNumber : null,
        episodeNumber: mediaType === 'tv' ? record.episodeNumber : null,
        updatedAt: now,
      },
    },
  }
}

export function removeTitle(state: HistoryState, mediaType: MediaType, id: number, now: number): HistoryState {
  const key = titleKey(mediaType, id)
  const title = state.titles[key]
  if (!isActiveTitle(title)) return state
  return { ...state, titles: { ...state.titles, [key]: { ...title, removed: true, updatedAt: now } } }
}

export function backfillTitleItem(state: HistoryState, item: MediaItem): HistoryState {
  const key = titleKey(item.mediaType, item.id)
  const title = state.titles[key]
  if (!title || title.item) return state
  return { ...state, titles: { ...state.titles, [key]: { ...title, item } } }
}

export function continueWatchingTitles(state: HistoryState) {
  return Object.values(state.titles)
    .filter((title) => !title.removed)
    .filter((title) => title.mediaType === 'tv' || !state.entries[entryKey('movie', title.id)]?.watched)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}
