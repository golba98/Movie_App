import { isAbortError, notifyAuthExpired } from '../../lib/api-client'
import type {
  MediaType,
  MovieDetails,
  PaginatedResponse,
  TmdbMediaResult,
  TvDetails,
  TvSeasonDetails,
} from '../../types/tmdb'

const API_BASE_URL = '/api/tmdb'
const LANGUAGE = 'en-US'
const REGION = 'ZA'
const DETAILS_APPENDS = 'credits,videos,similar,watch/providers'

class TmdbError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message)
    this.name = 'TmdbError'
  }
}

type QueryValue = string | number | boolean | undefined
type MediaPage = PaginatedResponse<TmdbMediaResult>

interface RequestOptions {
  params?: Record<string, QueryValue>
  signal?: AbortSignal
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(`${API_BASE_URL}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(options.params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }

  let response: Response
  try {
    response = await fetch(url, {
      signal: options.signal,
      headers: { Accept: 'application/json' },
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    throw new TmdbError('Unable to reach TMDB. Check your connection and try again.')
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null
    if (response.status === 401) notifyAuthExpired()
    const fallback = response.status === 404
      ? 'This title could not be found.'
      : 'TMDB could not complete the request. Please try again.'
    throw new TmdbError(payload?.error?.message ?? fallback, response.status)
  }

  return response.json() as Promise<T>
}

const listParams = { language: LANGUAGE, page: 1, region: REGION } as const

export function getTrendingMovies(signal?: AbortSignal) {
  return request<MediaPage>('/trending/movie/week', { params: { language: LANGUAGE }, signal })
}

export function getPopularMovies(page = 1, signal?: AbortSignal) {
  return request<MediaPage>('/movie/popular', { params: { ...listParams, page }, signal })
}

export function getTopRatedMovies(signal?: AbortSignal) {
  return request<MediaPage>('/movie/top_rated', { params: listParams, signal })
}

export function getUpcomingMovies(signal?: AbortSignal) {
  return request<MediaPage>('/movie/upcoming', { params: listParams, signal })
}

export function getPopularTv(page = 1, signal?: AbortSignal) {
  return request<MediaPage>('/tv/popular', { params: { language: LANGUAGE, page }, signal })
}

export function searchMulti(query: string, page = 1, signal?: AbortSignal) {
  return request<MediaPage>('/search/multi', {
    params: { query, page, language: LANGUAGE, include_adult: false },
    signal,
  })
}

export function getMovieDetails(id: number, signal?: AbortSignal) {
  return request<MovieDetails>(`/movie/${id}`, {
    params: { language: LANGUAGE, append_to_response: DETAILS_APPENDS },
    signal,
  })
}

export function getTvDetails(id: number, signal?: AbortSignal) {
  return request<TvDetails>(`/tv/${id}`, {
    params: { language: LANGUAGE, append_to_response: DETAILS_APPENDS },
    signal,
  })
}

export function getTvSeasonDetails(seriesId: number, seasonNumber: number, signal?: AbortSignal) {
  return request<TvSeasonDetails>(`/tv/${seriesId}/season/${seasonNumber}`, {
    params: { language: LANGUAGE },
    signal,
  })
}

export function getPopular(mediaType: MediaType, page: number, signal?: AbortSignal) {
  return mediaType === 'movie' ? getPopularMovies(page, signal) : getPopularTv(page, signal)
}
