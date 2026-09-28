export interface MediaSnapshotPayload {
  id?: unknown
  mediaType?: unknown
  title?: unknown
  overview?: unknown
  posterPath?: unknown
  backdropPath?: unknown
  voteAverage?: unknown
  date?: unknown
  year?: unknown
}

export function isMediaKey(mediaType: unknown, id: unknown): mediaType is 'movie' | 'tv' {
  return Number.isInteger(id) && Number(id) > 0 && (mediaType === 'movie' || mediaType === 'tv')
}

const nullableString = (value: unknown, max: number) => (typeof value === 'string' && value ? value.slice(0, max) : null)

/**
 * Sanitises the display fields of a client's MediaItem snapshot (as stored
 * with favourites and watch history); null when the id, type or title is missing.
 */
export function cleanMediaSnapshot(input: MediaSnapshotPayload, expectedType?: string, expectedId?: number) {
  const id = expectedId ?? input.id
  const mediaType = expectedType ?? input.mediaType
  if (!isMediaKey(mediaType, id)) return null
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 300) : ''
  if (!title) return null
  return {
    id: Number(id),
    mediaType,
    title,
    overview: typeof input.overview === 'string' ? input.overview.slice(0, 2_000) : '',
    posterPath: nullableString(input.posterPath, 300),
    backdropPath: nullableString(input.backdropPath, 300),
    voteAverage: typeof input.voteAverage === 'number' && Number.isFinite(input.voteAverage)
      ? Math.min(Math.max(input.voteAverage, 0), 10)
      : 0,
    date: nullableString(input.date, 30),
    year: nullableString(input.year, 10),
  } as const
}
