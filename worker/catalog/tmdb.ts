import type { MediaType } from '../../src/types/tmdb'
import { requireUser } from '../auth/sessions'
import { ApiError } from '../http'

const TMDB_API = 'https://api.themoviedb.org/3'
const DETAILS_CACHE_SECONDS = 86_400
const MAX_PARAMETER_LENGTH = 500

// The browser may only reach the TMDB endpoints the app actually uses.
const ALLOWED_PATHS = [
  /^\/trending\/movie\/week$/,
  /^\/movie\/(popular|top_rated|upcoming)$/,
  /^\/tv\/popular$/,
  /^\/search\/multi$/,
  /^\/movie\/\d+$/,
  /^\/tv\/\d+$/,
  /^\/tv\/\d+\/season\/\d+$/,
]

const ALLOWED_PARAMETERS = new Set([
  'language',
  'page',
  'region',
  'query',
  'include_adult',
  'append_to_response',
])

const tmdbHeaders = (env: Env) => ({
  Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}`,
  Accept: 'application/json',
})

/**
 * Forwards an allow-listed TMDB request with the server's token, so the token
 * never reaches the browser.
 */
export async function proxyTmdb(request: Request, env: Env, path: string) {
  await requireUser(request, env.DB)
  if (!env.TMDB_ACCESS_TOKEN) {
    throw new ApiError(503, 'TMDB_NOT_CONFIGURED', 'Movie data is not configured yet.')
  }
  if (!ALLOWED_PATHS.some((pattern) => pattern.test(path))) {
    throw new ApiError(404, 'TMDB_ROUTE_NOT_ALLOWED', 'That movie-data route is not available.')
  }
  const target = new URL(`${TMDB_API}${path}`)
  for (const [key, value] of new URL(request.url).searchParams) {
    if (ALLOWED_PARAMETERS.has(key)) target.searchParams.append(key, value.slice(0, MAX_PARAMETER_LENGTH))
  }
  const response = await fetch(target, { headers: tmdbHeaders(env) })
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/** A movie's title or a show's name, cached at the edge for a day. */
export async function fetchTmdbTitle(env: Env, mediaType: MediaType, tmdbId: number): Promise<string> {
  const response = await fetch(`${TMDB_API}/${mediaType}/${tmdbId}`, {
    headers: tmdbHeaders(env),
    cf: { cacheTtl: DETAILS_CACHE_SECONDS } as unknown as { cacheTtl: number },
  })
  if (!response.ok) throw new Error('Failed to fetch TMDB details')
  const data = (await response.json()) as { title?: string; name?: string }
  return (mediaType === 'movie' ? data.title : data.name) ?? ''
}

/** A movie's or an episode's runtime in minutes, cached at the edge for a day; null when TMDB has none. */
export async function fetchTmdbRuntime(
  env: Env,
  media: { mediaType: MediaType; tmdbId: number; season: number | null; episode: number | null },
  signal?: AbortSignal,
): Promise<number | null> {
  if (!env.TMDB_ACCESS_TOKEN) return null
  const path = media.mediaType === 'movie'
    ? `/movie/${media.tmdbId}`
    : `/tv/${media.tmdbId}/season/${media.season}/episode/${media.episode}`
  const response = await fetch(`${TMDB_API}${path}`, {
    headers: tmdbHeaders(env),
    signal,
    cf: { cacheTtl: DETAILS_CACHE_SECONDS } as unknown as { cacheTtl: number },
  })
  if (!response.ok) return null
  const { runtime } = (await response.json()) as { runtime?: number | null }
  return typeof runtime === 'number' && runtime > 0 ? runtime : null
}
