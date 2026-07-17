import { Heart } from 'lucide-react'
import { Link } from 'react-router'
import { MediaCard } from '../components/media/MediaCard'
import { useFavourites } from '../hooks/useFavourites'

export function FavouritesPage() {
  const { favourites, loading, error } = useFavourites()

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
      <header className="max-w-2xl">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-400">Synced to your account</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-5xl">Your favourites</h1>
        <p className="mt-4 leading-7 text-zinc-400">Your picks follow you securely across your signed-in devices.</p>
      </header>

      {error && <p role="alert" className="mt-6 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200">{error}</p>}
      {loading ? (
        <p role="status" className="mt-12 text-center text-zinc-400">Loading your favourites…</p>
      ) : favourites.length === 0 ? (
        <div className="mx-auto mt-12 max-w-xl rounded-3xl border border-white/8 bg-white/4 p-8 text-center sm:p-10">
          <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-brand-500/12 text-brand-400"><Heart aria-hidden="true" /></span>
          <h2 className="mt-5 text-2xl font-black">No favourites yet</h2>
          <p className="mt-3 leading-7 text-zinc-400">Save any movie or TV show to build a personal shortlist of things to discover.</p>
          <Link to="/" className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-white px-5 font-black text-zinc-950 transition hover:bg-zinc-200">Explore titles</Link>
        </div>
      ) : (
        <div className="mt-9 grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-5 xl:grid-cols-6">
          {[...favourites].sort((a, b) => b.addedAt - a.addedAt).map((item) => <MediaCard key={`${item.mediaType}-${item.id}`} item={item} />)}
        </div>
      )}
    </div>
  )
}
