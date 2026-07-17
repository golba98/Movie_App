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

// Geometry here must stay in lockstep with DetailsPage — every wrapper, offset and
// breakpoint is mirrored so swapping skeleton for content shifts nothing.
export function DetailsSkeleton() {
  return (
    <article className="min-w-0 pb-14 sm:pb-20" aria-label="Loading details">
      <header className="relative isolate min-h-[260px] overflow-hidden sm:min-h-[390px] lg:min-h-[470px]">
        <div className="absolute inset-0 -z-20 animate-pulse bg-white/6" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-black/20" />
      </header>

      <div className="mx-auto -mt-24 max-w-7xl px-4 sm:-mt-32 sm:px-6 lg:px-8">
        <div className="relative grid min-w-0 gap-7 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
          <div className="mx-auto aspect-[2/3] w-40 animate-pulse overflow-hidden rounded-2xl bg-zinc-800 shadow-2xl shadow-black/50 ring-1 ring-white/10 sm:w-52 md:mx-0 md:w-full" />

          <div className="min-w-0 pt-0 md:pt-14">
            <div className="mx-auto h-6 w-20 animate-pulse rounded-full bg-white/8 md:mx-0" />
            <div className="mx-auto mt-3 h-9 w-3/5 animate-pulse rounded bg-white/8 sm:h-12 md:mx-0" />
            <div className="mx-auto mt-4 h-5 w-72 max-w-full animate-pulse rounded bg-white/6 md:mx-0" />
            <div className="mx-auto mt-5 flex justify-center gap-2 md:mx-0 md:justify-start">
              <div className="h-6 w-16 animate-pulse rounded-full bg-white/6" />
              <div className="h-6 w-20 animate-pulse rounded-full bg-white/6" />
              <div className="h-6 w-14 animate-pulse rounded-full bg-white/6" />
            </div>
            <div className="mt-6 max-w-3xl space-y-2">
              <div className="h-4 w-full animate-pulse rounded bg-white/6" />
              <div className="h-4 w-full animate-pulse rounded bg-white/6" />
              <div className="h-4 w-4/5 animate-pulse rounded bg-white/6" />
            </div>
            <div className="mx-auto mt-7 flex flex-wrap justify-center gap-3 md:mx-0 md:justify-start">
              <div className="h-12 w-46 animate-pulse rounded-xl bg-white/8" />
              <div className="h-12 w-40 animate-pulse rounded-xl bg-white/6" />
              <div className="h-12 w-48 animate-pulse rounded-xl bg-white/6" />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-7xl space-y-14 px-4 sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-white/8 bg-white/[0.025] p-5 sm:p-7">
          <div className="h-3 w-24 animate-pulse rounded bg-white/6" />
          <div className="mt-2 h-6 w-64 max-w-full animate-pulse rounded bg-white/8" />
          <div className="mt-4 aspect-video animate-pulse rounded-2xl bg-black ring-1 ring-white/10" />
        </div>
      </div>

      <span className="sr-only" role="status">Loading details…</span>
    </article>
  )
}
