import { useCallback, useEffect, useRef } from 'react'

const TICK_MS = 15_000
// A longer gap between ticks means the device slept or the timer was throttled;
// that time was not spent watching.
const MAX_TICK_GAP_MS = TICK_MS * 2

export type WatcherUpdateReason = 'tick' | 'hidden' | 'stop'

interface PlaybackWatcherOptions {
  // The player is showing and playing this title.
  active: boolean
  // Identifies what is playing; a new key restarts the count from initialSeconds.
  sessionKey: string
  // Watch time already recorded for this title.
  initialSeconds: number
  // Called every tick while counting, and when counting stops ('hidden' when the
  // page is hidden or closed, 'stop' when playback stops or the title changes).
  onUpdate: (watchSeconds: number, reason: WatcherUpdateReason) => void
}

// Counts how long a title has actually been watched: time only accrues while the
// player is active and the page is visible, using real elapsed time rather than
// tick counts so throttled timers can't inflate it.
export function usePlaybackWatcher({ active, sessionKey, initialSeconds, onUpdate }: PlaybackWatcherOptions) {
  const onUpdateRef = useRef(onUpdate)
  const initialSecondsRef = useRef(initialSeconds)
  const secondsRef = useRef(initialSeconds)
  const reportedSecondsRef = useRef<number | null>(null)

  useEffect(() => {
    onUpdateRef.current = onUpdate
    // Adopt watch time that changed elsewhere (another device's history arrived,
    // or the title was unmarked) rather than overwriting it with a stale count.
    if (initialSeconds !== initialSecondsRef.current && initialSeconds !== reportedSecondsRef.current) {
      secondsRef.current = initialSeconds
    }
    initialSecondsRef.current = initialSeconds
  }, [initialSeconds, onUpdate])

  useEffect(() => {
    secondsRef.current = initialSecondsRef.current
  }, [sessionKey])

  useEffect(() => {
    if (!active) return
    const isVisible = () => document.visibilityState === 'visible'
    let last: number | null = isVisible() ? performance.now() : null

    const report = (reason: WatcherUpdateReason) => {
      reportedSecondsRef.current = secondsRef.current
      onUpdateRef.current(secondsRef.current, reason)
    }
    const accrue = () => {
      const now = performance.now()
      if (last !== null) secondsRef.current += Math.min(now - last, MAX_TICK_GAP_MS) / 1000
      last = isVisible() ? now : null
    }
    const onTick = () => {
      if (last === null && !isVisible()) return
      accrue()
      report('tick')
    }
    const onVisibilityChange = () => {
      accrue()
      if (!isVisible()) report('hidden')
    }
    const onPageHide = () => {
      accrue()
      report('hidden')
    }

    const interval = window.setInterval(onTick, TICK_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('pagehide', onPageHide)
      accrue()
      // Runs before the next render's effects, so this still reports to the
      // callback for the title that was playing.
      report('stop')
    }
  }, [active, sessionKey])

  // Watch time as of the last tick.
  return useCallback(() => secondsRef.current, [])
}
