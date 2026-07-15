import { Link } from 'react-router'

export function Logo() {
  return (
    <Link
      to="/"
      className="inline-flex items-center rounded text-[15px] font-semibold tracking-tight text-[#f5f5f5] transition-colors hover:text-white"
      aria-label="CineScope home"
    >
      CineScope
    </Link>
  )
}
