import { UserRound } from 'lucide-react'
import type { CastMember } from '../../types/tmdb'
import { profileUrl } from '../../utils/images'

export function CastList({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) {
    return <p className="text-sm text-zinc-500">Cast information is not available.</p>
  }

  return (
    <div className="scrollbar-subtle flex gap-4 overflow-x-auto pb-4">
      {cast.map((person) => {
        const profile = profileUrl(person.profile_path)
        return (
          <article key={person.id} className="w-28 shrink-0">
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
