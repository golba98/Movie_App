import { useRef, useEffect } from 'react'

export function useDragScroll() {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return

    let isDown = false
    let startX = 0
    let scrollLeft = 0
    let hasDragged = false

    const onMouseDown = (e: MouseEvent) => {
      isDown = true
      hasDragged = false
      element.classList.add('cursor-grabbing')
      element.classList.remove('cursor-grab')
      startX = e.pageX - element.offsetLeft
      scrollLeft = element.scrollLeft
    }

    const onMouseLeave = () => {
      if (isDown) {
        isDown = false
        element.classList.remove('cursor-grabbing')
        element.classList.add('cursor-grab')
      }
    }

    const onMouseUp = () => {
      if (isDown) {
        isDown = false
        element.classList.remove('cursor-grabbing')
        element.classList.add('cursor-grab')
      }
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!isDown) return
      e.preventDefault()
      const x = e.pageX - element.offsetLeft
      const walk = (x - startX) * 1.5
      if (Math.abs(walk) > 5) {
        hasDragged = true
      }
      element.scrollLeft = scrollLeft - walk
    }

    const onClickCapture = (e: MouseEvent) => {
      if (hasDragged) {
        e.preventDefault()
        e.stopPropagation()
      }
    }

    element.classList.add('cursor-grab')
    element.addEventListener('mousedown', onMouseDown)
    element.addEventListener('mouseleave', onMouseLeave)
    element.addEventListener('mouseup', onMouseUp)
    element.addEventListener('mousemove', onMouseMove)
    element.addEventListener('click', onClickCapture, true)

    return () => {
      element.removeEventListener('mousedown', onMouseDown)
      element.removeEventListener('mouseleave', onMouseLeave)
      element.removeEventListener('mouseup', onMouseUp)
      element.removeEventListener('mousemove', onMouseMove)
      element.removeEventListener('click', onClickCapture, true)
    }
  }, [])

  return ref
}
