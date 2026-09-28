import { useEffect, useMemo, useState } from 'react'
import type { MediaSource } from '../../../types/media-source'
import type { Episode, MediaType } from '../../../types/tmdb'
import { getTvSeasonDetails } from '../../catalog/api'
import { useWatchedHistory } from '../../watch-history/watch-history-context'
import { resolveStartEpisode } from '../episodes'

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

  const [initialStart] = useState(startEpisode)
  const [season, setSeason] = useState(initialStart.seasonNumber)
  const [episode, setEpisode] = useState(initialStart.episodeNumber)
  const [episodes, setEpisodes] = useState<Episode[]>([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(mediaType === 'tv')
  const [episodesError, setEpisodesError] = useState<string | null>(null)

  const availableSeasons = useMemo(() => {
    if (numberOfSeasons && sources.some((source) => source.isDynamic)) {
      return Array.from({ length: numberOfSeasons }, (_, index) => index + 1)
    }
    return [...new Set(sources.flatMap((source) => source.seasonNumber ?? []))].sort((a, b) => a - b)
  }, [sources, numberOfSeasons])

  // A different show starts from its own resume point.
  useEffect(() => {
    if (mediaType !== 'tv') return
    const start = startEpisode()
    setSeason(start.seasonNumber)
    setEpisode(start.episodeNumber)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (mediaType !== 'tv') return
    const controller = new AbortController()
    setLoadingEpisodes(true)
    setEpisodesError(null)
    getTvSeasonDetails(id, season, controller.signal)
      .then((data) => {
        setEpisodes(data.episodes ?? [])
        setLoadingEpisodes(false)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setEpisodes([])
        setEpisodesError('Episode metadata is unavailable. Authorised episodes remain playable.')
        setLoadingEpisodes(false)
      })
    return () => controller.abort()
  }, [season, id, mediaType])

  // "Next episode" guesses can run past the end of a season: move on to the
  // next season, or settle on the final episode.
  useEffect(() => {
    if (mediaType !== 'tv' || loadingEpisodes || episodes.length === 0 || episode <= episodes.length) return
    const seasonIndex = availableSeasons.indexOf(season)
    if (seasonIndex !== -1 && seasonIndex < availableSeasons.length - 1) {
      setSeason(availableSeasons[seasonIndex + 1])
      setEpisode(1)
    } else {
      setEpisode(episodes.length)
    }
  }, [episodes, loadingEpisodes, season, episode, availableSeasons, mediaType])

  const selectSeason = (seasonNumber: number) => {
    const firstSource = sources.find((source) => source.seasonNumber === seasonNumber)
    setSeason(seasonNumber)
    setEpisode(firstSource?.episodeNumber ?? 1)
  }

  return {
    season,
    episode,
    selectSeason,
    selectEpisode: setEpisode,
    availableSeasons,
    episodes,
    loadingEpisodes,
    episodesError,
  }
}
