import type { MediaSource } from '../../types/media-source'
import type { Episode, MediaType } from '../../types/tmdb'
import type { PlaybackKind } from '../../types/watch-party'

export type SourceFailureReason =
  | 'no-player'
  | 'extract-timeout'
  | 'extract-error'
  | 'load-timeout'
  | 'embed-blocked'
  | 'media-error'
  | 'provider-unavailable'

// Each source keeps its own player state so one failing source never
// clobbers another one's progress or error.
type SourcePlayerState =
  | { status: 'extracting' }
  | { status: 'ready'; extractedUrl: string; playbackKind: PlaybackKind }
  | { status: 'failed'; reason: SourceFailureReason; message: string }

export type SourceStates = Record<string, SourcePlayerState>

export const SOURCE_FAILURE_MESSAGES: Record<SourceFailureReason, string> = {
  'no-player': 'This source did not return a usable embedded player. You can retry or exit safely.',
  'extract-timeout': 'The player took too long to prepare. You can retry or exit safely.',
  'extract-error': 'The player could not be prepared. You can retry or exit safely.',
  'load-timeout': 'The embedded player did not finish loading. You can retry or stop safely.',
  'embed-blocked': "This provider doesn't allow its player to be embedded here. Try another source.",
  'media-error': 'The authorised video could not be loaded. Check the source format and host response.',
  'provider-unavailable': 'This provider is unavailable. Try another source.',
}

export function withoutSource(states: SourceStates, sourceId: string) {
  if (!(sourceId in states)) return states
  const next = { ...states }
  delete next[sourceId]
  return next
}

export function getSourceLabel(source: Pick<MediaSource, 'label'>) {
  return source.label.replace(' Stream (Dynamic)', '')
}

export function isDynamicSource(source: MediaSource | undefined) {
  return Boolean(source?.isDynamic)
}

/** An extracted player is usable only if it is HTTPS and not the wrapper page itself. */
export function isEmbeddableUrl(candidate: string | null, wrapperUrl: string, kind: PlaybackKind = 'embed'): candidate is string {
  if (!candidate) return false
  try {
    const extracted = new URL(candidate)
    const wrapper = new URL(wrapperUrl, window.location.origin)
    return extracted.protocol === 'https:' && !extracted.username && !extracted.password && (kind !== 'embed' || extracted.href !== wrapper.href)
  } catch {
    return false
  }
}

function episodeUrl(sourceUrl: string, season: number, episode: number) {
  if (sourceUrl.includes('{season}') || sourceUrl.includes('{episode}')) {
    return sourceUrl.replace(/{season}/g, String(season)).replace(/{episode}/g, String(episode))
  }
  return `${sourceUrl}/season/${season}?e=${episode}`
}

/** The sources that can play the current title or episode, catalog sources first. */
export function playableSourcesFor(sources: MediaSource[], mediaType: MediaType, season: number, episode: number) {
  if (mediaType === 'movie') return sources
  const catalogSources = sources.filter(
    (source) => source.seasonNumber === season && source.episodeNumber === episode,
  )
  const dynamicSources = sources
    .filter((source) => source.isDynamic)
    .map((source) => ({
      ...source,
      seasonNumber: season,
      episodeNumber: episode,
      sourceUrl: episodeUrl(source.sourceUrl, season, episode),
    }))
  return [...catalogSources, ...dynamicSources]
}

export interface EpisodeListing {
  source: MediaSource
  episodeNumber: number
  episode?: Episode
}

/**
 * The episode list for a season. With a dynamic provider every TMDB episode
 * is playable; otherwise only episodes with a catalog source are listed.
 */
export function episodeListings(sources: MediaSource[], episodes: Episode[], showId: number, season: number): EpisodeListing[] {
  const byNumber = new Map(episodes.map((episode) => [episode.episode_number, episode]))

  if (sources.some((source) => source.isDynamic)) {
    return episodes.map((episode) => {
      const episodeNumber = episode.episode_number
      const source = sources.find((candidate) => candidate.seasonNumber === season && candidate.episodeNumber === episodeNumber) ?? {
        id: `dynamic-${season}-${episodeNumber}`,
        mediaType: 'tv',
        tmdbId: showId,
        seasonNumber: season,
        episodeNumber,
        label: `Episode ${episodeNumber}`,
        sourceUrl: '',
        mimeType: 'video/mp4',
        rightsBasis: 'licensed',
      }
      return { source, episodeNumber, episode: byNumber.get(episodeNumber) }
    })
  }

  return sources
    .filter((source): source is MediaSource & { episodeNumber: number } => source.seasonNumber === season && source.episodeNumber !== null)
    .sort((a, b) => a.episodeNumber - b.episodeNumber)
    .map((source) => ({ source, episodeNumber: source.episodeNumber, episode: byNumber.get(source.episodeNumber) }))
}
