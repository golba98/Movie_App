import { requireUser } from '../auth/sessions'
import { ApiError, json, readJson } from '../http'
import { cleanMediaSnapshot, isMediaKey, type MediaSnapshotPayload } from './media-snapshot'

const MAX_IMPORT = 500

interface FavouritePayload extends MediaSnapshotPayload {
  addedAt?: unknown
}

interface FavouriteRow {
  media_id: number
  media_type: 'movie' | 'tv'
  title: string
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  media_date: string | null
  media_year: string | null
  added_at: number
}

const invalidFavourite = (message: string) => new ApiError(400, 'INVALID_FAVOURITE', message)

function cleanFavourite(input: FavouritePayload, expectedType?: string, expectedId?: number) {
  if (!isMediaKey(expectedType ?? input.mediaType, expectedId ?? input.id)) throw invalidFavourite('The favourite item is invalid.')
  const snapshot = cleanMediaSnapshot(input, expectedType, expectedId)
  if (!snapshot) throw invalidFavourite('The favourite title is required.')
  // Future timestamps are clamped so a fast device clock cannot pin an item to the top.
  const addedAt = typeof input.addedAt === 'number' && Number.isFinite(input.addedAt)
    ? Math.min(input.addedAt, Date.now())
    : Date.now()
  return { ...snapshot, addedAt } as const
}

function favouriteStatement(db: D1Database, accountId: string, item: ReturnType<typeof cleanFavourite>) {
  return db
    .prepare(
      `INSERT INTO favourites
        (account_id, media_type, media_id, title, overview, poster_path, backdrop_path,
         vote_average, media_date, media_year, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, media_type, media_id) DO UPDATE SET
         title = excluded.title,
         overview = excluded.overview,
         poster_path = excluded.poster_path,
         backdrop_path = excluded.backdrop_path,
         vote_average = excluded.vote_average,
         media_date = excluded.media_date,
         media_year = excluded.media_year,
         added_at = excluded.added_at`,
    )
    .bind(
      accountId,
      item.mediaType,
      item.id,
      item.title,
      item.overview,
      item.posterPath,
      item.backdropPath,
      item.voteAverage,
      item.date,
      item.year,
      item.addedAt,
    )
}

export async function listFavourites(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const rows = await env.DB
    .prepare(
      `SELECT media_id, media_type, title, overview, poster_path, backdrop_path,
              vote_average, media_date, media_year, added_at
       FROM favourites WHERE account_id = ? ORDER BY added_at DESC`,
    )
    .bind(session.account.id)
    .all<FavouriteRow>()
  return json({
    favourites: rows.results.map((item) => ({
      id: item.media_id,
      mediaType: item.media_type,
      title: item.title,
      overview: item.overview,
      posterPath: item.poster_path,
      backdropPath: item.backdrop_path,
      voteAverage: item.vote_average,
      date: item.media_date,
      year: item.media_year,
      addedAt: item.added_at,
    })),
  })
}

export async function putFavourite(
  request: Request,
  env: Env,
  mediaType: string,
  mediaId: number,
) {
  const session = await requireUser(request, env.DB)
  const item = cleanFavourite(await readJson<FavouritePayload>(request), mediaType, mediaId)
  await favouriteStatement(env.DB, session.account.id, item).run()
  return json({ favourite: item })
}

export async function deleteFavourite(request: Request, env: Env, mediaType: string, mediaId: number) {
  const session = await requireUser(request, env.DB)
  if (!isMediaKey(mediaType, mediaId)) throw invalidFavourite('The favourite item is invalid.')
  await env.DB
    .prepare('DELETE FROM favourites WHERE account_id = ? AND media_type = ? AND media_id = ?')
    .bind(session.account.id, mediaType, mediaId)
    .run()
  return json({ removed: true })
}

/** Moves favourites saved on a device before accounts existed into the account. */
export async function importFavourites(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const body = await readJson<{ favourites?: unknown }>(request)
  if (!Array.isArray(body.favourites) || body.favourites.length > MAX_IMPORT) {
    throw new ApiError(400, 'INVALID_IMPORT', `Import between 0 and ${MAX_IMPORT} favourites.`)
  }
  const items = body.favourites.map((item) => cleanFavourite(item as FavouritePayload))
  if (items.length) {
    await env.DB.batch(items.map((item) => favouriteStatement(env.DB, session.account.id, item)))
  }
  return json({ imported: items.length })
}
