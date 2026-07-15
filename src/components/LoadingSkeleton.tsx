export function CardSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="w-[148px] shrink-0 sm:w-[168px] lg:w-[184px]"
          aria-hidden="true"
        >
          <div className="aspect-[2/3] animate-pulse rounded-2xl bg-white/8" />
          <div className="mt-3 h-4 w-4/5 animate-pulse rounded bg-white/8" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-white/6" />
        </div>
      ))}
      <span className="sr-only" role="status">Loading titles…</span>
    </>
  )
}

export function GridSkeleton({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-5 xl:grid-cols-6">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} aria-hidden="true">
          <div className="aspect-[2/3] animate-pulse rounded-2xl bg-white/8" />
          <div className="mt-3 h-4 w-4/5 animate-pulse rounded bg-white/8" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-white/6" />
        </div>
      ))}
      <span className="sr-only" role="status">Loading results…</span>
    </div>
  )
}

export function DetailsSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8" aria-label="Loading details">
      <div className="h-[32vh] animate-pulse rounded-3xl bg-white/8 sm:h-[44vh]" />
      <div className="mx-auto -mt-16 grid max-w-5xl gap-7 px-4 md:grid-cols-[240px_1fr]">
        <div className="aspect-[2/3] animate-pulse rounded-2xl bg-zinc-800" />
        <div className="pt-16">
          <div className="h-9 w-2/3 animate-pulse rounded bg-white/8" />
          <div className="mt-5 h-24 animate-pulse rounded bg-white/6" />
        </div>
      </div>
      <span className="sr-only" role="status">Loading details…</span>
    </div>
  )
}
