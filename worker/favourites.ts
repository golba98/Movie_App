import { requireUser } from './auth'
import { ApiError, json, readJson } from './http'

interface FavouriteInput {
  id?: unknown
  mediaType?: unknown
  title?: unknown
  overview?: unknown
  posterPath?: unknown
  backdropPath?: unknown
  voteAverage?: unknown
  date?: unknown
  year?: unknown
  addedAt?: unknown
}

function cleanFavourite(input: FavouriteInput, expectedType?: string, expectedId?: number) {
  const id = expectedId ?? input.id
  const mediaType = expectedType ?? input.mediaType
  if (!Number.isInteger(id) || Number(id) <= 0 || (mediaType !== 'movie' && mediaType !== 'tv')) {
    throw new ApiError(400, 'INVALID_FAVOURITE', 'The favourite item is invalid.')
  }
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 300) : ''
  if (!title) throw new ApiError(400, 'INVALID_FAVOURITE', 'The favourite title is required.')
  const nullableString = (value: unknown, max: number) =>
    typeof value === 'string' && value ? value.slice(0, max) : null
  return {
    id: Number(id),
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
    addedAt:
      typeof input.addedAt === 'number' && Number.isFinite(input.addedAt)
        ? Math.min(input.addedAt, Date.now())
        : Date.now(),
  } as const
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
    .all<{
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
    }>()
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
  const item = cleanFavourite(await readJson<FavouriteInput>(request), mediaType, mediaId)
  await favouriteStatement(env.DB, session.account.id, item).run()
  return json({ favourite: item })
}

export async function deleteFavourite(request: Request, env: Env, mediaType: string, mediaId: number) {
  const session = await requireUser(request, env.DB)
  if ((mediaType !== 'movie' && mediaType !== 'tv') || !Number.isInteger(mediaId) || mediaId <= 0) {
    throw new ApiError(400, 'INVALID_FAVOURITE', 'The favourite item is invalid.')
  }
  await env.DB
    .prepare('DELETE FROM favourites WHERE account_id = ? AND media_type = ? AND media_id = ?')
    .bind(session.account.id, mediaType, mediaId)
    .run()
  return json({ removed: true })
}

export async function importFavourites(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const body = await readJson<{ favourites?: unknown }>(request)
  if (!Array.isArray(body.favourites) || body.favourites.length > 500) {
    throw new ApiError(400, 'INVALID_IMPORT', 'Import between 0 and 500 favourites.')
  }
  const items = body.favourites.map((item) => cleanFavourite(item as FavouriteInput))
  if (items.length) {
    await env.DB.batch(items.map((item) => favouriteStatement(env.DB, session.account.id, item)))
  }
  return json({ imported: items.length })
}
