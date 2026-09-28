function PosterPlaceholder() {
  return (
    <>
      <div className="aspect-[2/3] animate-pulse rounded-2xl bg-white/8" />
      <div className="mt-3 h-4 w-4/5 animate-pulse rounded bg-white/8" />
      <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-white/6" />
    </>
  )
}

/** Placeholder cards for a horizontal media row. */
export function CardSkeleton() {
  return (
    <>
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          className="w-[148px] shrink-0 sm:w-[168px] lg:w-[184px]"
          aria-hidden="true"
        >
          <PosterPlaceholder />
        </div>
      ))}
      <span className="sr-only" role="status">Loading titles…</span>
    </>
  )
}

/** Placeholder cards for a results grid. */
export function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: 10 }, (_, index) => (
        <div key={index} aria-hidden="true">
          <PosterPlaceholder />
        </div>
      ))}
      <span className="sr-only" role="status">Loading results…</span>
    </div>
  )
}
