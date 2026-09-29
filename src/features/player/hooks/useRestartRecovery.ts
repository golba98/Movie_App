import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { playerDebug } from '../player-debug'
import type { EmbedProgress } from './useEmbedProgress'

// Falling this far behind without the viewer seeking means the provider
// restarted playback: Source 1 fails over to another stream host mid-episode,
// and the new host starts at 0:00.
const RESTART_MIN_DROP_SECONDS = 60
// The browser reports a seek's new time just before the seek itself, so a drop
// waits this long for a 'seeked' before it counts as a restart.
const SEEKED_GRACE_MS = 2_000
// Playback within this of where it was counts as restored.
const RESTORED_TOLERANCE_SECONDS = 15
const MAX_SEEK_ATTEMPTS = 2

type Recovery =
  | { phase: 'suspected'; timer: number }
  | { phase: 'seeking'; target: number; attempts: number }

interface RestartRecoveryOptions {
  iframeRef: RefObject<HTMLIFrameElement | null>
  // A frame is showing this title. Any change resets, since a new frame opens at its own start.
  active: boolean
  sessionKey: string
  seasonNumber: number | null
  episodeNumber: number | null
  onProgress: (position: number, duration: number) => void
}

function frameOrigin(src: string | undefined) {
  try {
    return src ? new URL(src).origin : null
  } catch {
    return null
  }
}

/**
 * Sits between an embedded player's progress messages and the watch history.
 * When the provider restarts playback on its own, it seeks the provider back
 * to where the viewer was, using the `{ player: true, action: 'seek<N>' }`
 * command vsembed's player accepts, and keeps the restarted positions out of
 * history in the meantime. Only players that report their status are watched,
 * as only they tell a viewer's own seek apart from a restart.
 */
export function useRestartRecovery({ iframeRef, active, sessionKey, seasonNumber, episodeNumber, onProgress }: RestartRecoveryOptions) {
  const lastPositionRef = useRef<number | null>(null)
  const recoveryRef = useRef<Recovery | null>(null)

  const clearRecovery = useCallback(() => {
    const recovery = recoveryRef.current
    if (recovery?.phase === 'suspected') window.clearTimeout(recovery.timer)
    recoveryRef.current = null
  }, [])

  useEffect(() => () => {
    clearRecovery()
    lastPositionRef.current = null
  }, [active, sessionKey, clearRecovery])

  const seekBack = useCallback((target: number) => {
    const frame = iframeRef.current
    const origin = frameOrigin(frame?.src)
    if (!frame?.contentWindow || !origin) return
    frame.contentWindow.postMessage({ player: true, action: `seek${Math.floor(target)}` }, origin)
  }, [iframeRef])

  return useCallback((progress: EmbedProgress) => {
    const { position, duration, status } = progress
    // Another episode, e.g. one picked in the provider's own menu.
    if (progress.episode !== undefined && (progress.season !== seasonNumber || progress.episode !== episodeNumber)) return

    const accept = () => {
      lastPositionRef.current = position
      onProgress(position, duration)
    }
    if (status === undefined) return accept()

    const recovery = recoveryRef.current
    if (recovery?.phase === 'suspected') {
      if (status !== 'seeked') return
      // The viewer seeked back.
      clearRecovery()
      return accept()
    }

    if (recovery?.phase === 'seeking') {
      if (position >= recovery.target - RESTORED_TOLERANCE_SECONDS) {
        playerDebug('provider playback restored', { at: Math.round(position) })
        clearRecovery()
        return accept()
      }
      // A seek elsewhere means the viewer took over.
      if (status === 'seeked' || recovery.attempts >= MAX_SEEK_ATTEMPTS) {
        if (status !== 'seeked') playerDebug('provider playback could not be restored', { target: Math.round(recovery.target) })
        clearRecovery()
        return accept()
      }
      recoveryRef.current = { ...recovery, attempts: recovery.attempts + 1 }
      seekBack(recovery.target)
      return
    }

    const last = lastPositionRef.current
    if (last !== null && status !== 'seeked' && last - position > RESTART_MIN_DROP_SECONDS) {
      const timer = window.setTimeout(() => {
        recoveryRef.current = { phase: 'seeking', target: last, attempts: 1 }
        playerDebug('provider restarted playback; seeking back', { from: Math.round(last), to: Math.round(position) })
        seekBack(last)
      }, SEEKED_GRACE_MS)
      recoveryRef.current = { phase: 'suspected', timer }
      return
    }
    accept()
  }, [clearRecovery, episodeNumber, onProgress, seasonNumber, seekBack])
}
