let holders = 0
let overflowBeforeLock = ''

/**
 * Locks page scroll until every holder has released it. Overlays can nest
 * (theater mode or a dialog inside the details modal) and unmount in any
 * order, so the page's own overflow is restored only by the last release.
 * Returns the release function; calling it more than once is harmless.
 */
export function lockPageScroll() {
  if (holders === 0) {
    overflowBeforeLock = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  }
  holders += 1

  let released = false
  return () => {
    if (released) return
    released = true
    holders -= 1
    if (holders === 0) document.body.style.overflow = overflowBeforeLock
  }
}
