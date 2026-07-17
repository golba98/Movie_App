import { Film, Heart, Home, LogOut, Search, Tv } from 'lucide-react'
import { NavLink } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { Logo } from './Logo'

const links = [
  { to: '/', label: 'Home', end: true, icon: Home },
  { to: '/movies', label: 'Movies', icon: Film },
  { to: '/tv', label: 'TV', icon: Tv },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/favourites', label: 'Saved', icon: Heart },
]

export function MobileNavigation() {
  const { account, logout } = useAuth()

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-white/8 bg-black/75 backdrop-blur-2xl md:hidden">
        <div className="flex min-h-14 items-center justify-between gap-3 px-4 pt-safe">
          <Logo />
          <div className="flex items-center gap-1">
            <span className="grid size-9 place-items-center rounded-full bg-white/10 text-sm font-semibold" aria-label={`Signed in as ${account?.displayName ?? 'viewer'}`}>{account?.displayName?.charAt(0).toUpperCase()}</span>
            <button type="button" onClick={() => void logout()} aria-label="Sign out" className="grid size-11 place-items-center rounded-full text-zinc-400"><LogOut size={18} aria-hidden="true" /></button>
          </div>
        </div>
      </header>
      <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-50 border-t border-white/10 bg-black/80 px-2 pb-safe backdrop-blur-2xl md:hidden">
        <div className="mx-auto grid max-w-lg grid-cols-5">
          {links.map(({ to, label, end, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition ${isActive ? 'text-white' : 'text-zinc-500'}`}
            >
              {({ isActive }) => <><Icon size={21} fill={isActive && (label === 'Home' || label === 'Saved') ? 'currentColor' : 'none'} aria-hidden="true" /><span>{label}</span></>}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}
