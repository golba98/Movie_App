type BrandMarkProps = {
  className?: string
}

/** The Fedora Movies hat mark. Mirrors public/favicon.svg — keep both in sync. */
export function BrandMark({ className = 'size-14' }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="14" fill="#ffffff" />
      <g fill="#000000">
        <path d="M20 37C20 22 23 16 27.5 16C30 16 31 19 32 19C33 19 34 16 36.5 16C41 16 44 22 44 37Z" />
        <ellipse cx="32" cy="38.5" rx="22" ry="5.5" />
      </g>
      <rect x="19" y="31.5" width="26" height="3" fill="#ffffff" />
    </svg>
  )
}
