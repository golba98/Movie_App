import { useEffect, useState } from 'react'
import { isAbortError } from '../../../lib/api-client'
import type { MediaSource } from '../../../types/media-source'
import type { MediaType } from '../../../types/tmdb'
import { getMediaSources } from '../../player/api'

/** Playable sources for a title; `sources` is null while they are loading. */
export function useMediaSources(mediaType: MediaType, id: number, validId: boolean) {
  const [sources, setSources] = useState<MediaSource[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!validId) {
      setSources([])
      return
    }
    const controller = new AbortController()
    setSources(null)
    setFailed(false)
    getMediaSources(mediaType, id, controller.signal)
      .then((response) => setSources(response.sources))
      .catch((error) => {
        if (isAbortError(error)) return
        setSources([])
        setFailed(true)
      })
    return () => controller.abort()
  }, [id, mediaType, validId])

  return { sources, failed }
}
