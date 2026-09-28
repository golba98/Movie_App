import { Maximize2, RotateCw, X } from 'lucide-react'
import type { ReactNode } from 'react'

function ToolbarButton({ label, title, onClick, children }: { label: string; title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="grid size-10 place-items-center rounded-full bg-white/5 text-zinc-300 transition hover:bg-white/10 hover:text-white pointer-coarse:size-11"
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  )
}

interface PlayerToolbarProps {
  heading: string
  onReload?: () => void
  onStop?: () => void
  onTheater: () => void
}

export function PlayerToolbar({ heading, onReload, onStop, onTheater }: PlayerToolbarProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="min-w-0">
        <h2 id="player-heading" className="mt-1 line-clamp-1 text-lg font-black text-white">{heading}</h2>
      </div>
      <div className="flex items-center gap-2">
        {onReload && (
          <ToolbarButton label="Reload player" title="Stuck loading? Reload player" onClick={onReload}>
            <RotateCw size={17} aria-hidden="true" />
          </ToolbarButton>
        )}
        {onStop && (
          <ToolbarButton label="Stop player" title="Stop player" onClick={onStop}>
            <X size={17} aria-hidden="true" />
          </ToolbarButton>
        )}
        <ToolbarButton label="Theater mode" title="Theater mode" onClick={onTheater}>
          <Maximize2 size={17} aria-hidden="true" />
        </ToolbarButton>
      </div>
    </div>
  )
}
