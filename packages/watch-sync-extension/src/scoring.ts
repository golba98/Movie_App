export interface VideoSignals {
  connected: boolean
  cssVisible: boolean
  width: number
  height: number
  intersectionArea: number
  viewportArea: number
  videoWidth: number
  videoHeight: number
  readyState: number
  hasCurrentSource: boolean
  paused: boolean
  recentMediaEvent: boolean
  recentInteraction: boolean
  muted: boolean
  loop: boolean
  autoplay: boolean
  duration: number
}

export interface ScoredCandidate<T = unknown> {
  id: string
  fingerprint: string
  score: number
  eligible: boolean
  value: T
}

export function scoreVideo(signals: VideoSignals, hasLongCandidate: boolean) {
  if (!signals.connected || !signals.cssVisible || signals.width <= 0 || signals.height <= 0) {
    return { score: Number.NEGATIVE_INFINITY, eligible: false }
  }
  let score = 0
  score += 40 * Math.min(1, signals.intersectionArea / Math.max(1, signals.viewportArea * 0.5))
  score += 15 * Math.min(1, (signals.videoWidth * signals.videoHeight) / (1920 * 1080))
  score += signals.readyState >= 2 ? 8 : signals.readyState > 0 ? 3 : 0
  score += signals.hasCurrentSource ? 5 : 0
  score += signals.paused ? 0 : 10
  score += signals.recentMediaEvent ? 5 : 0
  score += signals.recentInteraction ? 4 : 0
  score += signals.duration >= 60 ? 8 : signals.duration >= 15 ? 4 : 0
  if (signals.width < 160 || signals.height < 90) score -= 30
  if (signals.muted && signals.loop && signals.autoplay) score -= 20
  if (hasLongCandidate && Number.isFinite(signals.duration) && signals.duration < 15) score -= 20
  return { score: Math.round(score * 100) / 100, eligible: true }
}

export function chooseCandidate<T>(
  candidates: ScoredCandidate<T>[],
  manual: { id: string; fingerprint: string } | null,
) {
  const eligible = candidates.filter((candidate) => candidate.eligible).sort((left, right) => right.score - left.score)
  if (manual) {
    const preserved = eligible.find((candidate) => candidate.id === manual.id && candidate.fingerprint === manual.fingerprint)
    if (preserved) return { selected: preserved, ambiguous: false, reason: 'manual-preserved' as const }
  }
  if (eligible.length === 1) return { selected: eligible[0], ambiguous: false, reason: 'only-candidate' as const }
  if (eligible.length > 1 && eligible[0].score - eligible[1].score >= 15) {
    return { selected: eligible[0], ambiguous: false, reason: 'clear-leader' as const }
  }
  return { selected: null, ambiguous: eligible.length > 1, reason: eligible.length ? 'ambiguous' as const : 'unavailable' as const }
}

export function mediaFingerprint(input: {
  domPosition: string
  mediaIndex: number
  width: number
  height: number
  duration: number
}) {
  const widthBucket = Math.max(0, Math.round(input.width / 160))
  const heightBucket = Math.max(0, Math.round(input.height / 90))
  const durationBucket = !Number.isFinite(input.duration) ? 'live' : String(Math.max(0, Math.round(input.duration / 30)))
  const safe = `${input.domPosition}|${input.mediaIndex}|${widthBucket}x${heightBucket}|${durationBucket}`
  let hash = 0x811c9dc5
  for (let index = 0; index < safe.length; index += 1) {
    hash ^= safe.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0').slice(0, 8)
}
