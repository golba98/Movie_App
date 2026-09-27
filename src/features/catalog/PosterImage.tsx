import { Film } from 'lucide-react'
import { useState, useEffect } from 'react'
import { imageUrl } from '../../lib/images'

export function PosterImage({
  path,
  title,
  size = 'w500',
}: {
  path: string | null
  title: string
  size?: Parameters<typeof imageUrl>[1]
}) {
  const source = imageUrl(path, size)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const failed = source === failedSource

  useEffect(() => {
    setLoaded(false)
  }, [path])

  if (!source || failed) {
    return (
      <div
        className="flex size-full flex-col items-center justify-center gap-3 bg-gradient-to-br from-zinc-800 to-zinc-950 px-4 text-center text-zinc-500"
        role="img"
        aria-label={`No poster available for ${title}`}
      >
        <Film size={32} aria-hidden="true" />
        <span className="line-clamp-2 text-xs font-semibold">Poster unavailable</span>
      </div>
    )
  }

  return (
    <img
      src={source}
      alt={`${title} poster`}
      loading="lazy"
      decoding="async"
      className={`size-full object-cover transition-opacity duration-300 ease-out ${loaded ? 'opacity-100' : 'opacity-0'}`}
      onLoad={() => setLoaded(true)}
      onError={() => setFailedSource(source)}
    />
  )
}
