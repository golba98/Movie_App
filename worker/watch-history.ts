import { requireUser } from './auth'
import { ApiError, json, readJson } from './http'

const MAX_SYNC_ENTRIES = 200
const MAX_SYNC_TITLES = 100
const MAX_LISTED_ENTRIES = 5_000
const MAX_LISTED_TITLES = 500
// Generous ceiling for a position, duration or watch time: 24 hours.
const MAX_SECONDS = 86_400

type MediaType = 'movie' | 'tv'

interface EntryInput {
  key?: unknown
  watched?: unknown
  position?: unknown
  duration?: unknown
  watchSeconds?: unknown
  updatedAt?: unknown
}

interface TitleInput {
  mediaType?: unknown
  id?: unknown
  seasonNumber?: unknown
  episodeNumber?: unknown
  item?: unknown
  dismissed?: unknown
  updatedAt?: unknown
}

function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_WATCH_HISTORY', message)
}

const isPositiveInt = (value: unknown): value is number => Number.isInteger(value) && Number(value) > 0
const isEpisodeNumber = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 0

function optionalSeconds(value: unknown) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid('Playback times must be non-negative numbers.')
  return Math.min(value, MAX_SECONDS)
}

function cleanUpdatedAt(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid('updatedAt is required.')
  // A device clock running ahead must not pin a row forever.
  return Math.min(Math.floor(value), Date.now())
}

function parseEntryKey(key: unknown) {
  if (typeof key !== 'string') invalid('Entry key is required.')
  const movie = key.match(/^movie:(\d+)$/)
  if (movie && isPositiveInt(Number(movie[1]))) {
    return { key, mediaType: 'movie' as MediaType, id: Number(movie[1]), seasonNumber: null, episodeNumber: null }
  }
  const tv = key.match(/^tv:(\d+):(\d+):(\d+)$/)
  if (tv && isPositiveInt(Number(tv[1])) && isPositiveInt(Number(tv[3]))) {
    return { key, mediaType: 'tv' as MediaType, id: Number(tv[1]), seasonNumber: Number(tv[2]), episodeNumber: Number(tv[3]) }
  }
  invalid('Entry key is invalid.')
}

function cleanEntry(input: EntryInput) {
  const parsed = parseEntryKey(input.key)
  return {
    ...parsed,
    watched: input.watched === true,
    position: optionalSeconds(input.position),
    duration: optionalSeconds(input.duration),
    watchSeconds: optionalSeconds(input.watchSeconds) ?? 0,
    updatedAt: cleanUpdatedAt(input.updatedAt),
  }
}

function cleanItem(value: unknown, mediaType: MediaType, id: number) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) invalid('Title item is invalid.')
  const input = value as Record<string, unknown>
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 300) : ''
  if (!title) return null
  const nullableString = (field: unknown, max: number) =>
    typeof field === 'string' && field ? field.slice(0, max) : null
  return {
    id,
    mediaType,
    title,
    overview: typeof input.overview === 'string' ? input.overview.slice(0, 2_000) : '',
    posterPath: nullableString(input.posterPath, 300),
    backdropPath: nullableString(input.backdropPath, 300),
    voteAverage:
      typeof input.voteAverage === 'number' && Number.isFinite(input.voteAverage)
        ? Math.min(Math.max(input.voteAverage, 0), 10)
        : 0,
    date: nullableString(input.date, 30),
    year: nullableString(input.year, 10),
  }
}

function cleanTitle(input: TitleInput) {
  const { mediaType, id } = input
  if ((mediaType !== 'movie' && mediaType !== 'tv') || !isPositiveInt(id)) invalid('Title is invalid.')
  let seasonNumber: number | null = null
  let episodeNumber: number | null = null
  if (mediaType === 'tv' && input.seasonNumber != null && input.episodeNumber != null) {
    if (!isEpisodeNumber(input.seasonNumber) || !isPositiveInt(input.episodeNumber)) invalid('Title episode is invalid.')
    seasonNumber = input.seasonNumber
    episodeNumber = input.episodeNumber
  }
  return {
    mediaType,
    id,
    seasonNumber,
    episodeNumber,
    item: cleanItem(input.item, mediaType, id),
    dismissed: input.dismissed === true,
    updatedAt: cleanUpdatedAt(input.updatedAt),
  }
}

