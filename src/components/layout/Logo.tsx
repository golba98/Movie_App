import { Link } from 'react-router'
import { BrandMark } from './BrandMark'

export function Logo() {
  return (
    <Link
      to="/"
      className="inline-flex items-center gap-2 rounded text-[15px] font-semibold tracking-tight text-[#f5f5f5] transition-colors hover:text-white"
      aria-label="Fedora Movies home"
    >
      <BrandMark className="size-6 rounded-[0.4rem]" />
      Fedora Movies
    </Link>
  )
}
