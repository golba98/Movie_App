import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { playerDebug } from '../player-debug'
import type { EmbedProgress } from './useEmbedProgress'

interface Options {
  iframeRef: RefObject<HTMLIFrameElement | null>
  frameKey: string | null
  mediaKey: string
  resumePosition: number | null
  onProgress: (report: EmbedProgress) => void
}

interface ResumeState {
  key: string
  phase: 'waiting' | 'seeking' | 'ready' | 'failed'
  saved: number
  target: number
  attempts: number
  timer: number | null
}

/** Refresh the provider's caption renderer through its seek path after playback is ready. */
export function useEmbedResume({ iframeRef, frameKey, mediaKey, resumePosition, onProgress }: Options) {
  const stateRef = useRef<ResumeState | null>(null)
  const [failureKey, setFailureKey] = useState<string | null>(null)
  const key = `${mediaKey}|${frameKey}`

  useEffect(() => () => {
    if (stateRef.current?.timer != null) window.clearTimeout(stateRef.current.timer)
    stateRef.current = null
  }, [key])

  const accept = useCallback((report: EmbedProgress) => {
    const frame = iframeRef.current
    if (!frameKey || !frame || new URL(frame.src).hostname.replace(/^www\./, '') !== 'vsembed.ru') {
      onProgress(report)
      return
    }
    let state = stateRef.current
    if (!state || state.key !== key) {
      const start = Number(new URL(frame.src).searchParams.get('startAt')) || resumePosition || 0
      state = { key, saved: start, target: start, phase: start > 0 ? 'waiting' : 'ready', attempts: 0, timer: null }
      stateRef.current = state
    }
    const finish = () => {
      if (state.timer !== null) window.clearTimeout(state.timer)
      state.timer = null
      state.phase = 'ready'
      setFailureKey(null)
      onProgress(report)
    }
    if (state.phase === 'ready') return onProgress(report)
    // A viewer seek away from the resume point always wins, including after timeout.
    if (report.status === 'seeked' && Math.abs(report.position - state.target) > 5) return finish()
    if (state.phase === 'failed') {
      if (report.status === 'seeked') return finish()
      return
    }
    if (state.phase === 'seeking' && Math.abs(report.position - state.target) <= 5) {
      playerDebug('resume seek confirmed', { media: mediaKey, position: report.position, captionReadiness: 'provider-owned' })
      return finish()
    }
    if (state.phase !== 'waiting' || report.status !== 'playing') return
    if (state.saved >= report.duration * 0.95) return finish()
    // Keep the actual position if startAt already worked; never rewind elapsed playback.
    state.target = report.position >= state.saved - 5 ? report.position : state.saved
    state.phase = 'seeking'
    const frameWindow = frame.contentWindow
    const origin = new URL(frame.src).origin
    const send = () => {
      if (!frameWindow || iframeRef.current?.contentWindow !== frameWindow || stateRef.current !== state) return
      state.attempts += 1
      playerDebug('synchronizing resumed player', { media: mediaKey, saved: state.saved, reported: report.position,
        target: state.target, attempt: state.attempts })
      frameWindow.postMessage({ player: true, action: `seek${Math.floor(state.target)}` }, origin)
      state.timer = window.setTimeout(() => {
        if (state.attempts < 2) send()
        else {
          state.phase = 'failed'
          state.timer = null
          setFailureKey(key)
          playerDebug('resume seek not confirmed', { media: mediaKey, target: state.target })
        }
      }, 5_000)
    }
    send()
  }, [frameKey, iframeRef, key, mediaKey, onProgress, resumePosition])

  return { onProgress: accept, resumeFailed: failureKey === key }
}
