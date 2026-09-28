// A member's room access lives for the browser tab, so a reload rejoins silently.
const SESSION_PREFIX = 'fedora:watch-party:'

interface WatchPartyAccess {
  accessToken: string
  memberId: string
}

export function saveWatchPartyAccess(roomId: string, accessToken: string, memberId: string) {
  sessionStorage.setItem(`${SESSION_PREFIX}${roomId}`, JSON.stringify({ accessToken, memberId }))
}

export function readWatchPartyAccess(roomId: string): WatchPartyAccess | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${SESSION_PREFIX}${roomId}`) ?? 'null') as Partial<WatchPartyAccess> | null
    return value?.accessToken && value.memberId ? { accessToken: value.accessToken, memberId: value.memberId } : null
  } catch {
    return null
  }
}
