import type { ReactNode } from 'react'

interface AdminDialogProps {
  labelledBy: string
  describedBy?: string
  onDismiss: () => void
  // Escape closes the dialog only when this is set.
  onEscape?: () => void
  children: ReactNode
}

/** A bottom sheet on phones and a centred card elsewhere; pressing the backdrop dismisses it. */
export function AdminDialog({ labelledBy, describedBy, onDismiss, onEscape, children }: AdminDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/75 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:place-items-center"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onDismiss()
      }}
      onKeyDown={onEscape && ((event) => {
        if (event.key === 'Escape') onEscape()
      })}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        className="glass-panel max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto overscroll-contain rounded-[2rem] p-6 sm:p-8 short:p-5"
      >
        {children}
      </section>
    </div>
  )
}
