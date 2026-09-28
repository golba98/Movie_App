import type {
  MediaItem,
  MediaType,
  MovieDetails,
  TmdbMediaResult,
  TvDetails,
  Video,
  WatchProvider,
  WatchProviderRegion,
} from '../../types/tmdb'

function normalizeMedia(item: TmdbMediaResult, fallbackType?: MediaType): MediaItem | null {
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

export function detailsToMediaItem(data: MovieDetails | TvDetails, mediaType: MediaType): MediaItem {
  const [title, date] = 'title' in data ? [data.title, data.release_date] : [data.name, data.first_air_date]
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

function dedupeProviders(providers: WatchProvider[] = []) {
  return [...new Map(providers.map((provider) => [provider.provider_id, provider])).values()].sort(
    (a, b) => (a.display_priority ?? 999) - (b.display_priority ?? 999),
  )
}

export const mediaPath = (item: Pick<MediaItem, 'id' | 'mediaType'>) => `/${item.mediaType}/${item.id}`

export function providerGroups(providers?: WatchProviderRegion) {
  if (!providers) return []
  return [
    {
      label: 'Stream, free or with ads',
      items: dedupeProviders([...(providers.flatrate ?? []), ...(providers.free ?? []), ...(providers.ads ?? [])]),
    },
    { label: 'Rent', items: dedupeProviders(providers.rent) },
    { label: 'Buy', items: dedupeProviders(providers.buy) },
  ].filter((group) => group.items.length > 0)
}

export function hasWatchProviders(providers?: WatchProviderRegion) {
  return providerGroups(providers).length > 0
}
