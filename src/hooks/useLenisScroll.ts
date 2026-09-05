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

    const lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
    })

    lenisRef.current = lenis

    let rafId: number

    const raf = (time: number) => {
      lenis.raf(time)
      rafId = requestAnimationFrame(raf)
    }

    rafId = requestAnimationFrame(raf)

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
      cancelAnimationFrame(rafId)
      lenis.destroy()
      lenisRef.current = null
    }
  }, [])

  return lenisRef
}
