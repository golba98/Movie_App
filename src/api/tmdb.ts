import type {
  MediaType,
  MovieDetails,
  PaginatedResponse,
  TmdbMediaResult,
  TvDetails,
  TvSeasonDetails,
} from '../types/tmdb'
const API_BASE_URL = '/api/tmdb'

export class TmdbError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'TmdbError'
  }
}

type QueryValue = string | number | boolean | undefined

interface RequestOptions {
  params?: Record<string, QueryValue>
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin)
  Object.entries(options.params ?? {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value))
  })

  let response: Response
  try {
    response = await fetch(url, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new TmdbError('Unable to reach TMDB. Check your connection and try again.')
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    if (response.status === 401) window.dispatchEvent(new Event('fedora:auth-expired'))
    const message = payload?.error?.message ?? (response.status === 404
      ? 'This title could not be found.'
      : 'TMDB could not complete the request. Please try again.')
    throw new TmdbError(message, response.status)
  }

  return response.json() as Promise<T>
}

const listParams = { language: 'en-US', page: 1, region: 'ZA' } as const

export function getTrendingMovies(signal?: AbortSignal) {
  return request<PaginatedResponse<TmdbMediaResult>>('/trending/movie/week', {
    params: { language: 'en-US' },
    signal,
  })
}

export function getPopularMovies(page = 1, signal?: AbortSignal) {
  return request<PaginatedResponse<TmdbMediaResult>>('/movie/popular', {
    params: { ...listParams, page },
    signal,
  })
}

export function getTopRatedMovies(signal?: AbortSignal) {
  return request<PaginatedResponse<TmdbMediaResult>>('/movie/top_rated', {
    params: listParams,
    signal,
  })
}

export function getUpcomingMovies(signal?: AbortSignal) {
  return request<PaginatedResponse<TmdbMediaResult>>('/movie/upcoming', {
    params: listParams,
    signal,
  })
}

export function getPopularTv(page = 1, signal?: AbortSignal) {
  return request<PaginatedResponse<TmdbMediaResult>>('/tv/popular', {
    params: { language: 'en-US', page },
    signal,
  })
}

export function searchMulti(query: string, page = 1, signal?: AbortSignal) {
  return request<PaginatedResponse<TmdbMediaResult>>('/search/multi', {
    params: { query, page, language: 'en-US', include_adult: false },
    signal,
  })
}

const appended = 'credits,videos,similar,watch/providers'

export function getMovieDetails(id: number, signal?: AbortSignal) {
  return request<MovieDetails>(`/movie/${id}`, {
    params: { language: 'en-US', append_to_response: appended },
    signal,
  })
}

export function getTvDetails(id: number, signal?: AbortSignal) {
  return request<TvDetails>(`/tv/${id}`, {
    params: { language: 'en-US', append_to_response: appended },
    signal,
  })
}

export function getTvSeasonDetails(seriesId: number, seasonNumber: number, signal?: AbortSignal) {
  return request<TvSeasonDetails>(`/tv/${seriesId}/season/${seasonNumber}`, {
    params: { language: 'en-US' },
    signal,
  })
}

export const browseFor = (mediaType: MediaType, page: number, signal?: AbortSignal) =>
  mediaType === 'movie' ? getPopularMovies(page, signal) : getPopularTv(page, signal)
