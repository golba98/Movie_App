import { LogOut, Shield } from 'lucide-react'
import { Link, NavLink } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from './Logo'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/movies', label: 'Movies' },
  { to: '/tv', label: 'TV Shows' },
  { to: '/search', label: 'Search' },
  { to: '/favourites', label: 'Saved' },
]

export function Header() {
  const { account, logout } = useAuth()

  return (
    <header className="sticky top-0 z-40 hidden border-b border-white/8 bg-black/70 backdrop-blur-2xl md:block">
      <div className="mx-auto flex min-h-16 max-w-7xl items-center justify-between gap-5 px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main navigation" className="flex items-center gap-6">
          {links.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `border-b-2 py-5 text-sm transition-colors ${
                  isActive
                    ? 'border-[#f5f5f5] text-[#f5f5f5]'
                    : 'border-transparent text-[#999999] hover:text-[#f5f5f5]'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link to="/admin" aria-label="Open administrator console" className="grid size-11 place-items-center rounded-full text-zinc-500 transition hover:bg-white/8 hover:text-white"><Shield size={17} aria-hidden="true" /></Link>
          <span className="max-w-36 truncate text-sm text-zinc-300">{account?.displayName}</span>
          <button type="button" onClick={() => void logout()} aria-label="Sign out" className="grid size-11 place-items-center rounded-full text-zinc-500 transition hover:bg-white/8 hover:text-white"><LogOut size={17} aria-hidden="true" /></button>
        </div>
      </div>
    </header>
  )
}
