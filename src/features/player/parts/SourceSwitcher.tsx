import type { MediaSource } from '../../../types/media-source'
import { getSourceLabel } from '../sources'

interface SourceSwitcherProps {
  sources: MediaSource[]
  activeSourceId: string
  onSelect: (sourceId: string) => void
}

export function SourceSwitcher({ sources, activeSourceId, onSelect }: SourceSwitcherProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 px-1">
      <span className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500 mr-1">Source Server:</span>
      {sources.map((source) => (
        <button
          key={source.id}
          type="button"
          onClick={() => onSelect(source.id)}
          aria-pressed={activeSourceId === source.id}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition duration-200 active:scale-95 pointer-coarse:min-h-11 ${
            activeSourceId === source.id
              ? 'bg-brand-400 border border-brand-400 text-ink-950 shadow-md shadow-brand-400/10'
              : 'bg-white/5 border border-white/5 text-zinc-400 hover:bg-white/10 hover:border-white/10 hover:text-zinc-200'
          }`}
        >
          {getSourceLabel(source)}
        </button>
      ))}
    </div>
  )
}
