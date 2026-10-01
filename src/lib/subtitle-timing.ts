/** Cue timestamps stay absolute. Runtime is a compatibility check, never an offset. */
export function subtitleFitsRuntime(lastCueSeconds: number, runtimeSeconds: number) {
  return Number.isFinite(lastCueSeconds) && Number.isFinite(runtimeSeconds)
    && runtimeSeconds > 0
    && lastCueSeconds >= runtimeSeconds * 0.6
    && lastCueSeconds <= runtimeSeconds + Math.min(120, runtimeSeconds * 0.15)
}
