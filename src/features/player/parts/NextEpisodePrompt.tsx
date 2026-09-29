import { Play, X } from 'lucide-react'

interface NextEpisodePromptProps {
  label: string
  episodeName?: string
  onWatch: () => void
  onDismiss: () => void
}

// Floats above the provider's control bar once an episode is finished; on
// phones the player is short, so it sits in the top corner instead.
export function NextEpisodePrompt({ label, episodeName, onWatch, onDismiss }: NextEpisodePromptProps) {
  return (
    <div className="absolute right-3 top-3 z-20 sm:bottom-16 sm:right-4 sm:top-auto flex max-w-[calc(100%-2rem)] items-center gap-1 rounded-full bg-black/80 p-1 shadow-2xl ring-1 ring-white/15 backdrop-blur">
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
