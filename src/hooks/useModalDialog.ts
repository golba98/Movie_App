import { useEffect, type RefObject } from 'react'

/**
 * Opens a native <dialog> as a modal while `open` is set: locks page scroll,
 * focuses `initialFocusRef`, and on close restores scroll and returns focus
 * to whatever had it before.
 */
export function useModalDialog(
  open: boolean,
  dialogRef: RefObject<HTMLDialogElement | null>,
  initialFocusRef: RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (!open) return
    const dialog = dialogRef.current
    if (!dialog) return

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    initialFocusRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (dialog.open) dialog.close()
      window.requestAnimationFrame(() => {
        if (previousFocus?.isConnected) previousFocus.focus()
      })
    }
  }, [open, dialogRef, initialFocusRef])
}
