import type { MediaSource } from '../../types/media-source'
import type { EpisodeRef } from '../../types/watch-history'

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

type EpisodeSource = MediaSource & EpisodeRef

const isEpisodeSource = (source: MediaSource): source is EpisodeSource =>
  source.seasonNumber != null && source.episodeNumber != null

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

  const episodes = sources
    .filter(isEpisodeSource)
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
  const targetIndex = episodes.findIndex(
    (source) => source.seasonNumber === target.seasonNumber && source.episodeNumber === target.episodeNumber,
  )
  const next = targetIndex === -1 ? undefined : episodes[targetIndex + 1]
  if (next) return { seasonNumber: next.seasonNumber, episodeNumber: next.episodeNumber }
  return { seasonNumber: target.seasonNumber, episodeNumber: target.episodeNumber + 1 }
}
