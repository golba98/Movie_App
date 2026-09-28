import { DRIFT_CORRECTION } from '../../../src/types/watch-party'

const { ignoreMs, seekMs, msPerRateUnit, minRate, maxRate } = DRIFT_CORRECTION
// A rate nudge lasts this long before the room's own rate is restored.
const RATE_RESTORE_MS = 4_000
// Commands scheduled further ahead than this are treated as stale.
const MAX_COMMAND_DELAY_MS = 5_000

export type DriftCorrection =
  | { kind: 'none'; rate: number }
  | { kind: 'rate'; rate: number; restoreAfterMs: typeof RATE_RESTORE_MS }
  | { kind: 'seek'; rate: number }
  | { kind: 'postpone'; rate: number }

// Correcting a player that is still loading or seeking only makes it stutter.
export function shouldPostponeCorrection(input: { waiting: boolean; stalled: boolean; seeking: boolean; readyState: number }) {
  return input.waiting || input.stalled || input.seeking || input.readyState < 2
}

/**
 * Like the website's driftCorrection, plus extension concerns: explicit
 * commands always seek, and hard seeks are rate-limited while cooling down.
 */
export function correctionForDrift(
  driftMs: number,
  authoritativeRate: number,
  input: { ready: boolean; playing: boolean; explicit: boolean; hardSeekCoolingDown: boolean },
): DriftCorrection {
  if (!input.ready && !input.explicit) return { kind: 'postpone', rate: authoritativeRate }
  const absolute = Math.abs(driftMs)
  if (absolute <= ignoreMs) return { kind: 'none', rate: authoritativeRate }
  if (!input.explicit && absolute <= seekMs && input.playing) {
    const multiplier = Math.min(maxRate, Math.max(minRate, 1 + driftMs / msPerRateUnit))
    return { kind: 'rate', rate: authoritativeRate * multiplier, restoreAfterMs: RATE_RESTORE_MS }
  }
  if (!input.explicit && input.hardSeekCoolingDown) return { kind: 'postpone', rate: authoritativeRate }
  return { kind: 'seek', rate: authoritativeRate }
}

/** Keeps a seek inside the media's duration and, when known, its seekable ranges. */
export function clampSeekTime(positionSeconds: number, duration: number, ranges: { start: number; end: number }[]) {
  let clamped = Math.max(0, positionSeconds)
  if (Number.isFinite(duration)) clamped = Math.min(clamped, Math.max(0, duration))
  const valid = ranges.filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end >= range.start)
  if (!valid.length) return clamped
  const containing = valid.find((range) => clamped >= range.start && clamped <= range.end)
  if (containing) return clamped
  return valid
    .flatMap((range) => [range.start, range.end])
    .sort((left, right) => Math.abs(left - clamped) - Math.abs(right - clamped))[0]
}

export function commandDelayMs(executeAtServerMs: number, clockOffsetMs: number, nowLocalEpochMs: number) {
  const delay = executeAtServerMs - clockOffsetMs - nowLocalEpochMs
  if (delay > MAX_COMMAND_DELAY_MS) return null
  return Math.max(0, delay)
}
