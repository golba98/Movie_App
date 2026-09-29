import { useEffect, type RefObject } from 'react'
import { lockPageScroll } from '../../../lib/scroll-lock'

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
    const unlockScroll = lockPageScroll()
    window.addEventListener('keydown', onKeyDown)
    exitButtonRef.current?.focus()
    return () => {
      unlockScroll()
      window.removeEventListener('keydown', onKeyDown)
      if (returnFocus?.isConnected) returnFocus.focus()
    }
  }, [open, onClose, exitButtonRef])
}
