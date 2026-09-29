import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { lockPageScroll } from '../../../lib/scroll-lock'

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
  // The entry being closed. The modal stays mounted when closing returns to an
  // earlier title (one opened from another's Similar row), which must show again.
  const [closingKey, setClosingKey] = useState<string | null>(null)
  const closing = closingKey === location.key
  const closeTimerRef = useRef<number | null>(null)
  // Opened over another page (a link passed its location as the background).
  const openedOverPage = Boolean((location.state as { backgroundLocation?: unknown } | null)?.backgroundLocation)

  useEffect(() => lockPageScroll(), [])

  useEffect(() => {
    setMounted(true)
  }, [])

  // A new entry (another title, or Back during the fade) cancels a pending close.
  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = null
  }, [location.key])

  // Back to the page underneath, or home when the details URL was opened directly.
  const close = useCallback(() => {
    setClosingKey(location.key)
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null
      if (openedOverPage) navigate(-1)
      else navigate('/')
    }, CLOSE_DELAY_MS)
  }, [location.key, navigate, openedOverPage])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !escapeDisabled) close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, escapeDisabled])

  return { visible: mounted && !closing, close }
}
