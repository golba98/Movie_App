import type { MediaSource } from '../../types/media-source'
import type {
  MediaItem,
  MediaType,
  MovieDetails,
  TmdbMediaResult,
  TvDetails,
  Video,
  WatchProvider,
} from '../../types/tmdb'

export function normalizeMedia(
  item: TmdbMediaResult,
  fallbackType?: MediaType,
): MediaItem | null {
  const mediaType = item.media_type === 'movie' || item.media_type === 'tv' ? item.media_type : fallbackType
  if (!mediaType || !Number.isInteger(item.id) || item.id <= 0) return null

  const title = (mediaType === 'movie' ? item.title : item.name)?.trim()
  if (!title) return null

  const date = (mediaType === 'movie' ? item.release_date : item.first_air_date) || null
  return {
    id: item.id,
    mediaType,
    title,
    overview: item.overview?.trim() ?? '',
    posterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
    voteAverage: typeof item.vote_average === 'number' ? item.vote_average : 0,
    date,
    year: date?.slice(0, 4) || null,
  }
}

export function detailsToMediaItem(data: MovieDetails | TvDetails, mediaType: MediaType): MediaItem {
  const isMovie = mediaType === 'movie'
  const title = isMovie ? (data as MovieDetails).title : (data as TvDetails).name
  const date = isMovie ? (data as MovieDetails).release_date : (data as TvDetails).first_air_date
  return {
    id: data.id,
    mediaType,
    title,
    overview: data.overview?.trim() ?? '',
    posterPath: data.poster_path ?? null,
    backdropPath: data.backdrop_path ?? null,
    voteAverage: data.vote_average ?? 0,
    date: date ?? null,
    year: date?.slice(0, 4) || null,
  }
}

export function normalizeMediaList(items: TmdbMediaResult[], fallbackType?: MediaType) {
  return items.flatMap((item) => {
    const normalized = normalizeMedia(item, fallbackType)
    return normalized ? [normalized] : []
  })
}

export function formatRating(rating: number | null | undefined) {
  return typeof rating === 'number' && rating > 0 ? rating.toFixed(1) : 'Not rated'
}

export function formatDate(date: string | null | undefined) {
  if (!date) return 'Not available'
  const parsed = new Date(`${date}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat('en-ZA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(parsed)
}

export function formatRuntime(runtime: number | null | undefined) {
  if (!runtime || runtime <= 0) return 'Not available'
  const hours = Math.floor(runtime / 60)
  const minutes = runtime % 60
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

export function chooseTrailer(videos: Video[] | undefined) {
  const youtube = (videos ?? []).filter(
    (video) => video.site.toLowerCase() === 'youtube' && Boolean(video.key),
  )
  return (
    youtube.find((video) => video.type === 'Trailer' && video.official) ??
    youtube.find((video) => video.type === 'Trailer') ??
    youtube.find((video) => video.type === 'Teaser' && video.official) ??
    youtube.find((video) => video.type === 'Teaser') ??
    null
  )
}

export function dedupeProviders(providers: WatchProvider[] = []) {
  return [...new Map(providers.map((provider) => [provider.provider_id, provider])).values()].sort(
    (a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999),
  )
}

export const mediaPath = (item: Pick<MediaItem, 'id' | 'mediaType'>) =>
  `/${item.mediaType}/${item.id}`

// Embed hosts known to accept a start offset, and the query parameter they read.
// Hosts not listed here are left untouched, so resume falls back to the episode.
const EMBED_START_PARAMS: Record<string, string> = {
  'vidlink.pro': 'startAt',
  'player.videasy.net': 'progress',
}

export function withStartTime(url: string, seconds: number | null | undefined) {
  if (!seconds || seconds < 1) return url
  try {
    const parsed = new URL(url)
    const param = EMBED_START_PARAMS[parsed.hostname.replace(/^www\./, '')]
    if (!param) return url
    parsed.searchParams.set(param, String(Math.floor(seconds)))
    return parsed.href
  } catch {
    return url
  }
}

export interface EpisodeRef {
  seasonNumber: number
  episodeNumber: number
}

// Resume an unfinished episode where it was left; after a finished one, move on
// to the next. Out-of-range guesses are corrected once the season's episodes load.
export function resolveStartEpisode(sources: MediaSource[], target: EpisodeRef | null, targetWatched: boolean): EpisodeRef {
  if (!target) {
    const firstSource = sources[0]
    return {
      seasonNumber: firstSource?.seasonNumber ?? 1,
      episodeNumber: firstSource?.episodeNumber ?? 1,
    }
  }
  if (!targetWatched) return target

  const tvSources = sources
    .filter((s) => s.seasonNumber != null && s.episodeNumber != null)
    .sort((a, b) => a.seasonNumber! - b.seasonNumber! || a.episodeNumber! - b.episodeNumber!)
  const targetIndex = tvSources.findIndex(
    (s) => s.seasonNumber === target.seasonNumber && s.episodeNumber === target.episodeNumber,
  )
  if (targetIndex !== -1 && targetIndex < tvSources.length - 1) {
    const nextSource = tvSources[targetIndex + 1]
    return { seasonNumber: nextSource.seasonNumber!, episodeNumber: nextSource.episodeNumber! }
  }
  return { seasonNumber: target.seasonNumber, episodeNumber: target.episodeNumber + 1 }
}
