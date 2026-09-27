import { useEffect, useRef } from 'react'
import Lenis from 'lenis'

export function useLenisScroll() {
  const lenisRef = useRef<Lenis | null>(null)

  useEffect(() => {
    // Honor accessibility preferences: skip smooth scrolling if user prefers reduced motion
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReducedMotion) {
      return
    }

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

    // Watch document.body for overflow changes (e.g. modals locking scroll)
    const observer = new MutationObserver(() => {
      if (document.body.style.overflow === 'hidden') {
        lenis.stop()
      } else {
        lenis.start()
      }
    })

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['style'],
    })

    return () => {
      observer.disconnect()
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  return lenisRef
}
