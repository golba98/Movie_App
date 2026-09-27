import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Video } from '../../types/tmdb'

export function TrailerModal({
  trailer,
  onClose,
}: {
  trailer: Video | null
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!trailer) return
    const dialog = dialogRef.current
    if (!dialog) return

    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    closeButtonRef.current?.focus()

    return () => {
      document.body.style.overflow = previousOverflow
      if (dialog.open) dialog.close()
      window.requestAnimationFrame(() => {
        if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus()
      })
    }
  }, [trailer])

  if (!trailer) return null

  return (
    <dialog
      ref={dialogRef}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      className="m-auto w-[calc(100%-1.5rem)] max-w-4xl overflow-visible rounded-2xl border border-white/10 bg-zinc-950 p-0 text-white shadow-2xl backdrop:bg-black/80 backdrop:backdrop-blur-sm sm:w-[calc(100%-3rem)]"
      aria-labelledby="trailer-title"
    >
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 sm:px-5">
        <h2 id="trailer-title" className="line-clamp-2 font-bold">{trailer.name || 'Official trailer'}</h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="grid size-11 shrink-0 place-items-center rounded-full bg-white/8 text-zinc-300 transition hover:bg-white/15 hover:text-white"
          aria-label="Close trailer"
        >
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="aspect-video w-full overflow-hidden rounded-b-2xl bg-black">
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(trailer.key)}?autoplay=0&rel=0`}
          title={trailer.name || 'Trailer'}
          className="size-full border-0"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
      </div>
    </dialog>
  )
}