export async function getWatchHistory(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const [entries, titles] = await env.DB.batch<Record<string, unknown>>([
    env.DB
      .prepare(
        `SELECT entry_key, watched, position, duration, watch_seconds, updated_at
         FROM watch_history WHERE account_id = ? ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(session.account.id, MAX_LISTED_ENTRIES),
    env.DB
      .prepare(
        `SELECT media_type, media_id, season_number, episode_number, item, dismissed, updated_at
         FROM watch_titles WHERE account_id = ? ORDER BY updated_at DESC LIMIT ?`,
      )
      .bind(session.account.id, MAX_LISTED_TITLES),
  ])

  return json({
    entries: (entries.results as {
      entry_key: string
      watched: number
      position: number | null
      duration: number | null
      watch_seconds: number
      updated_at: number
    }[]).map((row) => ({
      key: row.entry_key,
      watched: row.watched === 1,
      position: row.position,
      duration: row.duration,
      watchSeconds: row.watch_seconds,
      updatedAt: row.updated_at,
    })),
    titles: (titles.results as {
      media_type: MediaType
      media_id: number
      season_number: number | null
      episode_number: number | null
      item: string | null
      dismissed: number
      updated_at: number
    }[]).map((row) => {
      let item: unknown
      try {
        item = row.item ? JSON.parse(row.item) : null
      } catch {
        item = null
      }
      return {
        mediaType: row.media_type,
        id: row.media_id,
        seasonNumber: row.season_number,
        episodeNumber: row.episode_number,
        item,
        dismissed: row.dismissed === 1,
        updatedAt: row.updated_at,
      }
    }),
  })
}

export async function syncWatchHistory(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const body = await readJson<{ entries?: unknown; titles?: unknown }>(request)
  const rawEntries = body.entries ?? []
  const rawTitles = body.titles ?? []
  if (!Array.isArray(rawEntries) || rawEntries.length > MAX_SYNC_ENTRIES) {
    invalid(`Sync between 0 and ${MAX_SYNC_ENTRIES} entries at a time.`)
  }
  if (!Array.isArray(rawTitles) || rawTitles.length > MAX_SYNC_TITLES) {
    invalid(`Sync between 0 and ${MAX_SYNC_TITLES} titles at a time.`)
  }
  const entries = rawEntries.map((entry) => cleanEntry(entry as EntryInput))
  const titles = rawTitles.map((title) => cleanTitle(title as TitleInput))
  const accountId = session.account.id

  // Last write wins per row: a device holding older data cannot roll back newer progress.
  const statements = [
    ...entries.map((entry) =>
      env.DB
        .prepare(
          `INSERT INTO watch_history
            (account_id, entry_key, media_type, media_id, season_number, episode_number,
             watched, position, duration, watch_seconds, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, entry_key) DO UPDATE SET
             watched = excluded.watched,
             position = excluded.position,
             duration = excluded.duration,
             watch_seconds = excluded.watch_seconds,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at >= watch_history.updated_at`,
        )
        .bind(
          accountId,
          entry.key,
          entry.mediaType,
          entry.id,
          entry.seasonNumber,
          entry.episodeNumber,
          entry.watched ? 1 : 0,
          entry.position,
          entry.duration,
          entry.watchSeconds,
          entry.updatedAt,
        ),
    ),
    ...titles.map((title) =>
      env.DB
        .prepare(
          `INSERT INTO watch_titles
            (account_id, media_type, media_id, season_number, episode_number, item, dismissed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, media_type, media_id) DO UPDATE SET
             season_number = excluded.season_number,
             episode_number = excluded.episode_number,
             item = COALESCE(excluded.item, watch_titles.item),
             dismissed = excluded.dismissed,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at >= watch_titles.updated_at`,
        )
        .bind(
          accountId,
          title.mediaType,
          title.id,
          title.seasonNumber,
          title.episodeNumber,
          title.item ? JSON.stringify(title.item) : null,
          title.dismissed ? 1 : 0,
          title.updatedAt,
        ),
    ),
  ]
  if (statements.length) await env.DB.batch(statements)
  return json({ synced: statements.length })
}
