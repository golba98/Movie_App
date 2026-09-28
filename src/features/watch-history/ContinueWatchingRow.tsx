import { useEffect, useMemo } from 'react'
import { getMovieDetails, getTvDetails } from '../catalog/api'
import { detailsToMediaItem } from '../catalog/media'
import { MediaRow } from '../catalog/MediaRow'
import { useWatchedHistory } from './watch-history-context'

const MAX_ITEMS = 20
const MAX_BACKFILL_REQUESTS = 12

export function ContinueWatchingRow() {
  const { continueWatching, backfillTitle } = useWatchedHistory()
  const visible = useMemo(() => continueWatching.slice(0, MAX_ITEMS), [continueWatching])
  const items = useMemo(() => visible.flatMap((title) => (title.item ? [title.item] : [])), [visible])
  const missingKey = visible
    .filter((title) => !title.item)
    .slice(0, MAX_BACKFILL_REQUESTS)
    .map((title) => `${title.mediaType}:${title.id}`)
    .join(',')

  // Entries carried over from older history only store ids; fetch their artwork once.
  useEffect(() => {
    if (!missingKey) return
    const controller = new AbortController()
    for (const key of missingKey.split(',')) {
      const [mediaType, rawId] = key.split(':')
      const id = Number(rawId)
      const request = mediaType === 'tv' ? getTvDetails(id, controller.signal) : getMovieDetails(id, controller.signal)
      request
        .then((data) => backfillTitle(detailsToMediaItem(data, mediaType === 'tv' ? 'tv' : 'movie')))
        .catch(() => {
          // Leave the entry hidden; it is retried on the next visit.
        })
    }
    return () => controller.abort()
  }, [missingKey, backfillTitle])

  if (visible.length === 0) return null

  return (
    <MediaRow
      id="continue-watching"
      title="Continue watching"
      items={items}
      loading={items.length === 0}
      error={null}
      variant="continue"
    />
  )
}
