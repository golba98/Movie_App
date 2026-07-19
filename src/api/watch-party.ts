import type { WatchPartyCreateInput, WatchPartyRoomSummary, WatchPartyState } from '../types/watch-party'
import { apiRequest } from './client'

export interface WatchPartyCreateRequest extends WatchPartyCreateInput {
  mediaTitle: string
  posterPath: string | null
  backdropPath: string | null
}

export interface WatchPartyAccess {
  state: WatchPartyState
  accessToken: string
  memberId: string
}

export function createWatchParty(input: WatchPartyCreateRequest) {
  return apiRequest<WatchPartyAccess & { invitationUrl: string }>('/api/watch-party/rooms', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function lookupWatchParty(code: string) {
  return apiRequest<{ room: WatchPartyRoomSummary }>(`/api/watch-party/lookup?code=${encodeURIComponent(code)}`)
}

export function getWatchPartyRoom(roomId: string) {
  return apiRequest<{ room: WatchPartyRoomSummary }>(`/api/watch-party/rooms/${encodeURIComponent(roomId)}`)
}

export function joinWatchParty(roomId: string, input: { displayName: string; password?: string; inviteToken?: string }) {
  return apiRequest<WatchPartyAccess>(`/api/watch-party/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getWatchPartyState(roomId: string, accessToken: string) {
  return apiRequest<{ state: WatchPartyState }>(`/api/watch-party/rooms/${encodeURIComponent(roomId)}/state`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
}

export function getWatchPartyMedia(roomId: string, accessToken: string) {
  return apiRequest<{ source: { id: string; sourceUrl: string; mimeType: 'video/mp4' | 'video/webm'; extractedUrl: string | null; playbackUrl: string | null; playbackKind: 'video' | 'hls' | 'embed' } }>(
    `/api/watch-party/rooms/${encodeURIComponent(roomId)}/media`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
}

export function mintWatchPartyExtensionToken(
  roomId: string,
  accessToken: string,
  input: { nonce: string; clientSessionId: string; capabilityVersion: 1 },
) {
  return apiRequest<{ extensionToken: string; expiresAt: number; capabilityVersion: 1 }>(
    `/api/watch-party/rooms/${encodeURIComponent(roomId)}/extension-token`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(input),
    },
  )
}
