import type { MediaItem } from '../../types/tmdb'
import { MediaCard } from './MediaCard'
import { mediaKey } from './pagination'

export function MediaGrid({ items, className = '' }: { items: MediaItem[]; className?: string }) {
  return (
    <div className={`${className} grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6`.trim()}>
      {items.map((item) => <MediaCard key={mediaKey(item)} item={item} />)}
    </div>
  )
}

export function LoadMoreButton({ loading, label, onClick }: { loading: boolean; label: string; onClick: () => void }) {
  return (
    <div className="mt-10 flex justify-center">
      <button
        type="button"
        disabled={loading}
        onClick={onClick}
        className="min-h-12 rounded-xl bg-white px-6 font-black text-zinc-950 transition hover:bg-zinc-200 disabled:cursor-wait disabled:opacity-60"
      >
        {loading ? 'Loading…' : label}
      </button>
    </div>
  )
}
