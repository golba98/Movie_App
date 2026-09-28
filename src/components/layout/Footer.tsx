import { Link } from 'react-router'
import { BrandMark } from './BrandMark'

const BROWSE_LINKS = [
  { to: '/', label: 'Home' },
  { to: '/movies', label: 'Movies' },
  { to: '/tv', label: 'TV Shows' },
  { to: '/favourites', label: 'Favourites' },
]

function FooterLink({ to, children }: { to: string; children: string }) {
  return (
    <li>
      <Link to={to} className="text-sm text-zinc-400 transition hover:text-white">{children}</Link>
    </li>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-[#262626] bg-canvas/40">
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
              {BROWSE_LINKS.map(({ to, label }) => <FooterLink key={to} to={to}>{label}</FooterLink>)}
            </ul>
          </div>
          <div>
            <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-zinc-300">System</h4>
            <ul className="space-y-2.5">
              <FooterLink to="/capture-test">Diagnostics</FooterLink>
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

