import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { MediaItem } from '../../../types/tmdb'
import type { PlaybackProgress } from '../../../types/watch-history'
import { MIN_COUNTED_WATCH_SECONDS, WATCHED_THRESHOLD } from '../../watch-history/history-state'
import { useWatchedHistory } from '../../watch-history/watch-history-context'
import { useEmbedProgress } from './useEmbedProgress'
import { usePlaybackWatcher, type WatcherUpdateReason } from './usePlaybackWatcher'

const PROGRESS_SAVE_INTERVAL_MS = 5_000
// Saved positions outside this window restart the title instead of resuming.
const MIN_RESUME_SECONDS = 10
export const MAX_RESUME_SHARE = 0.95

export type ProgressSaveMode = 'throttled' | 'now' | 'urgent'

interface WatchProgressOptions {
  media: MediaItem
  seasonNumber: number | null
  episodeNumber: number | null
  // Minutes; 0 or missing when unknown.
  runtimeMinutes: number | null | undefined
  // The player is showing and playing this title.
  active: boolean
  iframeRef: RefObject<HTMLIFrameElement | null>
}

/**
 * Records viewing into watch history. The watcher counts real playback time:
 * a title enters history only after MIN_COUNTED_WATCH_SECONDS, and is
 * finished once watch time covers WATCHED_THRESHOLD of its runtime. A player
 * that reports its own position is trusted over watch time for resuming and
 * finishing.
 */
export function useWatchProgress({ media, seasonNumber, episodeNumber, runtimeMinutes, active, iframeRef }: WatchProgressOptions) {
  const { mediaType, id } = media
  const { isEpisodeWatched, isMovieWatched, getProgress, getEntry, recordWatch } = useWatchedHistory()

  const watched = mediaType === 'tv' ? isEpisodeWatched(id, seasonNumber!, episodeNumber!) : isMovieWatched(id)
  const saved = getProgress(mediaType, id, seasonNumber, episodeNumber)
  const resumePosition = !watched
    && saved
    && saved.position > MIN_RESUME_SECONDS
    && saved.position < saved.duration * MAX_RESUME_SHARE
    ? saved.position
    : null

  const entry = getEntry(mediaType, id, seasonNumber, episodeNumber)
  const hasEntry = entry !== null
  const runtimeSeconds = runtimeMinutes && runtimeMinutes > 0 ? runtimeMinutes * 60 : 0
  const sessionKey = `${mediaType}:${id}:${seasonNumber}:${episodeNumber}`

  const lastSaveRef = useRef(0)
  // The latest position reported by the player for the current title, if any.
  const reportedRef = useRef<PlaybackProgress | null>(null)
  const lastCommitRef = useRef<{ seconds: number; position?: number }>({ seconds: 0 })

  const commitWatch = useCallback((watchSeconds: number, urgent = false) => {
    if (!hasEntry && watchSeconds < MIN_COUNTED_WATCH_SECONDS) return
    const reported = reportedRef.current
    const last = lastCommitRef.current
    if (Math.abs(watchSeconds - last.seconds) < 1 && reported?.position === last.position) return
    lastCommitRef.current = { seconds: watchSeconds, position: reported?.position }
    recordWatch({
      item: media,
      seasonNumber,
      episodeNumber,
      watchSeconds,
      position: reported?.position,
      duration: reported?.duration,
      finished: !reported && runtimeSeconds > 0 && watchSeconds >= runtimeSeconds * WATCHED_THRESHOLD,
      urgent,
    })
  }, [episodeNumber, hasEntry, media, recordWatch, runtimeSeconds, seasonNumber])

  const readWatchSeconds = usePlaybackWatcher({
    active,
    sessionKey,
    initialSeconds: entry?.watchSeconds ?? 0,
    onUpdate: useCallback(
      (watchSeconds: number, reason: WatcherUpdateReason) => commitWatch(watchSeconds, reason !== 'tick'),
      [commitWatch],
    ),
  })

  // Runs after the watcher has reported the previous title, so nothing leaks across.
  useEffect(() => {
    reportedRef.current = null
    lastCommitRef.current = { seconds: readWatchSeconds() }
  }, [sessionKey, readWatchSeconds])

  const saveProgress = useCallback((position: number, duration: number, mode: ProgressSaveMode = 'throttled') => {
    if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return
    reportedRef.current = { position, duration }
    const crossedThreshold = !watched && position / duration >= WATCHED_THRESHOLD
    const now = Date.now()
    if (mode === 'throttled' && !crossedThreshold && now - lastSaveRef.current < PROGRESS_SAVE_INTERVAL_MS) return
    lastSaveRef.current = now
    commitWatch(readWatchSeconds(), mode === 'urgent')
  }, [watched, commitWatch, readWatchSeconds])

  useEmbedProgress(iframeRef, ({ position, duration }) => saveProgress(position, duration))

  /** Saves the latest watch time straight away, e.g. before reloading the player. */
  const flush = useCallback(() => commitWatch(readWatchSeconds(), true), [commitWatch, readWatchSeconds])

  return { resumePosition, saveProgress, flush }
}
