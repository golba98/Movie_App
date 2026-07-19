export type PlaybackState = 'waiting' | 'playing' | 'paused' | 'buffering' | 'ended'
export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error'
export type PlaybackCommandReason = 'play' | 'pause' | 'seek' | 'restart' | 'rate' | 'recovery'

export interface AuthoritativeState {
  roomId: string
  roomCode: string
  roomName: string
  playbackState: PlaybackState
  positionMs: number
  playbackRate: number
  stateUpdatedAt: number
  revision: number
  hostId: string
  serverNow: number
  participants: { id: string; displayName: string; role: string; canControl: boolean }[]
}

export interface PlaybackCommandMetadata {
  reason: PlaybackCommandReason
  executeAtServerMs: number
}

export type RoomServerEvent =
  | {
      type: 'room:joined' | 'room:state' | 'playback:state' | 'playback:sync'
      state: AuthoritativeState
      eventId?: string
      command?: PlaybackCommandMetadata
    }
  | { type: 'room:ended'; revision: number; serverNow: number }
  | { type: 'error'; code: string; message: string; revision?: number }

export interface CandidateSummary {
  fingerprint: string
  tabId: number
  frameId: number
  documentId: string
  origin: string
  score: number
  width: number
  height: number
  durationBucket: string
  paused: boolean
  readyState: number
}

export interface ControllerTarget {
  tabId: number
  frameId: number
  documentId: string
  fingerprint: string
  manual: boolean
}

export interface FrameTarget {
  tabId: number
  frameId: number
  documentId: string
  origin: string
}

export interface PopupViewState {
  socketStatus: SocketStatus
  socketMessage: string
  roomId: string | null
  role: string | null
  revision: number
  positionMs: number
  driftMs: number | null
  reconnectAttempt: number
  tabId: number | null
  topOrigin: string | null
  embeddedOrigins: string[]
  grantedOrigins: string[]
  candidates: CandidateSummary[]
  selectedTarget: ControllerTarget | null
  diagnosticsEnabled: boolean
  playerState: PlaybackState | 'unavailable'
}

