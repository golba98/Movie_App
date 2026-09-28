import { Check, ChevronDown, Play } from 'lucide-react'
import { useState } from 'react'
import { imageUrl } from '../../../lib/images'
import type { EpisodeListing } from '../sources'

function SeasonPicker({
  seasons,
  activeSeason,
  onSelect,
}: {
  seasons: number[]
  activeSeason: number
  onSelect: (season: number) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-black text-white hover:bg-white/10"
      >
        Season {activeSeason}<ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 max-h-48 w-32 overflow-y-auto rounded-2xl border border-white/7 bg-zinc-950 py-1 shadow-2xl">
          {seasons.map((season) => (
            <button
              key={season}
              type="button"
              onClick={() => {
                onSelect(season)
                setOpen(false)
              }}
              className={`w-full px-3 py-2.5 text-left text-xs font-bold hover:bg-white/5 ${activeSeason === season ? 'bg-white/5 text-white' : 'text-zinc-400'}`}
            >
              Season {season}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function EpisodeItem({
  listing,
  selected,
  watched,
  onSelect,
  onToggleWatched,
}: {
  listing: EpisodeListing
  selected: boolean
  watched: boolean
  onSelect: () => void
  onToggleWatched: () => void
}) {
  const { source, episode, episodeNumber } = listing
  const stillUrl = imageUrl(episode?.still_path, 'w185')

  return (
    <div
      className={`flex w-full items-start gap-1 rounded-2xl border p-2 text-left transition ${
        selected
          ? 'border-white/20 bg-white/10 text-white'
          : 'border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5 hover:text-white'
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="flex flex-1 items-start gap-3 min-w-0 text-left outline-none"
      >
        <span className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-xl bg-zinc-900">
          {stillUrl ? (
            <img src={stillUrl} alt="" className="size-full object-cover" loading="lazy" />
          ) : (
            <span className="grid size-full place-items-center">
              <Play size={14} aria-hidden="true" />
            </span>
          )}
          <span className="absolute bottom-1 right-1 rounded bg-black/85 px-1.5 py-0.5 text-[8px] font-black text-zinc-200">
            EP {episodeNumber}
          </span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-1 block text-xs font-black">{episode?.name || source.label}</span>
          <span className="mt-1 line-clamp-2 block text-[9px] leading-relaxed text-zinc-500">
            {episode?.overview || 'Authorised episode available.'}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onToggleWatched}
        className={`shrink-0 rounded-full p-2.5 transition active:scale-95 ${
          watched ? 'text-brand-400 hover:bg-brand-500/10' : 'text-zinc-600 hover:text-zinc-400 hover:bg-white/5'
        }`}
        title={watched ? 'Mark as unwatched' : 'Mark as watched'}
      >
        <Check size={14} className={watched ? 'stroke-[3px]' : 'stroke-[2px]'} />
      </button>
    </div>
  )
}

interface EpisodeSidebarProps {
  seasonCount: number
  seasons: number[]
  activeSeason: number
  listings: EpisodeListing[]
  activeSourceId: string
  loading: boolean
  error: string | null
  isWatched: (episodeNumber: number) => boolean
  onSelectSeason: (season: number) => void
  onSelectEpisode: (episodeNumber: number) => void
  onToggleWatched: (episodeNumber: number) => void
}

export function EpisodeSidebar({
  seasonCount,
  seasons,
  activeSeason,
  listings,
  activeSourceId,
  loading,
  error,
  isWatched,
  onSelectSeason,
  onSelectEpisode,
  onToggleWatched,
}: EpisodeSidebarProps) {
  const watchedCount = listings.filter(({ episodeNumber }) => isWatched(episodeNumber)).length

  return (
    <aside className="flex flex-col rounded-3xl border border-white/7 bg-white/[0.025] p-4" aria-labelledby="episodes-heading">
      <div className="mb-3 flex items-center justify-between gap-3 border-b border-white/7 pb-3">
        <div className="min-w-0">
          <h3 id="episodes-heading" className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-white">
            <Play size={12} className="fill-current" aria-hidden="true" />Authorised episodes
          </h3>
          <div className="mt-1 flex flex-col gap-1">
            <p className="text-[10px] text-zinc-500">{seasonCount} catalog season(s)</p>
            <p className="text-[10px] text-brand-400 font-bold">{watchedCount} / {listings.length} watched</p>
            {listings.length > 0 && (
              <div className="h-1 w-24 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-brand-400 transition-all duration-300"
                  style={{ width: `${(watchedCount / listings.length) * 100}%` }}
                />
              </div>
            )}
          </div>
        </div>
        <SeasonPicker seasons={seasons} activeSeason={activeSeason} onSelect={onSelectSeason} />
      </div>

      <div data-lenis-prevent className="max-h-[500px] flex-1 space-y-2 overflow-y-auto pr-1 scrollbar-subtle">
        {loading && <p role="status" className="py-6 text-center text-xs text-zinc-500">Loading episode details…</p>}
        {error && <p className="rounded-xl bg-amber-300/5 px-3 py-2 text-xs text-amber-100">{error}</p>}
        {listings.map((listing) => (
          <EpisodeItem
            key={listing.source.id}
            listing={listing}
            selected={listing.source.id === activeSourceId}
            watched={isWatched(listing.episodeNumber)}
            onSelect={() => onSelectEpisode(listing.episodeNumber)}
            onToggleWatched={() => onToggleWatched(listing.episodeNumber)}
          />
        ))}
      </div>
    </aside>
  )
}
