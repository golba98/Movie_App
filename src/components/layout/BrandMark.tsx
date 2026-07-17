type BrandMarkProps = {
  className?: string
}

/** The "F Movies" wordmark. Sizes off the inherited font size, so callers set it with a text-* class. */
export function BrandMark({ className = '' }: BrandMarkProps) {
  return (
    <span className={`inline-flex items-baseline gap-[0.24em] tracking-tight ${className}`}>
      <span className="text-[1.75em] font-semibold leading-[0.8]">F</span>
      <span className="font-medium">Movies</span>
    </span>
  )
}