export type InternalMessage =
  | { type: 'bridge:hello'; origin: string }
  | { type: 'bridge:connect'; roomId: string; socketUrl: string; nonce: string; clientSessionId: string; extensionToken: string }
  | { type: 'bridge:token'; roomId: string; socketUrl: string; nonce: string; clientSessionId: string; extensionToken: string }
  | { type: 'bridge:disconnect'; clientSessionId: string }
  | { type: 'frame:candidates'; candidates: Omit<CandidateSummary, 'tabId' | 'frameId' | 'documentId' | 'origin'>[] }
  | { type: 'frame:local-intent'; intent: 'play' | 'pause' | 'seek' | 'rate'; positionMs?: number; playbackRate?: number }
  | { type: 'frame:snapshot'; positionMs: number; playbackState: PlaybackState; playbackRate: number; buffering: boolean; readyState: number; driftMs: number }
  | { type: 'frame:activation-required'; message: string }
  | { type: 'frame:unavailable'; reason: string }
  | { type: 'popup:get-state' }
  | { type: 'popup:rescan'; tabId: number; grantedOrigins: string[] }
  | { type: 'popup:enable'; tabId: number; origins: string[] }
  | { type: 'popup:shutdown-origins'; tabId: number; origins: string[] }
  | { type: 'popup:select-target'; target: ControllerTarget }
  | { type: 'popup:control'; intent: 'play' | 'pause' | 'seek' | 'restart' | 'rate'; positionMs?: number; playbackRate?: number }
  | { type: 'popup:disconnect' }
  | { type: 'popup:dev-connect'; roomCode: string; displayName: string; password?: string }
  | { type: 'popup:set-diagnostics'; enabled: boolean }
  | { type: 'popup:get-diagnostics' }
  | { type: 'background:remote-command'; state: AuthoritativeState; command?: PlaybackCommandMetadata; clockOffsetMs: number }
  | { type: 'background:select-target'; fingerprint: string }
  | { type: 'background:shutdown' }
  | { type: 'background:rescan' }
  | { type: 'background:token-request'; nonce: string; clientSessionId: string }
  | { type: 'background:status'; status: SocketStatus; message: string; clientSessionId: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function isInternalMessage(value: unknown): value is InternalMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  const strings = (...keys: string[]) => keys.every((key) => typeof value[key] === 'string' && (value[key] as string).length > 0)
  const finiteOptional = (key: string) => value[key] === undefined || (typeof value[key] === 'number' && Number.isFinite(value[key]))
  switch (value.type) {
    case 'bridge:hello':
      return strings('origin')
    case 'bridge:disconnect':
      return strings('clientSessionId')
    case 'bridge:connect':
    case 'bridge:token':
      return strings('roomId', 'socketUrl', 'nonce', 'clientSessionId', 'extensionToken')
        && (value.extensionToken as string).length >= 32
    case 'frame:candidates':
      return Array.isArray(value.candidates) && value.candidates.length <= 100 && value.candidates.every((candidate) =>
        isRecord(candidate)
        && stringsFrom(candidate, 'fingerprint', 'durationBucket')
        && ['score', 'width', 'height', 'readyState'].every((key) => typeof candidate[key] === 'number' && Number.isFinite(candidate[key]))
        && typeof candidate.paused === 'boolean')
    case 'frame:local-intent':
      return ['play', 'pause', 'seek', 'rate'].includes(String(value.intent)) && finiteOptional('positionMs') && finiteOptional('playbackRate')
    case 'frame:snapshot':
      return [value.positionMs, value.playbackRate, value.driftMs].every((entry) => typeof entry === 'number' && Number.isFinite(entry))
        && typeof value.buffering === 'boolean'
        && Number.isInteger(value.readyState)
        && typeof value.playbackState === 'string'
        && ['waiting', 'playing', 'paused', 'buffering', 'ended'].includes(value.playbackState)
    case 'frame:activation-required':
      return strings('message')
    case 'frame:unavailable':
      return strings('reason')
    case 'popup:get-state':
    case 'popup:disconnect':
    case 'popup:get-diagnostics':
    case 'background:shutdown':
    case 'background:rescan':
      return true
    case 'popup:rescan':
      return Number.isInteger(value.tabId) && Array.isArray(value.grantedOrigins) && value.grantedOrigins.every((origin) => typeof origin === 'string')
    case 'popup:enable':
    case 'popup:shutdown-origins':
      return Number.isInteger(value.tabId) && Array.isArray(value.origins) && value.origins.every((origin) => typeof origin === 'string')
    case 'popup:select-target':
      if (!isRecord(value.target)) return false
      return ['tabId', 'frameId'].every((key) => Number.isInteger((value.target as Record<string, unknown>)[key]))
        && stringsFrom(value.target, 'documentId', 'fingerprint')
        && typeof value.target.manual === 'boolean'
    case 'popup:control':
      return ['play', 'pause', 'seek', 'restart', 'rate'].includes(String(value.intent)) && finiteOptional('positionMs') && finiteOptional('playbackRate')
    case 'popup:dev-connect':
      return strings('roomCode', 'displayName') && (value.password === undefined || typeof value.password === 'string')
    case 'popup:set-diagnostics':
      return typeof value.enabled === 'boolean'
    case 'background:select-target':
      return strings('fingerprint')
    case 'background:token-request':
      return strings('nonce', 'clientSessionId')
    case 'background:status':
      return strings('message', 'clientSessionId') && ['idle', 'connecting', 'connected', 'reconnecting', 'disconnected', 'error'].includes(String(value.status))
    case 'background:remote-command':
      return isRecord(value.state) && Number.isSafeInteger(value.state.revision) && typeof value.clockOffsetMs === 'number' && Number.isFinite(value.clockOffsetMs)
    default:
      return false
  }
}

function stringsFrom(value: Record<string, unknown>, ...keys: string[]) {
  return keys.every((key) => typeof value[key] === 'string' && (value[key] as string).length > 0)
}

export function isRoomServerEvent(value: unknown): value is RoomServerEvent {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'error') return typeof value.code === 'string' && typeof value.message === 'string'
  if (value.type === 'room:ended') return Number.isSafeInteger(value.revision) && typeof value.serverNow === 'number'
  return ['room:joined', 'room:state', 'playback:state', 'playback:sync'].includes(value.type)
    && isRecord(value.state)
    && Number.isSafeInteger(value.state.revision)
    && typeof value.state.serverNow === 'number'
}
