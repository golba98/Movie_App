import { useEffect, useState } from 'react'
import { backdropSrcSet, backdropUrl } from '../../../lib/images'
import type { MediaItem } from '../../../types/tmdb'

export function DetailsBackdrop({ item }: { item: MediaItem }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const backdrop = backdropUrl(item.backdropPath)

  // A new title fades its artwork in again.
  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [item.id])

  return (
    <header className="relative isolate min-h-[260px] overflow-hidden sm:min-h-[390px] lg:min-h-[470px] short:min-h-[220px]">
      {/* The gradient is the fallback: it shows before the image decodes and
          stays if the image fails, so the fixed-height header never goes blank. */}
      <div className="absolute inset-0 -z-30 bg-gradient-to-br from-brand-600/25 via-zinc-900 to-zinc-950" />
      {backdrop && !failed && (
        <img
          src={backdrop}
          srcSet={backdropSrcSet(item.backdropPath)}
          sizes="(min-width: 1024px) 1152px, 100vw"
          alt=""
          role="presentation"
          className={`absolute inset-0 -z-20 size-full object-cover transition-opacity duration-300 ease-out ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          fetchPriority="high"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-black/20" />
    </header>
  )
}
