import { NavLink } from 'react-router'
import { Logo } from './Logo'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/movies', label: 'Movies' },
  { to: '/tv', label: 'TV Shows' },
  { to: '/search', label: 'Search' },
  { to: '/favourites', label: 'Favourites' },
]

export function Header() {
  return (
    <header className="sticky top-0 z-40 hidden border-b border-[#262626] bg-[#0a0a0a] md:block">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main navigation" className="flex items-center gap-7">
          {links.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `border-b-2 py-0.5 text-sm transition-colors ${
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
      </div>
    </header>
  )
}
