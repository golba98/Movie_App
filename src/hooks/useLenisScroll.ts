import Lenis from 'lenis'
import { useEffect, useRef } from 'react'

/**
 * Smooth wheel scrolling for the page. Skipped for reduced motion, and paused
 * whenever something locks the body's overflow (modals, theater mode).
 */
export function useLenisScroll() {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    // lerp follows the wheel closely instead of gliding on a fixed 1s+ easing
    // curve. Touch stays native (syncTouch is off), which is smoothest on phones.
    const lenis = new Lenis({
      lerp: 0.12,
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      autoRaf: true,
    })

    lenisRef.current = lenis

    const observer = new MutationObserver(() => {
      if (document.body.style.overflow === 'hidden') lenis.stop()
      else lenis.start()
    })
    observer.observe(document.body, { attributes: true, attributeFilter: ['style'] })

    return () => {
      observer.disconnect()
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  return lenisRef
}
