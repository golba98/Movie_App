export type MediaType = 'movie' | 'tv'

export interface TmdbMediaResult {
  id: number
  media_type?: MediaType | 'person'
  title?: string | null
  name?: string | null
  overview?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
  vote_average?: number | null
  release_date?: string | null
  first_air_date?: string | null
}

export interface MediaItem {
  id: number
  mediaType: MediaType
  title: string
  overview: string
  posterPath: string | null
  backdropPath: string | null
  voteAverage: number
  date: string | null
  year: string | null
}

export interface PaginatedResponse<T> {
  page: number
  results: T[]
  total_pages: number
  total_results: number
}

export interface Genre {
  id: number
  name: string
}

export interface CastMember {
  id: number
  name: string
  character?: string | null
  profile_path?: string | null
  order?: number
}

export interface CrewMember {
  id: number
  name: string
  job?: string | null
  department?: string | null
}

export interface CreditsResponse {
  cast?: CastMember[]
  crew?: CrewMember[]
}

export interface Video {
  id: string
  key: string
  name: string
  site: string
  type: string
  official?: boolean
}

export interface VideosResponse {
  results?: Video[]
}

export interface WatchProvider {
  provider_id: number
  provider_name: string
  logo_path?: string | null
  display_priority?: number
}

export interface WatchProviderRegion {
  link?: string
  flatrate?: WatchProvider[]
  free?: WatchProvider[]
  ads?: WatchProvider[]
  rent?: WatchProvider[]
  buy?: WatchProvider[]
}

export interface WatchProvidersResponse {
  results?: Record<string, WatchProviderRegion>
}

interface AppendedDetails {
  credits?: CreditsResponse
  videos?: VideosResponse
  similar?: PaginatedResponse<TmdbMediaResult>
  'watch/providers'?: WatchProvidersResponse
}

export interface MovieDetails extends AppendedDetails {
  id: number
  title: string
  overview?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
  vote_average?: number | null
  release_date?: string | null
  runtime?: number | null
  genres?: Genre[]
}

export interface TvDetails extends AppendedDetails {
  id: number
  name: string
  overview?: string | null
  poster_path?: string | null
  backdrop_path?: string | null
  vote_average?: number | null
  first_air_date?: string | null
  number_of_seasons?: number | null
  genres?: Genre[]
}

export interface FavouriteItem extends MediaItem {
  addedAt: number
}

export interface Episode {
  id: number
  name: string
  overview?: string | null
  episode_number: number
  season_number: number
  still_path?: string | null
  air_date?: string | null
}

export interface TvSeasonDetails {
  id: number
  name: string
  overview?: string | null
  poster_path?: string | null
  season_number: number
  episodes: Episode[]
}
