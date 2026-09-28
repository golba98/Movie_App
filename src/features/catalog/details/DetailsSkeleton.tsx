// Mirrors the loaded details layout (header, poster grid, player and rows), so
// crossfading from skeleton to content shifts nothing.
export function DetailsSkeleton({ mediaType }: { mediaType: 'movie' | 'tv' }) {
  return (
    <div className="min-w-0 pb-14 sm:pb-20 animate-pulse motion-reduce:animate-none">
      <header className="relative min-h-[260px] overflow-hidden sm:min-h-[390px] lg:min-h-[470px] short:min-h-[220px] bg-zinc-900/50">
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-black/20" />
      </header>

      <div className="mx-auto -mt-24 max-w-7xl px-4 sm:-mt-32 sm:px-6 lg:px-8">
        <div className="relative grid min-w-0 gap-7 md:grid-cols-[220px_minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10">
          <div className="mx-auto aspect-[2/3] w-40 overflow-hidden rounded-2xl bg-zinc-900/80 shadow-2xl shadow-black/50 ring-1 ring-white/5 sm:w-52 md:mx-0 md:w-full" />

          <div className="min-w-0 pt-0 text-left md:pt-14 space-y-4">
            <div className="inline-flex h-6 w-20 rounded-full bg-brand-500/10" />
            <div className="mt-3 h-10 w-3/4 rounded-xl bg-zinc-900/80 md:w-1/2" />
            <div className="mt-4 flex flex-wrap justify-start gap-x-5 gap-y-2">
              <div className="h-4 w-20 rounded bg-zinc-900/80" />
              <div className="h-4 w-24 rounded bg-zinc-900/80" />
              <div className="h-4 w-16 rounded bg-zinc-900/80" />
            </div>
            <div className="mt-5 flex flex-wrap justify-start gap-2">
              <div className="h-6 w-16 rounded-full bg-zinc-900/60" />
              <div className="h-6 w-20 rounded-full bg-zinc-900/60" />
              <div className="h-6 w-14 rounded-full bg-zinc-900/60" />
            </div>
            <div className="mt-6 space-y-2 max-w-3xl">
              <div className="h-4 w-full rounded bg-zinc-900/70" />
              <div className="h-4 w-11/12 rounded bg-zinc-900/70" />
              <div className="h-4 w-4/5 rounded bg-zinc-900/70" />
            </div>
            {mediaType === 'movie' && <div className="mt-4 h-4 w-48 rounded bg-zinc-900/60" />}
            <div className="mt-7 flex flex-wrap justify-start gap-3">
              <div className="h-12 w-32 rounded-xl bg-zinc-900/80" />
              <div className="h-12 w-28 rounded-xl bg-zinc-900/80" />
              <div className="h-12 w-36 rounded-xl bg-zinc-900/80" />
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-14 max-w-7xl space-y-14 px-4 sm:px-6 lg:px-8">
        <section className="scroll-mt-20 rounded-3xl border border-white/5 bg-white/[0.01] p-5 sm:p-7">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-700">Video player</p>
          <h2 className="mt-1 text-xl font-black text-zinc-800">Checking playback availability…</h2>
          <div className="mt-4 aspect-video rounded-2xl bg-zinc-900/50 ring-1 ring-white/5" />
        </section>
        <section className="space-y-4">
          <div className="h-6 w-32 rounded bg-zinc-900/80" />
          <div className="flex gap-4 overflow-hidden">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex flex-col items-center gap-2">
                <div className="size-20 rounded-full bg-zinc-900/80" />
                <div className="h-3 w-16 rounded bg-zinc-900/60" />
              </div>
            ))}
          </div>
        </section>
      </div>
      <div className="mt-14 space-y-4">
        <div className="h-6 w-40 rounded bg-zinc-900/80 px-4 ml-8" />
        <div className="flex gap-4 overflow-hidden px-8">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="aspect-[2/3] w-28 rounded-2xl bg-zinc-900/80 shrink-0" />
          ))}
        </div>
      </div>
    </div>
  )
}
