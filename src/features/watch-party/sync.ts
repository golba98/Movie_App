import type { WatchPartyState } from '../../types/watch-party'

// Drift within this is ignored; up to SEEK_THRESHOLD_MS is nudged with the
// playback rate, and anything larger jumps straight to the room position.
const IGNORE_DRIFT_MS = 250
const SEEK_THRESHOLD_MS = 1_500
// A 500 ms drift changes the rate by 1%, within ±3%.
const DRIFT_PER_RATE_UNIT_MS = 50_000
const MIN_RATE = 0.97
const MAX_RATE = 1.03

type TimedPlayback = Pick<WatchPartyState, 'playbackState' | 'positionMs' | 'playbackRate' | 'stateUpdatedAt'>

/** Where the room's playback should be at `serverNow`. */
export function expectedPlaybackPosition(state: TimedPlayback, serverNow: number) {
  return state.playbackState === 'playing'
    ? state.positionMs + Math.max(0, serverNow - state.stateUpdatedAt) * state.playbackRate
    : state.positionMs
}

export function driftCorrection(driftMs: number) {
  const absolute = Math.abs(driftMs)
  if (absolute <= IGNORE_DRIFT_MS) return { kind: 'none' as const, rate: 1 }
  if (absolute <= SEEK_THRESHOLD_MS) {
    return { kind: 'rate' as const, rate: Math.min(MAX_RATE, Math.max(MIN_RATE, 1 + driftMs / DRIFT_PER_RATE_UNIT_MS)) }
  }
  return { kind: 'seek' as const, rate: 1 }
}
