import { UserRound } from 'lucide-react'
import type { CastMember } from '../../types/tmdb'
import { profileUrl } from '../../utils/images'
import { useDragScroll } from '../../hooks/useDragScroll'

export function CastList({ cast }: { cast: CastMember[] }) {
  const scrollRef = useDragScroll()

  if (cast.length === 0) {
    return <p className="text-sm text-zinc-500">Cast information is not available.</p>
  }

  return (
    <div
      ref={scrollRef}
      className="scrollbar-subtle -mx-4 flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:scroll-px-8 lg:px-8"
    >
      {cast.map((person) => {
        const profile = profileUrl(person.profile_path)
        return (
          <article key={person.id} className="w-28 shrink-0 snap-start">
            <div className="aspect-[4/5] overflow-hidden rounded-2xl bg-zinc-900 ring-1 ring-white/8">
              {profile ? (
                <img
                  src={profile}
                  alt={`${person.name} profile`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              ) : (
                <div className="grid size-full place-items-center text-zinc-600" aria-label={`No profile image for ${person.name}`} role="img">
                  <UserRound size={30} aria-hidden="true" />
                </div>
              )}
            </div>
            <p className="mt-2 line-clamp-2 text-sm font-bold text-zinc-100">{person.name}</p>
            {person.character && <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500">{person.character}</p>}
          </article>
        )
      })}
    </div>
  )
}
