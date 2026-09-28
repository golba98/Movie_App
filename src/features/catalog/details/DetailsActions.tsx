import { Check, Heart, Play, Users } from 'lucide-react'
import type { ReactNode } from 'react'

const ACTION_BUTTON = 'inline-flex min-h-12 grow items-center justify-center gap-2 sm:grow-0 rounded-xl border px-5 font-black transition'
const NEUTRAL_ACTION = 'border-white/15 bg-white/7 text-white hover:bg-white/12'

function ActionButton({
  onClick,
  pressed,
  activeClassName,
  children,
}: {
  onClick: () => void
  pressed?: boolean
  activeClassName?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className={`${ACTION_BUTTON} ${pressed && activeClassName ? activeClassName : NEUTRAL_ACTION}`}
    >
      {children}
    </button>
  )
}

interface DetailsActionsProps {
  // null while sources are still loading.
  sourceCount: number | null
  playLabel: string
  onPlay: () => void
  onWatchParty?: () => void
  onTrailer?: () => void
  movieWatched?: boolean
  onToggleWatched?: () => void
  favourite: boolean
  onToggleFavourite: () => void
}

export function DetailsActions({
  sourceCount,
  playLabel,
  onPlay,
  onWatchParty,
  onTrailer,
  movieWatched,
  onToggleWatched,
  favourite,
  onToggleFavourite,
}: DetailsActionsProps) {
  const playable = sourceCount !== null && sourceCount > 0

  return (
    <div className="mt-7 flex flex-wrap justify-start gap-2 sm:gap-3">
      {sourceCount === null && (
        <span role="status" className="inline-flex min-h-12 basis-full items-center justify-center rounded-xl sm:basis-auto border border-white/10 bg-white/5 px-5 text-sm font-semibold text-zinc-400">
          Checking authorised playback…
        </span>
      )}
      {playable && (
        <button
          type="button"
          onClick={onPlay}
          className="inline-flex min-h-12 basis-full items-center justify-center gap-2 rounded-xl sm:basis-auto bg-brand-400 px-5 font-black text-zinc-950 transition hover:bg-brand-500"
        >
          <Play size={18} fill="currentColor" aria-hidden="true" />
          {playLabel}
        </button>
      )}
      {playable && onWatchParty && (
        <ActionButton onClick={onWatchParty}>
          <Users size={18} aria-hidden="true" />Watch with friends
        </ActionButton>
      )}
      {onTrailer && (
        <ActionButton onClick={onTrailer}>
          <Play size={18} fill="currentColor" aria-hidden="true" />Watch trailer
        </ActionButton>
      )}
      {onToggleWatched && (
        <ActionButton
          onClick={onToggleWatched}
          pressed={movieWatched}
          activeClassName="border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
        >
          <Check size={18} aria-hidden="true" />
          {movieWatched ? 'Watched' : 'Mark as watched'}
        </ActionButton>
      )}
      <ActionButton
        onClick={onToggleFavourite}
        pressed={favourite}
        activeClassName="border-brand-400/50 bg-brand-600 text-white"
      >
        <Heart size={18} fill={favourite ? 'currentColor' : 'none'} aria-hidden="true" />
        {favourite ? 'Remove favourite' : 'Add to favourites'}
      </ActionButton>
    </div>
  )
}
