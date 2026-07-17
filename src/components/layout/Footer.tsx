import { Link } from 'react-router'
import { BrandMark } from './BrandMark'

export function Footer() {
  return (
    <footer className="border-t border-[#262626] bg-[#070709]/40 backdrop-blur-md">
      <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8">
        <div className="grid grid-cols-1 gap-8 border-b border-[#262626] pb-8 md:grid-cols-4">
          <div className="space-y-4 md:col-span-2">
            <BrandMark className="text-xl" />
            <p className="max-w-md text-sm leading-relaxed text-zinc-400">
              Your ultimate private movie and TV library. Explore curated titles, keep track of your favourites, and enjoy high-fidelity, ad-free playback.
            </p>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-zinc-300">Browse</h4>
            <ul className="space-y-2.5">
              <li>
                <Link to="/" className="text-sm text-zinc-400 transition hover:text-white">Home</Link>
              </li>
              <li>
                <Link to="/movies" className="text-sm text-zinc-400 transition hover:text-white">Movies</Link>
              </li>
              <li>
                <Link to="/tv" className="text-sm text-zinc-400 transition hover:text-white">TV Shows</Link>
              </li>
              <li>
                <Link to="/favourites" className="text-sm text-zinc-400 transition hover:text-white">Favourites</Link>
              </li>
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-zinc-300">System</h4>
            <ul className="space-y-2.5">
              <li>
                <Link to="/capture-test" className="text-sm text-zinc-400 transition hover:text-white">Diagnostics</Link>
              </li>
            </ul>
          </div>
        </div>
        <div className="flex flex-col items-center justify-between gap-4 pt-8 md:flex-row">
          <p className="text-xs text-zinc-400">
            &copy; {new Date().getFullYear()} Fedora Movies. All rights reserved.
          </p>
          <p className="max-w-md text-center text-xs leading-relaxed text-zinc-400 md:text-right">
            This product uses the{' '}
            <a
              href="https://www.themoviedb.org"
              target="_blank"
              rel="noreferrer"
              className="font-semibold text-zinc-400 transition hover:text-zinc-200 hover:underline"
            >
              TMDB API
            </a>{' '}
            but is not endorsed or certified by TMDB.
          </p>
        </div>
      </div>
    </footer>
  )
}

