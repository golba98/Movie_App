import { requireUser } from './auth'
import { cleanMediaSnapshot } from './favourites'
import { ApiError, json, readJson } from './http'

const MAX_SYNC_ITEMS = 500
const ENTRY_KEY_PATTERN = /^(movie:[1-9]\d*|tv:[1-9]\d*:\d+:\d+)$/

function invalid(message: string): never {
  throw new ApiError(400, 'INVALID_WATCH_HISTORY', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanUpdatedAt(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) invalid('Each item needs an update time.')
  // A device with a fast clock must not win every future conflict.
  return Math.min(Math.floor(value), Date.now())
}

function cleanSeconds(value: unknown) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid('Playback times must be positive numbers.')
  return value
}

function cleanEpisodeNumber(value: unknown) {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || Number(value) < 0) invalid('Season and episode numbers must be whole numbers.')
  return Number(value)
}

function cleanEntry(input: unknown) {
  if (!isRecord(input) || typeof input.key !== 'string' || !ENTRY_KEY_PATTERN.test(input.key)) {
    invalid('A watch history entry is invalid.')
  }
  return {
    key: input.key,
    watched: input.watched === true,
    position: cleanSeconds(input.position),
    duration: cleanSeconds(input.duration),
    watchSeconds: cleanSeconds(input.watchSeconds) ?? 0,
    updatedAt: cleanUpdatedAt(input.updatedAt),
  }
}

function cleanTitle(input: unknown) {
  if (!isRecord(input)) invalid('A watch history title is invalid.')
  const { mediaType, id } = input
  if ((mediaType !== 'movie' && mediaType !== 'tv') || !Number.isInteger(id) || Number(id) <= 0) {
    invalid('A watch history title is invalid.')
  }
  const item = isRecord(input.item) ? cleanMediaSnapshot(input.item, mediaType, Number(id)) : null
  return {
    mediaType,
    id: Number(id),
    seasonNumber: mediaType === 'tv' ? cleanEpisodeNumber(input.seasonNumber) : null,
    episodeNumber: mediaType === 'tv' ? cleanEpisodeNumber(input.episodeNumber) : null,
    item,
    removed: input.removed === true,
    updatedAt: cleanUpdatedAt(input.updatedAt),
  } as const
}

export async function getWatchHistory(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const [entryRows, titleRows] = await Promise.all([
    env.DB
      .prepare('SELECT entry_key, watched, position, duration, watch_seconds, updated_at FROM watch_entries WHERE account_id = ?')
      .bind(session.account.id)
      .all<{
        entry_key: string
        watched: number
        position: number | null
        duration: number | null
        watch_seconds: number
        updated_at: number
      }>(),
    env.DB
      .prepare(
        `SELECT media_type, media_id, season_number, episode_number, item_json, removed, updated_at
         FROM watch_titles WHERE account_id = ? ORDER BY updated_at DESC`,
      )
      .bind(session.account.id)
      .all<{
        media_type: 'movie' | 'tv'
        media_id: number
        season_number: number | null
        episode_number: number | null
        item_json: string | null
        removed: number
        updated_at: number
      }>(),
  ])

  const entries: Record<string, unknown> = {}
  for (const row of entryRows.results) {
    entries[row.entry_key] = {
      watched: row.watched === 1,
      updatedAt: row.updated_at,
      ...(row.position !== null ? { position: row.position } : {}),
      ...(row.duration !== null ? { duration: row.duration } : {}),
      ...(row.watch_seconds > 0 ? { watchSeconds: row.watch_seconds } : {}),
    }
  }

  const titles: Record<string, unknown> = {}
  for (const row of titleRows.results) {
    let item: unknown
    try {
      item = row.item_json ? JSON.parse(row.item_json) : undefined
    } catch {
      item = undefined
    }
    titles[`${row.media_type}:${row.media_id}`] = {
      mediaType: row.media_type,
      id: row.media_id,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      updatedAt: row.updated_at,
      ...(item ? { item } : {}),
      ...(row.removed === 1 ? { removed: true } : {}),
    }
  }

  return json({ entries, titles })
}

// Last write wins per row: an older update from a device that was offline
// never replaces a newer one from another device.
export async function syncWatchHistory(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const body = await readJson<{ entries?: unknown; titles?: unknown }>(request)
  const rawEntries = body.entries ?? []
  const rawTitles = body.titles ?? []
  if (!Array.isArray(rawEntries) || !Array.isArray(rawTitles)) invalid('Send entries and titles as lists.')
  if (rawEntries.length + rawTitles.length > MAX_SYNC_ITEMS) {
    invalid(`Sync at most ${MAX_SYNC_ITEMS} items at a time.`)
  }
  const entries = rawEntries.map(cleanEntry)
  const titles = rawTitles.map(cleanTitle)
  const accountId = session.account.id

  const statements = [
    ...entries.map((entry) =>
      env.DB
        .prepare(
          `INSERT INTO watch_entries (account_id, entry_key, watched, position, duration, watch_seconds, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, entry_key) DO UPDATE SET
             watched = excluded.watched,
             position = excluded.position,
             duration = excluded.duration,
             watch_seconds = excluded.watch_seconds,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at > watch_entries.updated_at`,
        )
        .bind(accountId, entry.key, entry.watched ? 1 : 0, entry.position, entry.duration, entry.watchSeconds, entry.updatedAt),
    ),
    ...titles.map((title) =>
      env.DB
        .prepare(
          `INSERT INTO watch_titles
             (account_id, media_type, media_id, season_number, episode_number, item_json, removed, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(account_id, media_type, media_id) DO UPDATE SET
             season_number = excluded.season_number,
             episode_number = excluded.episode_number,
             item_json = COALESCE(excluded.item_json, watch_titles.item_json),
             removed = excluded.removed,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at > watch_titles.updated_at`,
        )
        .bind(
          accountId,
          title.mediaType,
          title.id,
          title.seasonNumber,
          title.episodeNumber,
          title.item ? JSON.stringify(title.item) : null,
          title.removed ? 1 : 0,
          title.updatedAt,
        ),
    ),
  ]
  if (statements.length) await env.DB.batch(statements)
  return json({ synced: statements.length })
}
