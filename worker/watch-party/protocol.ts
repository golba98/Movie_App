import type {
  WatchPartyActivity,
  WatchPartyClientEvent,
  WatchPartyClientSnapshot,
  WatchPartyParticipant,
  WatchPartyState,
} from '../../src/types/watch-party'
import { isRecord } from '../validate'

// One week: the longest position a client may report or seek to.
const MAX_POSITION_MS = 604_800_000

export type RoomMember = WatchPartyParticipant & {
  principalId: string
  hostAbsentAt: number | null
}

export type InternalState = Omit<WatchPartyState, 'participants' | 'activity' | 'serverNow'> & {
  participants: RoomMember[]
  activity: WatchPartyActivity[]
  processedEventIds: string[]
  usedExtensionTokenIds: { tokenId: string; expiresAt: number }[]
  hostEpoch: number
}

export interface RoomInitialization {
  state: WatchPartyState
  hostPrincipalId: string
}

export interface RoomJoinInput {
  memberId: string
  principalId: string
  displayName: string
}

// Each socket carries one of these as its hibernation-safe attachment.
export interface WebsiteConnectionAttachment {
  memberId: string
  clientType: 'website'
  authenticated: true
  capabilityVersion: 0
}

export interface PendingExtensionConnectionAttachment {
  clientType: 'browser-extension'
  authenticated: false
  capabilityVersion: 1
  extensionOrigin: string
  authDeadline: number
}

export interface ExtensionConnectionAttachment {
  memberId: string
  clientType: 'browser-extension'
  authenticated: true
  capabilityVersion: 1
  extensionOrigin: string
  clientSessionId: string
  latestSnapshot?: WatchPartyClientSnapshot
}

type ConnectionAttachment = WebsiteConnectionAttachment | PendingExtensionConnectionAttachment | ExtensionConnectionAttachment
export type AuthenticatedAttachment = WebsiteConnectionAttachment | ExtensionConnectionAttachment

export function readAttachment(socket: WebSocket): ConnectionAttachment | null {
  const attachment = socket.deserializeAttachment() as ConnectionAttachment | null
  return attachment?.clientType ? attachment : null
}

export function isAuthenticatedAttachment(attachment: ConnectionAttachment | null): attachment is AuthenticatedAttachment {
  return Boolean(attachment?.authenticated && 'memberId' in attachment)
}

export function isPendingExtension(attachment: ConnectionAttachment | null): attachment is PendingExtensionConnectionAttachment {
  return attachment?.clientType === 'browser-extension' && !attachment.authenticated
}

/** The public view of room state: members lose their principal ids and host bookkeeping. */
export function serialise(state: InternalState): WatchPartyState {
  return {
    ...state,
    participants: state.participants.map((member) => ({
      id: member.id,
      displayName: member.displayName,
      role: member.role,
      canControl: member.canControl,
      ready: member.ready,
      buffering: member.buffering,
      connectionStatus: member.connectionStatus,
      syncStatus: member.syncStatus,
      joinedAt: member.joinedAt,
    })),
    activity: state.activity,
    serverNow: Date.now(),
  }
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function isIdentifier(value: unknown, minimum = 12, maximum = 200) {
  return typeof value === 'string'
    && value.length >= minimum
    && value.length <= maximum
    && /^[A-Za-z0-9:_-]+$/.test(value)
}

const isNumberBetween = (value: unknown, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum

const isPosition = (value: unknown) => isNumberBetween(value, 0, MAX_POSITION_MS)

const PLAYBACK_STATES = new Set(['waiting', 'playing', 'paused', 'buffering', 'ended'])

function hasEventEnvelope(value: Record<string, unknown>) {
  return isIdentifier(value.eventId)
    && Number.isSafeInteger(value.baseRevision)
    && (value.baseRevision as number) >= 0
}

const ENVELOPE = ['type', 'eventId', 'baseRevision']

/** Strict validation: every event must have exactly its own fields, each in range. */
export function isWatchPartyClientEvent(value: unknown): value is WatchPartyClientEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'extension:authenticate') {
    return hasExactKeys(value, ['type', 'token', 'nonce', 'clientSessionId', 'capabilityVersion'])
      && typeof value.token === 'string'
      && value.token.length >= 32
      && value.token.length <= 2_048
      && isIdentifier(value.nonce, 16, 128)
      && isIdentifier(value.clientSessionId, 16, 128)
      && value.capabilityVersion === 1
  }
  if (!hasEventEnvelope(value)) return false
  const fields = (...extra: string[]) => hasExactKeys(value, [...ENVELOPE, ...extra])
  switch (value.type) {
    case 'room:sync-request':
    case 'playback:play-request':
    case 'playback:pause-request':
    case 'playback:restart-request':
    case 'control:request':
    case 'room:end':
      return fields()
    case 'room:ready':
      return fields('ready') && typeof value.ready === 'boolean'
    case 'playback:buffering':
      return fields('buffering') && typeof value.buffering === 'boolean'
    case 'playback:seek-request':
      return fields('positionMs') && isPosition(value.positionMs)
    case 'playback:rate-request':
      return fields('playbackRate') && isNumberBetween(value.playbackRate, 0.5, 2)
    case 'control:grant':
      return fields('participantId', 'canControl') && isIdentifier(value.participantId, 2) && typeof value.canControl === 'boolean'
    case 'host:transfer':
      return fields('participantId') && isIdentifier(value.participantId, 2)
    case 'room:lock':
      return fields('locked') && typeof value.locked === 'boolean'
    case 'participant:remove':
      return fields('participantId', 'ban') && isIdentifier(value.participantId, 2) && typeof value.ban === 'boolean'
    case 'playback:client-snapshot':
      return fields('positionMs', 'playbackState', 'playbackRate', 'buffering', 'readyState', 'driftMs')
        && isPosition(value.positionMs)
        && typeof value.playbackState === 'string'
        && PLAYBACK_STATES.has(value.playbackState)
        && isNumberBetween(value.playbackRate, 0.25, 4)
        && typeof value.buffering === 'boolean'
        && Number.isInteger(value.readyState)
        && (value.readyState as number) >= 0
        && (value.readyState as number) <= 4
        && isNumberBetween(value.driftMs, -MAX_POSITION_MS, MAX_POSITION_MS)
    default:
      return false
  }
}
