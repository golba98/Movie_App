import type { MediaType } from './tmdb'

export type WatchPartyPrivacy = 'public' | 'private' | 'invite_only'
export type PlaybackControlMode = 'host_only' | 'everyone' | 'approved' | 'request'
export type WatchPartyPlaybackState = 'waiting' | 'playing' | 'paused' | 'buffering' | 'ended'
export type WatchPartyRole = 'host' | 'moderator' | 'participant'
export type WatchPartyConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'
export type WatchPartySyncStatus = 'synchronized' | 'ahead' | 'behind' | 'buffering'
export type WatchPartyClientType = 'website' | 'browser-extension'
export type WatchPartyPlaybackCommandReason = 'play' | 'pause' | 'seek' | 'restart' | 'rate' | 'recovery'

export type PlaybackKind = 'video' | 'hls' | 'embed'

export const WATCH_PARTY_EXTENSION_CAPABILITY_VERSION = 1

// Drift correction shared by the website player and the companion extension:
// drift within `ignoreMs` is left alone, up to `seekMs` is nudged with the
// playback rate (1% per `msPerRateUnit / 100` ms, within min/maxRate), and
// anything larger seeks.
export const DRIFT_CORRECTION = {
  ignoreMs: 250,
  seekMs: 1_500,
  msPerRateUnit: 50_000,
  minRate: 0.97,
  maxRate: 1.03,
} as const

export interface WatchPartyPlaybackCommand {
  reason: WatchPartyPlaybackCommandReason
  executeAtServerMs: number
}

export interface WatchPartyClientSnapshot {
  positionMs: number
  playbackState: WatchPartyPlaybackState
  playbackRate: number
  buffering: boolean
  readyState: number
  driftMs: number
}

export interface WatchPartyMedia {
  sourceId: string
  mediaType: MediaType
  tmdbId: number
  seasonNumber: number | null
  episodeNumber: number | null
  title: string
  posterPath: string | null
  backdropPath: string | null
}

export interface WatchPartySettings {
  privacy: WatchPartyPrivacy
  maxParticipants: number
  controlMode: PlaybackControlMode
  allowLateJoin: boolean
  allowMediaChange: boolean
  readyUpEnabled: boolean
  startWhenEveryoneReady: boolean
  pauseForBuffering: boolean
  locked: boolean
  expiresAt: number | null
}

export interface WatchPartyParticipant {
  id: string
  displayName: string
  role: WatchPartyRole
  canControl: boolean
  ready: boolean
  buffering: boolean
  connectionStatus: WatchPartyConnectionStatus
  syncStatus: WatchPartySyncStatus
  joinedAt: number
}

export interface WatchPartyActivity {
  id: string
  message: string
  createdAt: number
}

export interface WatchPartyState {
  roomId: string
  roomCode: string
  roomName: string
  media: WatchPartyMedia
  settings: WatchPartySettings
  playbackState: WatchPartyPlaybackState
  positionMs: number
  playbackRate: number
  stateUpdatedAt: number
  revision: number
  hostId: string
  participants: WatchPartyParticipant[]
  activity: WatchPartyActivity[]
  serverNow: number
}

export interface WatchPartyRoomSummary {
  roomId: string
  roomCode: string
  roomName: string
  privacy: WatchPartyPrivacy
  hostName: string
  media: Pick<WatchPartyMedia, 'mediaType' | 'tmdbId' | 'seasonNumber' | 'episodeNumber' | 'title' | 'posterPath' | 'backdropPath'>
  participantCount: number
  maxParticipants: number
  requiresPassword: boolean
  expiresAt: number | null
}

export interface WatchPartyCreateInput {
  roomName: string
  sourceId: string
  privacy: WatchPartyPrivacy
  password?: string
  maxParticipants: number
  controlMode: PlaybackControlMode
  allowLateJoin: boolean
  allowMediaChange: boolean
  readyUpEnabled: boolean
  startWhenEveryoneReady: boolean
  pauseForBuffering: boolean
  expiresInHours: 1 | 6 | 24 | null
}

export type WatchPartyClientEvent =
  | { type: 'extension:authenticate'; token: string; nonce: string; clientSessionId: string; capabilityVersion: 1 }
  | { type: 'room:ready'; eventId: string; baseRevision: number; ready: boolean }
  | { type: 'room:sync-request'; eventId: string; baseRevision: number }
  | { type: 'playback:play-request'; eventId: string; baseRevision: number }
  | { type: 'playback:pause-request'; eventId: string; baseRevision: number }
  | { type: 'playback:seek-request'; eventId: string; baseRevision: number; positionMs: number }
  | { type: 'playback:restart-request'; eventId: string; baseRevision: number }
  | { type: 'playback:rate-request'; eventId: string; baseRevision: number; playbackRate: number }
  | { type: 'playback:buffering'; eventId: string; baseRevision: number; buffering: boolean }
  | { type: 'control:request'; eventId: string; baseRevision: number }
  | { type: 'control:grant'; eventId: string; baseRevision: number; participantId: string; canControl: boolean }
  | { type: 'host:transfer'; eventId: string; baseRevision: number; participantId: string }
  | { type: 'room:lock'; eventId: string; baseRevision: number; locked: boolean }
  | { type: 'room:end'; eventId: string; baseRevision: number }
  | { type: 'participant:remove'; eventId: string; baseRevision: number; participantId: string; ban: boolean }
  | ({ type: 'playback:client-snapshot'; eventId: string; baseRevision: number } & WatchPartyClientSnapshot)

export type WatchPartyClientRequest =
  | { type: 'room:ready'; ready: boolean }
  | { type: 'room:sync-request' }
  | { type: 'playback:play-request' }
  | { type: 'playback:pause-request' }
  | { type: 'playback:seek-request'; positionMs: number }
  | { type: 'playback:restart-request' }
  | { type: 'playback:rate-request'; playbackRate: number }
  | { type: 'playback:buffering'; buffering: boolean }
  | { type: 'control:request' }
  | { type: 'control:grant'; participantId: string; canControl: boolean }
  | { type: 'host:transfer'; participantId: string }
  | { type: 'room:lock'; locked: boolean }
  | { type: 'room:end' }
  | { type: 'participant:remove'; participantId: string; ban: boolean }

export type WatchPartyServerEvent =
  | {
      type: 'room:joined' | 'room:state' | 'playback:state' | 'playback:sync'
      state: WatchPartyState
      eventId?: string
      command?: WatchPartyPlaybackCommand
    }
  | { type: 'playback:activity'; activity: WatchPartyActivity; revision: number; serverNow: number }
  | { type: 'room:ended'; revision: number; serverNow: number }
  | { type: 'error'; code: string; message: string; revision?: number }
