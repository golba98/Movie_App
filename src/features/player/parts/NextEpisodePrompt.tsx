import { Play, X } from 'lucide-react'

interface NextEpisodePromptProps {
  label: string
  episodeName?: string
  // Theater mode puts the exit and reload buttons in the player's top-right corner.
  theater: boolean
  onWatch: () => void
  onDismiss: () => void
}

// Floats on the right once an episode has ended, above the provider's
// subtitles and controls. Phones show a short player, so it sits in the top
// corner there, below the theater buttons in theater mode.
export function NextEpisodePrompt({ label, episodeName, theater, onWatch, onDismiss }: NextEpisodePromptProps) {
  return (
    <div className={`absolute right-3 z-20 sm:right-4 sm:top-1/4 ${theater ? 'top-[4.5rem]' : 'top-3'} flex max-w-[calc(100%-2rem)] items-center gap-1 rounded-full bg-black/80 p-1 shadow-2xl ring-1 ring-white/15 backdrop-blur`}>
      <button
        type="button"
        onClick={onWatch}
        className="flex min-h-10 min-w-0 items-center gap-2 rounded-full bg-white py-2 pl-3 pr-4 text-sm font-black text-black transition hover:bg-zinc-200"
      >
        <Play size={15} className="shrink-0 fill-current" aria-hidden="true" />
        <span className="truncate">
          Watch next · {label}
          {episodeName && <span className="hidden font-semibold text-zinc-600 sm:inline"> — {episodeName}</span>}
        </span>
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="grid size-10 shrink-0 place-items-center rounded-full text-zinc-300 transition hover:bg-white/10 hover:text-white"
        aria-label="Dismiss next episode"
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
