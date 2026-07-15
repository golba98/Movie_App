import { useEffect, useId, useState } from 'react'
import { NavLink, useLocation } from 'react-router'
import { Logo } from './Logo'

const links = [
  { to: '/', label: 'Home', end: true },
  { to: '/movies', label: 'Movies' },
  { to: '/tv', label: 'TV Shows' },
  { to: '/search', label: 'Search' },
  { to: '/favourites', label: 'Favourites' },
]

export function MobileNavigation() {
  const [open, setOpen] = useState(false)
  const location = useLocation()
  const panelId = useId()

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  return (
    <header className="sticky top-0 z-40 border-b border-[#262626] bg-[#0a0a0a] md:hidden">
      <div className="flex h-14 items-center justify-between px-4">
        <Logo />
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={panelId}
          className="rounded px-2 py-1 text-sm text-[#999999] transition-colors hover:text-[#f5f5f5]"
        >
          {open ? 'Close' : 'Menu'}
        </button>
      </div>
      {open && (
        <nav
          id={panelId}
          aria-label="Mobile navigation"
          className="border-t border-[#262626] px-4 py-2"
        >
          {links.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `block rounded px-1 py-2.5 text-sm transition-colors ${
                  isActive ? 'text-[#f5f5f5]' : 'text-[#999999] hover:text-[#f5f5f5]'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  )
}
