import { requireUser } from './auth'
import { ApiError } from './http'

const allowedPaths = [
  /^\/trending\/movie\/week$/,
  /^\/movie\/(popular|top_rated|upcoming)$/,
  /^\/tv\/popular$/,
  /^\/search\/multi$/,
  /^\/movie\/\d+$/,
  /^\/tv\/\d+$/,
  /^\/tv\/\d+\/season\/\d+$/,
]

const allowedParameters = new Set([
  'language',
  'page',
  'region',
  'query',
  'include_adult',
  'append_to_response',
])

export async function proxyTmdb(request: Request, env: Env, path: string) {
  await requireUser(request, env.DB)
  if (!env.TMDB_ACCESS_TOKEN) {
    throw new ApiError(503, 'TMDB_NOT_CONFIGURED', 'Movie data is not configured yet.')
  }
  if (!allowedPaths.some((pattern) => pattern.test(path))) {
    throw new ApiError(404, 'TMDB_ROUTE_NOT_ALLOWED', 'That movie-data route is not available.')
  }
  const source = new URL(request.url)
  const target = new URL(`https://api.themoviedb.org/3${path}`)
  for (const [key, value] of source.searchParams) {
    if (allowedParameters.has(key)) target.searchParams.append(key, value.slice(0, 500))
  }
  const response = await fetch(target, {
    headers: {
      Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
  })
  return new Response(response.body, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
