export type DriftCorrection =
  | { kind: 'none'; rate: number }
  | { kind: 'rate'; rate: number; restoreAfterMs: 4_000 }
  | { kind: 'seek'; rate: number }
  | { kind: 'postpone'; rate: number }

export function shouldPostponeCorrection(input: { waiting: boolean; stalled: boolean; seeking: boolean; readyState: number }) {
  return input.waiting || input.stalled || input.seeking || input.readyState < 2
}

export function correctionForDrift(
  driftMs: number,
  authoritativeRate: number,
  input: { ready: boolean; playing: boolean; explicit: boolean; hardSeekCoolingDown: boolean },
): DriftCorrection {
  if (!input.ready && !input.explicit) return { kind: 'postpone', rate: authoritativeRate }
  const absolute = Math.abs(driftMs)
  if (absolute <= 250) return { kind: 'none', rate: authoritativeRate }
  if (!input.explicit && absolute <= 1_500 && input.playing) {
    const multiplier = Math.min(1.03, Math.max(0.97, 1 + driftMs / 50_000))
    return { kind: 'rate', rate: authoritativeRate * multiplier, restoreAfterMs: 4_000 }
  }
  if (!input.explicit && input.hardSeekCoolingDown) return { kind: 'postpone', rate: authoritativeRate }
  return { kind: 'seek', rate: authoritativeRate }
}

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
  if (delay > 5_000) return null
  return Math.max(0, delay)
}
