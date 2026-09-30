import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MediaSource } from '../../../types/media-source'
import type { Episode, MediaType } from '../../../types/tmdb'
import type { EpisodeRef } from '../../../types/watch-history'
import { getTvSeasonDetails } from '../../catalog/api'
import { useWatchedHistory } from '../../watch-history/watch-history-context'
import { resolveStartEpisode } from '../episodes'

const EMPTY_EPISODES: Episode[] = []

/**
 * The season and episode a TV player shows, plus that season's TMDB episode
 * list. Starts where the viewer left off and corrects guesses that fall past
 * the end of a season once its episodes load. Movies stay at S1 E1.
 */
export function useEpisodeSelection(
  id: number,
  mediaType: MediaType,
  sources: MediaSource[],
  numberOfSeasons: number | null | undefined,
) {
  const { getResumeTarget, isEpisodeWatched } = useWatchedHistory()

  const startEpisode = () => {
    if (mediaType !== 'tv') return { seasonNumber: 1, episodeNumber: 1 }
    const target = getResumeTarget(id)
    const targetWatched = target ? isEpisodeWatched(id, target.seasonNumber, target.episodeNumber) : false
    return resolveStartEpisode(sources, target, targetWatched)
  }

  const [selection, setSelection] = useState(() => ({
    ...startEpisode(),
    requestVersion: 0,
    providerReported: false,
  }))
  const { seasonNumber: season, episodeNumber: episode, requestVersion, providerReported } = selection
  const metadataKey = `${id}:${season}`
  const [metadata, setMetadata] = useState<{ key: string; episodes: Episode[]; error: string | null } | null>(null)
  const currentMetadata = metadata?.key === metadataKey ? metadata : null
  const episodes = currentMetadata?.episodes ?? EMPTY_EPISODES
  const loadingEpisodes = mediaType === 'tv' && currentMetadata === null
  const episodesError = currentMetadata?.error ?? null

  const availableSeasons = useMemo(() => {
    if (numberOfSeasons && sources.some((source) => source.isDynamic)) {
      return Array.from({ length: numberOfSeasons }, (_, index) => index + 1)
    }
    return [...new Set(sources.flatMap((source) => source.seasonNumber ?? []))].sort((a, b) => a - b)
  }, [sources, numberOfSeasons])

  // A different show starts from its own resume point.
  useEffect(() => {
    if (mediaType !== 'tv') return
    setSelection({ ...startEpisode(), requestVersion: 0, providerReported: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (mediaType !== 'tv') return
    const controller = new AbortController()
    getTvSeasonDetails(id, season, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setMetadata({ key: metadataKey, episodes: data.episodes ?? [], error: null })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setMetadata({
          key: metadataKey,
          episodes: [],
          error: 'Episode metadata is unavailable. Authorised episodes remain playable.',
        })
      })
    return () => controller.abort()
  }, [season, id, mediaType, metadataKey])

  const requestEpisode = useCallback((target: EpisodeRef) => {
    setSelection((current) => ({
      ...target,
      requestVersion: current.requestVersion + 1,
      providerReported: false,
    }))
  }, [])

  // "Next episode" guesses can run past the end of a season: move on to the
  // next season, or settle on the final episode.
  useEffect(() => {
    // The provider names what is actually playing, even if TMDB's listing
    // is incomplete or uses a different episode order. Only correct guesses.
    if (mediaType !== 'tv' || providerReported || loadingEpisodes || episodes.length === 0) return
    const lastEpisode = Math.max(...episodes.map((item) => item.episode_number))
    if (episode <= lastEpisode) return
    const seasonIndex = availableSeasons.indexOf(season)
    if (seasonIndex !== -1 && seasonIndex < availableSeasons.length - 1) {
      requestEpisode({ seasonNumber: availableSeasons[seasonIndex + 1], episodeNumber: 1 })
    } else {
      requestEpisode({ seasonNumber: season, episodeNumber: lastEpisode })
    }
  }, [episodes, loadingEpisodes, season, episode, availableSeasons, mediaType, providerReported, requestEpisode])

  const selectSeason = (seasonNumber: number) => {
    const firstSource = sources.find((source) => source.seasonNumber === seasonNumber)
    requestEpisode({ seasonNumber, episodeNumber: firstSource?.episodeNumber ?? 1 })
  }

  const adoptProviderEpisode = (target: EpisodeRef) => {
    if (mediaType !== 'tv' || !sources.some((source) => source.isDynamic)) return false
    if (!Number.isInteger(target.seasonNumber) || target.seasonNumber <= 0
      || !Number.isInteger(target.episodeNumber) || target.episodeNumber <= 0) return false
    if (availableSeasons.length > 0 && !availableSeasons.includes(target.seasonNumber)) return false
    setSelection((current) => current.providerReported
      && current.seasonNumber === target.seasonNumber && current.episodeNumber === target.episodeNumber
      ? current
      : { ...current, ...target, providerReported: true })
    return true
  }

  return {
    season,
    episode,
    selectSeason,
    selectEpisode: (episodeNumber: number) => requestEpisode({ seasonNumber: season, episodeNumber }),
    adoptProviderEpisode,
    requestVersion,
    availableSeasons,
    episodes,
    loadingEpisodes,
    episodesError,
  }
}
