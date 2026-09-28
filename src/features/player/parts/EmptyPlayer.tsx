import { Info } from 'lucide-react'

export function EmptyPlayer() {
  return (
    <section id="streaming-player" aria-labelledby="empty-player-heading" className="scroll-mt-20">
      <div className="mb-4 px-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">Video player</p>
        <h2 id="empty-player-heading" className="mt-1 text-lg font-black text-white">Authorised playback</h2>
      </div>
      <div className="relative grid place-items-center overflow-hidden rounded-2xl bg-black py-8 shadow-2xl ring-1 ring-white/10 sm:aspect-video sm:py-0">
        <div className="max-w-lg px-6 text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-full border border-amber-300/20 bg-amber-300/10 text-amber-200">
            <Info aria-hidden="true" />
          </span>
          <h3 className="mt-4 text-lg font-semibold text-white">No authorised source is available</h3>
          <p className="mt-2 text-sm leading-6 text-zinc-400">An administrator can add an owned or licensed MP4 or WebM source for this title.</p>
        </div>
      </div>
      <p className="mt-4 rounded-2xl border border-white/7 bg-white/[0.025] p-4 text-xs leading-5 text-zinc-500">
        The player remains visible so playback availability is clear. It will never load an unapproved third-party stream automatically.
      </p>
    </section>
  )
}
