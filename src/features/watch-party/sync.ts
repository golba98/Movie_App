import { DRIFT_CORRECTION, type WatchPartyState } from '../../types/watch-party'

const { ignoreMs, seekMs, msPerRateUnit, minRate, maxRate } = DRIFT_CORRECTION

type TimedPlayback = Pick<WatchPartyState, 'playbackState' | 'positionMs' | 'playbackRate' | 'stateUpdatedAt'>

/** Where the room's playback should be at `serverNow`. */
export function expectedPlaybackPosition(state: TimedPlayback, serverNow: number) {
  return state.playbackState === 'playing'
    ? state.positionMs + Math.max(0, serverNow - state.stateUpdatedAt) * state.playbackRate
    : state.positionMs
}

export function driftCorrection(driftMs: number) {
  const absolute = Math.abs(driftMs)
  if (absolute <= ignoreMs) return { kind: 'none' as const, rate: 1 }
  if (absolute <= seekMs) {
    return { kind: 'rate' as const, rate: Math.min(maxRate, Math.max(minRate, 1 + driftMs / msPerRateUnit)) }
  }
  return { kind: 'seek' as const, rate: 1 }
}
