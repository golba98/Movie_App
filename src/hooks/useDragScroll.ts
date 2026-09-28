import { useEffect, useRef } from 'react'

// Movement past this many pixels is a drag, so the click that ends it is swallowed.
const DRAG_THRESHOLD_PX = 4
// Weight given to the newest pointer sample when smoothing velocity.
const VELOCITY_SMOOTHING = 0.7
// Releases slower than this (px/ms) stop dead instead of gliding.
const MIN_FLING_VELOCITY = 0.15
const FRAME_MS = 16
const MOMENTUM_FRICTION = 0.94
const MIN_MOMENTUM_PX_PER_FRAME = 0.5

/**
 * Lets mouse users drag a horizontal scroller like a touch list, with a short
 * momentum glide on release. Touch and trackpads keep native scrolling.
 */
export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let isDown = false
    let hasDragged = false
    let startX = 0
    let initialScrollLeft = 0
    let lastX = 0
    let lastTime = 0
    let velocity = 0
    let momentumFrame: number | null = null

    // Snap and smooth scrolling fight scrollLeft updates, so they are paused while dragging.
    const pauseSnapping = () => {
      element.style.scrollSnapType = 'none'
      element.style.scrollBehavior = 'auto'
    }
    const resumeSnapping = () => {
      element.style.scrollSnapType = ''
      element.style.scrollBehavior = ''
    }

    const stopMomentum = () => {
      if (momentumFrame === null) return
      cancelAnimationFrame(momentumFrame)
      momentumFrame = null
    }

    const glide = () => {
      let frameVelocity = velocity * FRAME_MS
      const step = () => {
        if (Math.abs(frameVelocity) > MIN_MOMENTUM_PX_PER_FRAME) {
          element.scrollLeft -= frameVelocity
          frameVelocity *= MOMENTUM_FRICTION
          momentumFrame = requestAnimationFrame(step)
        } else {
          stopMomentum()
          resumeSnapping()
        }
      }
      momentumFrame = requestAnimationFrame(step)
    }

    const onMouseMove = (event: MouseEvent) => {
      if (!isDown) return
      const dx = event.pageX - startX
      if (Math.abs(dx) > DRAG_THRESHOLD_PX) hasDragged = true
      if (hasDragged) event.preventDefault()

      const now = performance.now()
      const dt = now - lastTime
      if (dt > 0) {
        const sample = (event.pageX - lastX) / dt
        velocity = velocity * (1 - VELOCITY_SMOOTHING) + sample * VELOCITY_SMOOTHING
      }
      lastX = event.pageX
      lastTime = now
      element.scrollLeft = initialScrollLeft - dx
    }

    const onMouseUp = () => {
      if (!isDown) return
      isDown = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      element.classList.remove('cursor-grabbing')
      element.classList.add('cursor-grab')

      if (hasDragged && Math.abs(velocity) > MIN_FLING_VELOCITY) glide()
      else resumeSnapping()
    }

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return
      stopMomentum()
      isDown = true
      hasDragged = false
      startX = event.pageX
      lastX = event.pageX
      lastTime = performance.now()
      velocity = 0
      initialScrollLeft = element.scrollLeft

      pauseSnapping()
      element.classList.add('cursor-grabbing')
      element.classList.remove('cursor-grab')
      window.addEventListener('mousemove', onMouseMove, { passive: false })
      window.addEventListener('mouseup', onMouseUp)
    }

    // A drag ends with a click on whatever card was under the pointer; ignore it.
    const onClickCapture = (event: MouseEvent) => {
      if (!hasDragged) return
      event.preventDefault()
      event.stopPropagation()
    }

    element.classList.add('cursor-grab')
    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('click', onClickCapture, true)

    return () => {
      stopMomentum()
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('click', onClickCapture, true)
      resumeSnapping()
    }
  }, [])

  return ref
}
