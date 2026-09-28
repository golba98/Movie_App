import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { HistoryState } from '../../types/watch-history'
import { getWatchHistory, pushWatchHistory } from './api'
import { isHistoryState, mergeHistory, pendingChanges, type SyncedVersions } from './history-state'

// The first change after a quiet spell syncs quickly; progress saved during
// playback (every few seconds) is batched into one request per interval.
const SYNC_DELAY_MS = 2_000
const SYNC_INTERVAL_MS = 10_000
const PULL_INTERVAL_MS = 30_000
const MAX_SYNC_ITEMS = 500
// keepalive requests are limited to 64 KiB of body.
const MAX_KEEPALIVE_ITEMS = 100

const noSyncedVersions = (): SyncedVersions => ({ entries: {}, titles: {} })

/**
 * Keeps the account's server-side history in step with local state.
 * localStorage is the instant, offline cache; the server makes history
 * follow the account across devices.
 *
 * Returns a function that makes the next change skip the batching delay.
 */
export function useHistorySync(
  accountId: string | null,
  state: HistoryState,
  setState: Dispatch<SetStateAction<HistoryState>>,
) {
  const stateRef = useRef(state)
  const accountIdRef = useRef(accountId)
  const syncedRef = useRef<SyncedVersions>(noSyncedVersions())
  const pulledRef = useRef(false)
  const pushingRef = useRef(false)
  const pushTimerRef = useRef<number | null>(null)
  const lastPushRef = useRef(0)
  const lastPullRef = useRef(0)
  const urgentPushRef = useRef(false)
  // Bumped after each pull and push so the scheduling effect re-checks for
  // changes that are still unsent.
  const [syncTick, setSyncTick] = useState(0)
  const bumpSyncTick = useCallback(() => setSyncTick((tick) => tick + 1), [])

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const markSynced = useCallback((kind: keyof SyncedVersions, key: string, updatedAt: number) => {
    const versions = syncedRef.current[kind]
    versions[key] = Math.max(versions[key] ?? 0, updatedAt)
  }, [])

  const cancelScheduledPush = useCallback(() => {
    if (pushTimerRef.current !== null) window.clearTimeout(pushTimerRef.current)
    pushTimerRef.current = null
  }, [])

  const push = useCallback(async (keepalive = false) => {
    const syncAccountId = accountIdRef.current
    if (!syncAccountId || !pulledRef.current || (pushingRef.current && !keepalive)) return
    const changes = pendingChanges(stateRef.current, syncedRef.current, keepalive ? MAX_KEEPALIVE_ITEMS : MAX_SYNC_ITEMS)
    if (!changes.entries.length && !changes.titles.length) return
    pushingRef.current = true
    lastPushRef.current = Date.now()
    try {
      await pushWatchHistory(changes, keepalive)
      if (accountIdRef.current !== syncAccountId) return
      for (const { key, updatedAt } of changes.entries) markSynced('entries', key, updatedAt)
      for (const { key, updatedAt } of changes.titles) markSynced('titles', key, updatedAt)
    } catch (error) {
      console.warn('Watch history sync failed; it will retry.', error)
    } finally {
      pushingRef.current = false
    }
  }, [markSynced])

  const schedulePush = useCallback(() => {
    if (pushTimerRef.current !== null) return
    const delay = Math.max(SYNC_DELAY_MS, lastPushRef.current + SYNC_INTERVAL_MS - Date.now())
    pushTimerRef.current = window.setTimeout(() => {
      pushTimerRef.current = null
      void push().then(bumpSyncTick)
    }, delay)
  }, [bumpSyncTick, push])

  const pull = useCallback(async () => {
    const syncAccountId = accountIdRef.current
    if (!syncAccountId) return
    lastPullRef.current = Date.now()
    try {
      const remote = await getWatchHistory()
      if (accountIdRef.current !== syncAccountId || !isHistoryState(remote)) return
      for (const [key, entry] of Object.entries(remote.entries)) {
        if (typeof entry?.updatedAt === 'number') markSynced('entries', key, entry.updatedAt)
      }
      for (const [key, title] of Object.entries(remote.titles)) {
        if (typeof title?.updatedAt === 'number') markSynced('titles', key, title.updatedAt)
      }
      pulledRef.current = true
      setState((current) => mergeHistory(current, remote))
      // Uploads anything only this device knows about, even if the merge
      // changed nothing locally.
      bumpSyncTick()
    } catch (error) {
      console.warn('Unable to load watch history from the server.', error)
    }
  }, [bumpSyncTick, markSynced, setState])

  useEffect(() => {
    accountIdRef.current = accountId
    syncedRef.current = noSyncedVersions()
    pulledRef.current = false
    lastPushRef.current = 0
    if (!accountId) return
    void pull()
    return cancelScheduledPush
  }, [accountId, cancelScheduledPush, pull])

  useEffect(() => {
    if (!accountId || !pulledRef.current) return
    const changes = pendingChanges(state, syncedRef.current, 1)
    if (!changes.entries.length && !changes.titles.length) return
    if (urgentPushRef.current) {
      urgentPushRef.current = false
      cancelScheduledPush()
      void push(true).then(bumpSyncTick)
      return
    }
    schedulePush()
  }, [accountId, bumpSyncTick, cancelScheduledPush, push, schedulePush, state, syncTick])

  // Pick up changes from other devices when the app comes back into view, and
  // send ours before the page is hidden or closed.
  useEffect(() => {
    if (!accountId) return
    const refresh = () => {
      if (Date.now() - lastPullRef.current >= PULL_INTERVAL_MS) void pull()
    }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh()
      else void push(true)
    }
    const onPageHide = () => void push(true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', refresh)
    window.addEventListener('pagehide', onPageHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [accountId, pull, push])

  return useCallback(() => {
    urgentPushRef.current = true
  }, [])
}
