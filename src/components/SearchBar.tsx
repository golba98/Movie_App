import { Search, X } from 'lucide-react'
import { useRef } from 'react'

export function SearchBar({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="relative">
      <Search
        size={20}
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500"
        aria-hidden="true"
      />
      <label htmlFor="media-search" className="sr-only">Search movies and TV shows</label>
      <input
        ref={inputRef}
        id="media-search"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search movies and TV shows"
        autoComplete="off"
        enterKeyHint="search"
        className="min-h-14 w-full rounded-2xl border border-white/10 bg-white/6 py-3 pl-12 pr-12 text-base text-white shadow-xl shadow-black/10 transition placeholder:text-zinc-500 hover:border-white/20 focus:border-brand-400 focus:bg-white/8 focus:outline-none sm:min-h-16 sm:text-lg"
      />
      {value && (
        <button
          type="button"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-xl text-zinc-400 transition hover:bg-white/8 hover:text-white"
          aria-label="Clear search"
        >
          <X size={20} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
