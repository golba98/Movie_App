import { describe, expect, it, vi } from 'vitest'
import { AutoplayGate } from '../src/autoplay'
import { ClockEstimator } from '../src/clock'
import { clampSeekTime, commandDelayMs, correctionForDrift, shouldPostponeCorrection } from '../src/drift'
import { EchoSuppressor } from '../src/echo-suppression'
import { reconnectDelayMs } from '../src/reconnect'
import { RevisionScheduler } from '../src/revision-scheduler'

describe('clock, drift, scheduling, and suppression', () => {
  it('uses the median offset of the three lowest-RTT samples and retains eight', () => {
    const clock = new ClockEstimator()
    clock.addSample(1_000, 1_010, 1_015) // offset 10, RTT 10
    clock.addSample(2_000, 2_020, 2_030) // offset 20, RTT 20
    clock.addSample(3_000, 3_030, 3_045) // offset 30, RTT 30
    clock.addSample(4_000, 4_500, 9_000) // high RTT outlier
    expect(clock.estimate()).toBe(20)
    for (let index = 0; index < 10; index += 1) clock.addSample(index, index + 50, index + 25)
    expect(clock.count).toBe(8)
  })

  it('applies the exact drift thresholds and bounded rate correction', () => {
    expect(correctionForDrift(250, 1, { ready: true, playing: true, explicit: false, hardSeekCoolingDown: false })).toEqual({ kind: 'none', rate: 1 })
    expect(correctionForDrift(251, 1, { ready: true, playing: true, explicit: false, hardSeekCoolingDown: false })).toMatchObject({ kind: 'rate' })
    expect(correctionForDrift(1_500, 1, { ready: true, playing: true, explicit: false, hardSeekCoolingDown: false })).toMatchObject({ kind: 'rate', rate: 1.03 })
    expect(correctionForDrift(-1_500, 1, { ready: true, playing: true, explicit: false, hardSeekCoolingDown: false })).toMatchObject({ kind: 'rate', rate: 0.97 })
    expect(correctionForDrift(1_501, 1, { ready: true, playing: true, explicit: false, hardSeekCoolingDown: false }).kind).toBe('seek')
  })

  it('postpones while buffering and respects hard-seek cooldown', () => {
    expect(shouldPostponeCorrection({ waiting: true, stalled: false, seeking: false, readyState: 4 })).toBe(true)
    expect(shouldPostponeCorrection({ waiting: false, stalled: false, seeking: false, readyState: 1 })).toBe(true)
    expect(correctionForDrift(2_000, 1, { ready: true, playing: true, explicit: false, hardSeekCoolingDown: true }).kind).toBe('postpone')
    expect(correctionForDrift(2_000, 1, { ready: false, playing: true, explicit: true, hardSeekCoolingDown: true }).kind).toBe('seek')
  })

  it('clamps seeks to finite duration and the nearest valid seekable range', () => {
    expect(clampSeekTime(150, 120, [])).toBe(120)
    expect(clampSeekTime(50, 120, [{ start: 0, end: 30 }, { start: 80, end: 120 }])).toBe(30)
    expect(clampSeekTime(90, 120, [{ start: 80, end: 120 }])).toBe(90)
  })

  it('rejects commands over five seconds ahead and cancels superseded revisions', () => {
    expect(commandDelayMs(10_001, 0, 5_000)).toBeNull()
    expect(commandDelayMs(10_000, 0, 5_000)).toBe(5_000)
    vi.useFakeTimers()
    const calls: number[] = []
    const scheduler = new RevisionScheduler()
    scheduler.schedule(1, 100, () => calls.push(1))
    scheduler.schedule(2, 50, () => calls.push(2))
    expect(scheduler.schedule(1, 10, () => calls.push(3))).toBe(false)
    vi.advanceTimersByTime(100)
    expect(calls).toEqual([2])
    vi.useRealTimers()
  })

  it('suppresses only matching remote media events before the deadline', () => {
    const suppressor = new EchoSuppressor()
    suppressor.begin({ revision: 7, expected: ['play', 'playing'], expectedPaused: false, expectedPositionSeconds: 10, expectedRate: 1, positionToleranceSeconds: 0.5, rateTolerance: 0.01, deadlineMs: 2_000 })
    expect(suppressor.consume('pause', { paused: true, currentTime: 10, playbackRate: 1 }, 1_000)).toBe(false)
    expect(suppressor.consume('play', { paused: false, currentTime: 14, playbackRate: 1 }, 1_000)).toBe(false)
    expect(suppressor.consume('play', { paused: false, currentTime: 10.1, playbackRate: 1 }, 1_000)).toBe(true)
    expect(suppressor.consume('playing', { paused: false, currentTime: 10.2, playbackRate: 1 }, 2_001)).toBe(false)
  })

  it('blocks repeated autoplay attempts until trusted activation', () => {
    const gate = new AutoplayGate()
    expect(gate.canAttempt).toBe(true)
    gate.reject()
    expect(gate.canAttempt).toBe(false)
    gate.activate(false)
    expect(gate.canAttempt).toBe(false)
    gate.activate(true)
    expect(gate.canAttempt).toBe(true)
  })

  it('caps reconnect backoff at 20 seconds with plus-or-minus 20 percent jitter', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(400)
    expect(reconnectDelayMs(0, () => 1)).toBe(600)
    expect(reconnectDelayMs(20, () => 0)).toBe(16_000)
    expect(reconnectDelayMs(20, () => 1)).toBe(24_000)
  })
})
