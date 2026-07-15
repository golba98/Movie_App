import type {
  MediaItem,
  MediaType,
  TmdbMediaResult,
  Video,
  WatchProvider,
} from '../types/tmdb'

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
