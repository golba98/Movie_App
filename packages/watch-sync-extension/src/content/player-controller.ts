import { localEpochMs } from '../clock'
import { AutoplayGate } from '../autoplay'
import { clampSeekTime, commandDelayMs, correctionForDrift, shouldPostponeCorrection } from '../drift'
import { EchoSuppressor, type MediaEventName } from '../echo-suppression'
import { chooseCandidate, mediaFingerprint, scoreVideo, type ScoredCandidate, type VideoSignals } from '../scoring'
import { RevisionScheduler } from '../revision-scheduler'
import type { AuthoritativeState, InternalMessage, PlaybackCommandMetadata } from '../types'

const controllerKey = '__fedoraMoviesWatchSyncController__'
const controllerGlobal = globalThis as typeof globalThis & { [controllerKey]?: { rescan: () => void; shutdown: () => void } }

function startController() {
  const previous = controllerGlobal[controllerKey]
  if (previous) {
    previous.rescan()
    return
  }

  const port = chrome.runtime.connect({ name: 'watch-sync-player' })
  const suppressor = new EchoSuppressor()
  const observed = new WeakSet<HTMLVideoElement>()
  const recentMedia = new WeakMap<HTMLVideoElement, number>()
  const recentInteraction = new WeakMap<HTMLVideoElement, number>()
  const fingerprintToVideo = new Map<string, HTMLVideoElement>()
  let selectedFingerprint: string | null = null
  let active = true
  let waiting = false
  let stalled = false
  const autoplayGate = new AutoplayGate()
  const commandScheduler = new RevisionScheduler()
  let latestRevision = -1
  let rateRestore: number | null = null
  let snapshotTimer: number | null = null
  let lastHardSeekAt = Number.NEGATIVE_INFINITY
  let latestState: AuthoritativeState | null = null
  let latestClockOffsetMs = 0

  const safePost = (message: InternalMessage) => {
    if (active) port.postMessage(message)
  }

  const domPosition = (element: Element) => {
    const parts: string[] = []
    let current: Element | null = element
    while (current && current !== document.documentElement && parts.length < 8) {
      const parent: Element | null = current.parentElement
      const siblings: Element[] = parent ? Array.from(parent.children).filter((child: Element) => child.tagName === current!.tagName) : []
      parts.push(`${current.tagName.toLowerCase()}:${Math.max(0, siblings.indexOf(current))}`)
      current = parent
    }
    return parts.reverse().join('/')
  }

  const seekableRanges = (video: HTMLVideoElement) => {
    const ranges: { start: number; end: number }[] = []
    for (let index = 0; index < video.seekable.length; index += 1) {
      ranges.push({ start: video.seekable.start(index), end: video.seekable.end(index) })
    }
    return ranges
  }

  const selectedVideo = () => selectedFingerprint ? fingerprintToVideo.get(selectedFingerprint) ?? null : null

  const snapshot = () => {
    const video = selectedVideo()
    if (!video) return
    const expectedPositionMs = latestState
      ? latestState.playbackState === 'playing'
        ? latestState.positionMs + Math.max(0, localEpochMs() + latestClockOffsetMs - latestState.stateUpdatedAt) * latestState.playbackRate
        : latestState.positionMs
      : video.currentTime * 1_000
    const driftMs = expectedPositionMs - video.currentTime * 1_000
    if (latestState && rateRestore !== null && Math.abs(driftMs) <= 150) {
      window.clearTimeout(rateRestore)
      rateRestore = null
      suppressor.begin({
        revision: latestState.revision,
        expected: ['ratechange'],
        expectedPaused: video.paused,
        expectedPositionSeconds: video.currentTime,
        expectedRate: latestState.playbackRate,
        positionToleranceSeconds: 1.25,
        rateTolerance: 0.035,
        deadlineMs: localEpochMs() + 2_500,
      })
      video.playbackRate = latestState.playbackRate
      window.setTimeout(() => {
        if (latestState) applyRemote(latestState, undefined, latestClockOffsetMs)
      }, 1_000)
    }
    safePost({
      type: 'frame:snapshot',
      positionMs: Math.max(0, video.currentTime * 1_000),
      playbackState: waiting || stalled ? 'buffering' : video.ended ? 'ended' : video.paused ? 'paused' : 'playing',
      playbackRate: video.playbackRate,
      buffering: waiting || stalled,
      readyState: video.readyState,
      driftMs,
    })
  }

  const scheduleSnapshot = () => {
    if (snapshotTimer !== null) window.clearTimeout(snapshotTimer)
    const video = selectedVideo()
    snapshotTimer = window.setTimeout(() => {
      snapshot()
      scheduleSnapshot()
    }, video && !video.paused ? 1_000 : 5_000)
  }

  const localIntent = (event: MediaEventName, video: HTMLVideoElement) => {
    if (video !== selectedVideo()) return
    recentMedia.set(video, performance.now())
    const consumed = suppressor.consume(event, video, localEpochMs())
    snapshot()
    if (consumed) return
    if (event === 'play' || event === 'playing') safePost({ type: 'frame:local-intent', intent: 'play' })
    else if (event === 'pause') safePost({ type: 'frame:local-intent', intent: 'pause' })
    else if (event === 'seeking' || event === 'seeked') safePost({ type: 'frame:local-intent', intent: 'seek', positionMs: video.currentTime * 1_000 })
    else safePost({ type: 'frame:local-intent', intent: 'rate', playbackRate: video.playbackRate })
  }

  const observeVideo = (video: HTMLVideoElement) => {
    if (observed.has(video)) return
    observed.add(video)
    for (const eventName of ['play', 'playing', 'pause', 'seeking', 'seeked', 'ratechange'] as MediaEventName[]) {
      video.addEventListener(eventName, () => localIntent(eventName, video))
    }
    video.addEventListener('waiting', () => { waiting = true; snapshot() })
    video.addEventListener('stalled', () => { stalled = true; snapshot() })
    video.addEventListener('canplay', () => { waiting = false; stalled = false; snapshot() })
    video.addEventListener('playing', () => { waiting = false; stalled = false })
  }

  const signalsFor = (video: HTMLVideoElement): VideoSignals => {
    const rect = video.getBoundingClientRect()
    const style = getComputedStyle(video)
    const intersectWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0))
    const intersectHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0))
    return {
      connected: video.isConnected,
      cssVisible: style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0,
      width: rect.width,
      height: rect.height,
      intersectionArea: intersectWidth * intersectHeight,
      viewportArea: Math.max(1, innerWidth * innerHeight),
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      readyState: video.readyState,
      hasCurrentSource: Boolean(video.currentSrc || video.getAttribute('src') || video.querySelector('source')),
      paused: video.paused,
      recentMediaEvent: performance.now() - (recentMedia.get(video) ?? Number.NEGATIVE_INFINITY) < 10_000,
      recentInteraction: performance.now() - (recentInteraction.get(video) ?? Number.NEGATIVE_INFINITY) < 15_000,
      muted: video.muted,
      loop: video.loop,
      autoplay: video.autoplay,
      duration: video.duration,
    }
  }

  const rescan = () => {
    if (!active) return
    fingerprintToVideo.clear()
    const videos = Array.from(document.querySelectorAll('video'))
    const hasLongCandidate = videos.some((video) => Number.isFinite(video.duration) && video.duration >= 60)
    const scored: ScoredCandidate<HTMLVideoElement>[] = videos.map((video, mediaIndex) => {
      observeVideo(video)
      const signals = signalsFor(video)
      const fingerprint = mediaFingerprint({
        domPosition: domPosition(video),
        mediaIndex,
        width: signals.width,
        height: signals.height,
        duration: signals.duration,
      })
      const scoredVideo = scoreVideo(signals, hasLongCandidate)
      fingerprintToVideo.set(fingerprint, video)
      return { id: fingerprint, fingerprint, value: video, ...scoredVideo }
    })
    const manual = selectedFingerprint ? { id: selectedFingerprint, fingerprint: selectedFingerprint } : null
    const choice = chooseCandidate(scored, manual)
    if (!selectedFingerprint && choice.selected) selectedFingerprint = choice.selected.fingerprint
    if (selectedFingerprint && !fingerprintToVideo.has(selectedFingerprint)) selectedFingerprint = choice.selected?.fingerprint ?? null
    safePost({
      type: 'frame:candidates',
      candidates: scored.filter((candidate) => candidate.eligible).map((candidate) => {
        const video = candidate.value
        const rect = video.getBoundingClientRect()
        return {
          fingerprint: candidate.fingerprint,
          score: candidate.score,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          durationBucket: !Number.isFinite(video.duration) ? 'live' : `${Math.max(0, Math.round(video.duration / 30))}x30s`,
          paused: video.paused,
          readyState: video.readyState,
        }
      }),
    })
    if (!choice.selected && !choice.ambiguous) safePost({ type: 'frame:unavailable', reason: 'No eligible native video is available in this frame.' })
    scheduleSnapshot()
  }

  const beginSuppression = (
    state: AuthoritativeState,
    desiredSeconds: number,
    events: MediaEventName[],
    expectedRate: number,
  ) => suppressor.begin({
    revision: state.revision,
    expected: events,
    expectedPaused: state.playbackState !== 'playing',
    expectedPositionSeconds: desiredSeconds,
    expectedRate,
    positionToleranceSeconds: 1.25,
    rateTolerance: 0.035,
    deadlineMs: localEpochMs() + 2_500,
  })

  const applyRemote = (state: AuthoritativeState, command: PlaybackCommandMetadata | undefined, clockOffsetMs: number) => {
    const video = selectedVideo()
    if (!video || state.revision < latestRevision) return
    latestState = state
    latestClockOffsetMs = clockOffsetMs
    latestRevision = state.revision
    suppressor.clearBefore(state.revision)
    const explicit = command?.reason === 'seek' || command?.reason === 'restart' || command?.reason === 'recovery'
    const execute = () => {
      if (!active || state.revision !== latestRevision) return
      const serverAtExecution = localEpochMs() + clockOffsetMs
      const desiredMs = state.playbackState === 'playing'
        ? state.positionMs + Math.max(0, serverAtExecution - state.stateUpdatedAt) * state.playbackRate
        : state.positionMs
      const desiredSeconds = clampSeekTime(desiredMs / 1_000, video.duration, seekableRanges(video))
      if (shouldPostponeCorrection({ waiting, stalled, seeking: video.seeking, readyState: video.readyState })) {
        window.setTimeout(() => applyRemote(state, { reason: 'recovery', executeAtServerMs: serverAtExecution + 500 }, clockOffsetMs), 500)
        return
      }
      const driftMs = (desiredSeconds - video.currentTime) * 1_000
      const correction = correctionForDrift(driftMs, state.playbackRate, {
        ready: video.readyState >= 2,
        playing: state.playbackState === 'playing',
        explicit,
        hardSeekCoolingDown: !explicit && performance.now() - lastHardSeekAt < 2_000,
      })
      if (state.playbackState !== 'playing') {
        const expectedEvents: MediaEventName[] = []
        if (!video.paused) expectedEvents.push('pause')
        if (Math.abs(driftMs) > 250 || explicit) expectedEvents.push('seeking', 'seeked')
        if (Math.abs(video.playbackRate - state.playbackRate) > 0.001) expectedEvents.push('ratechange')
        if (expectedEvents.length) beginSuppression(state, desiredSeconds, expectedEvents, state.playbackRate)
        video.pause()
        if (Math.abs(driftMs) > 250 || explicit) video.currentTime = desiredSeconds
        video.playbackRate = state.playbackRate
        return
      }
      if (correction.kind === 'seek') {
        beginSuppression(state, desiredSeconds, ['seeking', 'seeked'], state.playbackRate)
        video.currentTime = desiredSeconds
        if (!explicit) lastHardSeekAt = performance.now()
      }
      if (correction.kind === 'rate') {
        beginSuppression(state, desiredSeconds, ['ratechange'], correction.rate)
        video.playbackRate = correction.rate
        if (rateRestore !== null) window.clearTimeout(rateRestore)
        rateRestore = window.setTimeout(() => {
          if (state.revision !== latestRevision) return
          beginSuppression(state, video.currentTime, ['ratechange'], state.playbackRate)
          video.playbackRate = state.playbackRate
          rateRestore = null
          window.setTimeout(() => applyRemote(state, undefined, clockOffsetMs), 1_000)
        }, correction.restoreAfterMs)
      } else if (correction.kind === 'none') {
        if (rateRestore !== null) window.clearTimeout(rateRestore)
        rateRestore = null
        video.playbackRate = state.playbackRate
      }
      if (video.paused && autoplayGate.canAttempt) {
        beginSuppression(state, desiredSeconds, ['play', 'playing'], video.playbackRate)
        void video.play().catch(() => {
          autoplayGate.reject()
          safePost({ type: 'frame:activation-required', message: 'Click or press a key in the player tab to allow synchronized playback.' })
        })
      }
    }
    const delay = command ? commandDelayMs(command.executeAtServerMs, clockOffsetMs, localEpochMs()) : 0
    if (delay === null) return
    commandScheduler.schedule(state.revision, delay, execute)
  }

  const shutdown = () => {
    if (!active) return
    active = false
    observer.disconnect()
    commandScheduler.cancel()
    if (rateRestore !== null) window.clearTimeout(rateRestore)
    if (snapshotTimer !== null) window.clearTimeout(snapshotTimer)
    port.disconnect()
    delete controllerGlobal[controllerKey]
  }

  const observer = new MutationObserver(() => rescan())
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden'] })
  document.addEventListener('pointerdown', (event) => {
    autoplayGate.activate(event.isTrusted)
    const target = event.target instanceof Element ? event.target.closest('video') : null
    if (target instanceof HTMLVideoElement) recentInteraction.set(target, performance.now())
  }, true)
  document.addEventListener('keydown', (event) => autoplayGate.activate(event.isTrusted), true)

  port.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object') return
    const candidate = message as Partial<InternalMessage>
    if (candidate.type === 'background:select-target' && typeof candidate.fingerprint === 'string') {
      if (fingerprintToVideo.has(candidate.fingerprint)) {
        selectedFingerprint = candidate.fingerprint
        snapshot()
      }
    } else if (candidate.type === 'background:remote-command' && candidate.state && typeof candidate.clockOffsetMs === 'number') {
      applyRemote(candidate.state, candidate.command, candidate.clockOffsetMs)
    } else if (candidate.type === 'background:rescan') {
      rescan()
    } else if (candidate.type === 'background:shutdown') {
      shutdown()
    }
  })

  controllerGlobal[controllerKey] = { rescan, shutdown }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', rescan, { once: true })
  else rescan()
}

startController()
