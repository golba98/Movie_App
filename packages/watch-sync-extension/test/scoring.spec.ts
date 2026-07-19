import { describe, expect, it } from 'vitest'
import { chooseCandidate, mediaFingerprint, scoreVideo, type ScoredCandidate, type VideoSignals } from '../src/scoring'

const visibleVideo = (overrides: Partial<VideoSignals> = {}): VideoSignals => ({
  connected: true,
  cssVisible: true,
  width: 1280,
  height: 720,
  intersectionArea: 1280 * 720,
  viewportArea: 1920 * 1080,
  videoWidth: 1920,
  videoHeight: 1080,
  readyState: 4,
  hasCurrentSource: true,
  paused: false,
  recentMediaEvent: true,
  recentInteraction: true,
  muted: false,
  loop: false,
  autoplay: false,
  duration: 7_200,
  ...overrides,
})

const candidate = (id: string, score: number): ScoredCandidate<string> => ({ id, fingerprint: id, score, eligible: true, value: id })

describe('video scoring and selection', () => {
  it('hard-rejects disconnected, hidden, and zero-area videos', () => {
    expect(scoreVideo(visibleVideo({ connected: false }), false).eligible).toBe(false)
    expect(scoreVideo(visibleVideo({ cssVisible: false }), false).eligible).toBe(false)
    expect(scoreVideo(visibleVideo({ width: 0 }), false).eligible).toBe(false)
  })

  it('penalizes tiny muted looping previews and short clips beside a long candidate', () => {
    const feature = scoreVideo(visibleVideo(), true)
    const preview = scoreVideo(visibleVideo({
      width: 120,
      height: 68,
      videoWidth: 160,
      videoHeight: 90,
      intersectionArea: 120 * 68,
      muted: true,
      loop: true,
      autoplay: true,
      duration: 8,
    }), true)
    expect(feature.score - preview.score).toBeGreaterThan(60)
  })

  it('requires manual selection for ambiguous leaders and auto-selects a 15-point leader', () => {
    expect(chooseCandidate([candidate('a', 80), candidate('b', 70)], null)).toMatchObject({ selected: null, ambiguous: true })
    expect(chooseCandidate([candidate('a', 85), candidate('b', 70)], null).selected?.id).toBe('a')
  })

  it('preserves an exact manual fingerprint and replaces it only after it disappears', () => {
    expect(chooseCandidate([candidate('manual', 10), candidate('other', 99)], { id: 'manual', fingerprint: 'manual' }).selected?.id).toBe('manual')
    expect(chooseCandidate([candidate('replacement', 90)], { id: 'manual', fingerprint: 'manual' }).selected?.id).toBe('replacement')
  })

  it('builds stable safe fingerprints without media URLs or titles', () => {
    const first = mediaFingerprint({ domPosition: 'body:0/main:0/video:0', mediaIndex: 0, width: 1280, height: 720, duration: 120 })
    const second = mediaFingerprint({ domPosition: 'body:0/main:0/video:0', mediaIndex: 0, width: 1280, height: 720, duration: 120 })
    expect(first).toBe(second)
    expect(first).toMatch(/^[a-f0-9]{8}$/)
  })
})
