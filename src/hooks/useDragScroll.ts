import { useRef, useEffect } from 'react'

export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let isDown = false
    let startX = 0
    let initialScrollLeft = 0
    let hasDragged = false
    let lastX = 0
    let lastTime = 0
    let velocity = 0
    let momentumRafId: number | null = null

    const stopMomentum = () => {
      if (momentumRafId !== null) {
        cancelAnimationFrame(momentumRafId)
        momentumRafId = null
      }
    }

    const onMouseDown = (e: MouseEvent) => {
      // Only drag on primary (left) mouse button
      if (e.button !== 0) return

      stopMomentum()
      isDown = true
      hasDragged = false
      startX = e.pageX
      lastX = e.pageX
      lastTime = performance.now()
      velocity = 0
      initialScrollLeft = element.scrollLeft

      // Temporarily remove snap to prevent the browser fighting JS scroll updates
      element.style.scrollSnapType = 'none'
      element.style.scrollBehavior = 'auto'
      element.classList.add('cursor-grabbing')
      element.classList.remove('cursor-grab')

      window.addEventListener('mousemove', onMouseMove, { passive: false })
      window.addEventListener('mouseup', onMouseUp)
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return

      const currentX = e.pageX
      const dx = currentX - startX

      if (Math.abs(dx) > 4) {
        hasDragged = true
      }

      if (hasDragged) {
        e.preventDefault()
      }

      const now = performance.now()
      const dt = now - lastTime
      if (dt > 0) {
        const currentVelocity = (currentX - lastX) / dt
        velocity = velocity * 0.3 + currentVelocity * 0.7
      }
      lastX = currentX
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

      if (hasDragged && Math.abs(velocity) > 0.15) {
        let currentVelocity = velocity * 16 // convert ms velocity to approx frame velocity
        const friction = 0.94
        const minVelocity = 0.5

        const stepMomentum = () => {
          if (Math.abs(currentVelocity) > minVelocity && element) {
            element.scrollLeft -= currentVelocity
            currentVelocity *= friction
            momentumRafId = requestAnimationFrame(stepMomentum)
          } else {
            stopMomentum()
            if (element) {
              element.style.scrollSnapType = ''
              element.style.scrollBehavior = ''
            }
          }
        }

        momentumRafId = requestAnimationFrame(stepMomentum)
      } else {
        element.style.scrollSnapType = ''
        element.style.scrollBehavior = ''
      }
    }

    const onClickCapture = (e: MouseEvent) => {
      if (hasDragged) {
        e.preventDefault()
        e.stopPropagation()
      }
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
      element.style.scrollSnapType = ''
      element.style.scrollBehavior = ''
    }
  }, [])

  return ref
}
