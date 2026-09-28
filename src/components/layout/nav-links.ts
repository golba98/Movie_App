import { Film, Heart, Home, Search, Tv, type LucideIcon } from 'lucide-react'

interface NavLinkItem {
  to: string
  label: string
  // The bottom tab bar has less room.
  shortLabel: string
  icon: LucideIcon
  end?: boolean
  // Solid icons read better than outlines for these when active.
  fillWhenActive?: boolean
}

export const NAV_LINKS: NavLinkItem[] = [
  { to: '/', label: 'Home', shortLabel: 'Home', icon: Home, end: true, fillWhenActive: true },
  { to: '/movies', label: 'Movies', shortLabel: 'Movies', icon: Film },
  { to: '/tv', label: 'TV Shows', shortLabel: 'TV', icon: Tv },
  { to: '/search', label: 'Search', shortLabel: 'Search', icon: Search },
  { to: '/favourites', label: 'Saved', shortLabel: 'Saved', icon: Heart, fillWhenActive: true },
]
