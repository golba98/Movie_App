import type { MediaSource } from '../../types/media-source'
import type { EpisodeRef } from '../../types/watch-history'
import type { EpisodeListing } from './sources'

// Embed hosts known to accept a start offset, and the query parameter they read.
// Hosts not listed here are left untouched, so resume falls back to the episode.
const EMBED_START_PARAMS: Record<string, string> = {
  'vidlink.pro': 'startAt',
  'player.videasy.net': 'progress',
  // Source 1. It ignores its own saved position when the URL names an episode.
  'vsembed.ru': 'startAt',
}

// Embed hosts that pick a subtitle track themselves, and the query parameter
// naming the language to prefer. Without it Source 1 picks anew on every load,
// including when it moves to another stream host, often in another language.
const EMBED_SUBTITLE_PARAMS: Record<string, string> = {
  'vsembed.ru': 'ds_lang',
}
// The app is in English, so its players prefer English subtitles.
const SUBTITLE_LANGUAGE = 'en'

function embedParam(url: string, params: Record<string, string>) {
  try {
    const parsed = new URL(url)
    const param = params[parsed.hostname.replace(/^www\./, '')]
    return param ? { parsed, param } : null
  } catch {
    return null
  }
}

export function withStartTime(url: string, seconds: number | null | undefined) {
  if (!seconds || seconds < 1) return url
  const embed = embedParam(url, EMBED_START_PARAMS)
  if (!embed) return url
  embed.parsed.searchParams.set(embed.param, String(Math.floor(seconds)))
  return embed.parsed.href
}

// Leaves a language already in the URL, e.g. from a provider's configured embed pattern.
export function withSubtitleLanguage(url: string) {
  const embed = embedParam(url, EMBED_SUBTITLE_PARAMS)
  if (!embed || embed.parsed.searchParams.has(embed.param)) return url
  embed.parsed.searchParams.set(embed.param, SUBTITLE_LANGUAGE)
  return embed.parsed.href
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

/**
 * The episode after the current one: the next listed episode in this season,
 * else the first episode of the next season, else null at the end of the show.
 * Next-season episodes are resolved by selectSeason, so only the season is set.
 */
export function nextEpisode(
  listings: Pick<EpisodeListing, 'episodeNumber'>[],
  season: number,
  episode: number,
  seasons: number[],
): EpisodeRef | null {
  const laterInSeason = listings
    .map(({ episodeNumber }) => episodeNumber)
    .filter((episodeNumber) => episodeNumber > episode)
  if (laterInSeason.length > 0) return { seasonNumber: season, episodeNumber: Math.min(...laterInSeason) }
  const nextSeason = seasons.find((candidate) => candidate > season)
  return nextSeason === undefined ? null : { seasonNumber: nextSeason, episodeNumber: 1 }
}
