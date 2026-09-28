import { useEffect, type RefObject } from 'react'

/**
 * While theater mode is open: locks page scroll, closes on Escape, moves
 * focus to the exit button, and returns focus where it was on close.
 */
export function useTheaterMode(
  open: boolean,
  onClose: () => void,
  exitButtonRef: RefObject<HTMLButtonElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    exitButtonRef.current?.focus()
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [open, onClose, exitButtonRef])
}
