import type {
  MediaType,
  MovieDetails,
  PaginatedResponse,
  TmdbMediaResult,
  TvDetails,
} from '../types/tmdb'

const API_BASE_URL = 'https://api.themoviedb.org/3'
const token = import.meta.env.VITE_TMDB_ACCESS_TOKEN?.trim() ?? ''

export const isTmdbConfigured = token.length > 0

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
  if (!isTmdbConfigured) {
    throw new TmdbError('TMDB access token is not configured.')
  }

  const url = new URL(`${API_BASE_URL}${path}`)
  Object.entries(options.params ?? {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value))
  })

  let response: Response
  try {
    response = await fetch(url, {
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new TmdbError('Unable to reach TMDB. Check your connection and try again.')
  }

  if (!response.ok) {
    const message =
      response.status === 401
        ? 'TMDB rejected the access token. Check your .env.local file.'
        : response.status === 404
          ? 'This title could not be found.'
          : 'TMDB could not complete the request. Please try again.'
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

export const browseFor = (mediaType: MediaType, page: number, signal?: AbortSignal) =>
  mediaType === 'movie' ? getPopularMovies(page, signal) : getPopularTv(page, signal)
