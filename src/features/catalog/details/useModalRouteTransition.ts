import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'

// Matches the panel's fade-out, so navigation happens once it has finished.
const CLOSE_DELAY_MS = 200

/**
 * Enter/exit animation, scroll lock and Escape handling for a route rendered
 * as a modal. Escape is ignored while `escapeDisabled` is set, e.g. while a
 * nested player owns the key.
 */
export function useModalRouteTransition(escapeDisabled: boolean) {
  const navigate = useNavigate()
  const location = useLocation()
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimerRef = useRef<number | null>(null)
  // Opened over another page (a link passed its location as the background).
  const openedOverPage = Boolean((location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
      if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  // Back to the page underneath, or home when the details URL was opened directly.
  const close = useCallback(() => {
    setClosing(true)
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (openedOverPage) navigate(-1)
      else navigate('/')
    }, CLOSE_DELAY_MS)
  }, [navigate, openedOverPage])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !escapeDisabled) close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, escapeDisabled])

  return { visible: mounted && !closing, close }
}
