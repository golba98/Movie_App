import { apiRequest, authorization } from '../../lib/api-client'
import type { MediaMimeType } from '../../types/media-source'
import type {
  PlaybackKind,
  WATCH_PARTY_EXTENSION_CAPABILITY_VERSION,
  WatchPartyCreateInput,
  WatchPartyRoomSummary,
  WatchPartyState,
} from '../../types/watch-party'

type CapabilityVersion = typeof WATCH_PARTY_EXTENSION_CAPABILITY_VERSION

interface WatchPartyCreateRequest extends WatchPartyCreateInput {
  mediaTitle: string
  posterPath: string | null
  backdropPath: string | null
}

interface JoinedWatchParty {
  state: WatchPartyState
  accessToken: string
  memberId: string
}

export interface WatchPartyMediaSource {
  id: string
  sourceUrl: string
  mimeType: MediaMimeType
  extractedUrl: string | null
  playbackUrl: string | null
  playbackKind: PlaybackKind
}

const roomPath = (roomId: string, endpoint = '') =>
  `/api/watch-party/rooms/${encodeURIComponent(roomId)}${endpoint ? `/${endpoint}` : ''}`

/** A WebSocket URL for a room endpoint on this origin. */
export function roomSocketUrl(roomId: string, endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(roomPath(roomId, endpoint), window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url.toString()
}

export function createWatchParty(input: WatchPartyCreateRequest) {
  return apiRequest<JoinedWatchParty & { invitationUrl: string }>('/api/watch-party/rooms', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function lookupWatchParty(code: string) {
  return apiRequest<{ room: WatchPartyRoomSummary }>(`/api/watch-party/lookup?code=${encodeURIComponent(code)}`)
}

export function getWatchPartyRoom(roomId: string) {
  return apiRequest<{ room: WatchPartyRoomSummary }>(roomPath(roomId))
}

export function joinWatchParty(roomId: string, input: { displayName: string; password?: string; inviteToken?: string }) {
  return apiRequest<JoinedWatchParty>(roomPath(roomId, 'join'), {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getWatchPartyState(roomId: string, accessToken: string) {
  return apiRequest<{ state: WatchPartyState }>(roomPath(roomId, 'state'), { headers: authorization(accessToken) })
}

export function getWatchPartyMedia(roomId: string, accessToken: string) {
  return apiRequest<{ source: WatchPartyMediaSource }>(roomPath(roomId, 'media'), { headers: authorization(accessToken) })
}

export function mintWatchPartyExtensionToken(
  roomId: string,
  accessToken: string,
  input: { nonce: string; clientSessionId: string; capabilityVersion: CapabilityVersion },
) {
  return apiRequest<{ extensionToken: string; expiresAt: number; capabilityVersion: CapabilityVersion }>(
    roomPath(roomId, 'extension-token'),
    {
      method: 'POST',
      headers: authorization(accessToken),
      body: JSON.stringify(input),
    },
  )
}
