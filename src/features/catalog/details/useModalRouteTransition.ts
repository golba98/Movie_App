import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

// Matches the panel's fade-out, so navigation happens once it has finished.
const CLOSE_DELAY_MS = 200

/**
 * Enter/exit animation, scroll lock and Escape handling for a route rendered
 * as a modal. Escape is ignored while `escapeDisabled` is set, e.g. while a
 * nested player owns the key.
 */
export function useModalRouteTransition(escapeDisabled: boolean) {
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  useEffect(() => {
    setMounted(true)
  }, [])

  const close = useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      // Opened over another page: go back to it. Opened directly: go home.
      if (window.history.state?.usr?.backgroundLocation) navigate(-1)
      else navigate('/')
    }, CLOSE_DELAY_MS)
  }, [navigate])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !escapeDisabled) close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close, escapeDisabled])

  return { visible: mounted && !closing, close }
}
