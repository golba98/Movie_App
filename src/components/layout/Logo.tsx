import { Link } from 'react-router'
import { BrandMark } from './BrandMark'

export function Logo() {
  return (
    <Link
      to="/"
      className="inline-flex items-center rounded text-[15px] text-[#f5f5f5] transition-colors hover:text-white"
      aria-label="Fedora Movies home"
    >
      <BrandMark />
    </Link>
  )
}
