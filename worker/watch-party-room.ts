import { DurableObject } from 'cloudflare:workers'
import type {
  WatchPartyActivity,
  WatchPartyClientEvent,
  WatchPartyClientSnapshot,
  WatchPartyClientType,
  WatchPartyParticipant,
  WatchPartyPlaybackCommand,
  WatchPartyServerEvent,
  WatchPartyState,
} from '../src/types/watch-party'
import { readWatchPartyToken, type WatchPartyExtensionTokenPayload } from './watch-party-tokens'

type RoomMember = WatchPartyParticipant & {
  principalId: string
  hostAbsentAt: number | null
}

type InternalState = Omit<WatchPartyState, 'participants' | 'activity' | 'serverNow'> & {
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

interface WebsiteConnectionAttachment {
  memberId: string
  clientType: 'website'
  authenticated: true
  capabilityVersion: 0
}

interface PendingExtensionConnectionAttachment {
  clientType: 'browser-extension'
  authenticated: false
  capabilityVersion: 1
  extensionOrigin: string
  authDeadline: number
}

interface ExtensionConnectionAttachment {
  memberId: string
  clientType: 'browser-extension'
  authenticated: true
  capabilityVersion: 1
  extensionOrigin: string
  clientSessionId: string
  latestSnapshot?: WatchPartyClientSnapshot
}

type ConnectionAttachment = WebsiteConnectionAttachment | PendingExtensionConnectionAttachment | ExtensionConnectionAttachment

const STATE_KEY = 'watch-party-state'
const HOST_GRACE_MS = 2 * 60 * 1000
const EMPTY_ROOM_CLEANUP_MS = 15 * 60 * 1000
const EXTENSION_AUTH_TIMEOUT_MS = 10_000
const EXTENSION_COMMAND_LEAD_MS = 120
const MAX_EVENT_BYTES = 8_000

const playbackStates = new Set(['waiting', 'playing', 'paused', 'buffering', 'ended'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

function isIdentifier(value: unknown, minimum = 12, maximum = 200) {
  return typeof value === 'string'
    && value.length >= minimum
    && value.length <= maximum
    && /^[A-Za-z0-9:_-]+$/.test(value)
}

function hasEventEnvelope(value: Record<string, unknown>) {
  return isIdentifier(value.eventId)
    && Number.isSafeInteger(value.baseRevision)
    && (value.baseRevision as number) >= 0
}

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
  switch (value.type) {
    case 'room:sync-request':
    case 'playback:play-request':
    case 'playback:pause-request':
    case 'playback:restart-request':
    case 'control:request':
    case 'room:end':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision'])
    case 'room:ready':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'ready']) && typeof value.ready === 'boolean'
    case 'playback:buffering':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'buffering']) && typeof value.buffering === 'boolean'
    case 'playback:seek-request':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'positionMs'])
        && typeof value.positionMs === 'number'
        && Number.isFinite(value.positionMs)
        && value.positionMs >= 0
        && value.positionMs <= 604_800_000
    case 'playback:rate-request':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'playbackRate'])
        && typeof value.playbackRate === 'number'
        && Number.isFinite(value.playbackRate)
        && value.playbackRate >= 0.5
        && value.playbackRate <= 2
    case 'control:grant':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'participantId', 'canControl'])
        && isIdentifier(value.participantId, 2)
        && typeof value.canControl === 'boolean'
    case 'host:transfer':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'participantId'])
        && isIdentifier(value.participantId, 2)
    case 'room:lock':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'locked']) && typeof value.locked === 'boolean'
    case 'participant:remove':
      return hasExactKeys(value, ['type', 'eventId', 'baseRevision', 'participantId', 'ban'])
        && isIdentifier(value.participantId, 2)
        && typeof value.ban === 'boolean'
    case 'playback:client-snapshot':
      return hasExactKeys(value, [
        'type', 'eventId', 'baseRevision', 'positionMs', 'playbackState', 'playbackRate',
        'buffering', 'readyState', 'driftMs',
      ])
        && typeof value.positionMs === 'number'
        && Number.isFinite(value.positionMs)
        && value.positionMs >= 0
        && value.positionMs <= 604_800_000
        && typeof value.playbackState === 'string'
        && playbackStates.has(value.playbackState)
        && typeof value.playbackRate === 'number'
        && Number.isFinite(value.playbackRate)
        && value.playbackRate >= 0.25
        && value.playbackRate <= 4
        && typeof value.buffering === 'boolean'
        && Number.isInteger(value.readyState)
        && (value.readyState as number) >= 0
        && (value.readyState as number) <= 4
        && typeof value.driftMs === 'number'
        && Number.isFinite(value.driftMs)
        && Math.abs(value.driftMs) <= 604_800_000
    default:
      return false
  }
}

function serialise(state: InternalState): WatchPartyState {
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

function readAttachment(socket: WebSocket): ConnectionAttachment | null {
  const attachment = socket.deserializeAttachment() as ConnectionAttachment | null
  return attachment?.clientType ? attachment : null
}

function isAuthenticatedAttachment(attachment: ConnectionAttachment | null): attachment is WebsiteConnectionAttachment | ExtensionConnectionAttachment {
  return Boolean(attachment?.authenticated && 'memberId' in attachment)
}

function formatPosition(positionMs: number) {
  const total = Math.max(0, Math.floor(positionMs / 1000))
  const minutes = Math.floor(total / 60)
  return `${minutes}:${String(total % 60).padStart(2, '0')}`
}

export class WatchPartyRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
  }

  private async readState() {
    const state = await this.ctx.storage.get<InternalState>(STATE_KEY)
    if (state && !Array.isArray(state.usedExtensionTokenIds)) state.usedExtensionTokenIds = []
    return state
  }

  private async writeState(state: InternalState) {
    await this.ctx.storage.put(STATE_KEY, state)
  }

  private event(state: InternalState, type: WatchPartyServerEvent['type'], extra: Record<string, unknown> = {}) {
    return { type, ...extra, state: serialise(state) } as WatchPartyServerEvent
  }

  private broadcast(payload: WatchPartyServerEvent) {
    const message = JSON.stringify(payload)
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN && isAuthenticatedAttachment(readAttachment(socket))) socket.send(message)
    }
  }

  private async persistAndBroadcast(
    state: InternalState,
    type: 'room:state' | 'playback:state' = 'room:state',
    extra: Record<string, unknown> = {},
  ) {
    await this.writeState(state)
    this.broadcast(this.event(state, type, extra))
  }

  private addActivity(state: InternalState, message: string) {
    const activity = { id: crypto.randomUUID(), message, createdAt: Date.now() }
    state.activity = [...state.activity, activity].slice(-40)
    return activity
  }

  private expectedPosition(state: InternalState, now = Date.now()) {
    return state.playbackState === 'playing'
      ? state.positionMs + Math.max(0, now - state.stateUpdatedAt) * state.playbackRate
      : state.positionMs
  }

  private async schedule(state: InternalState) {
    const deadlines = [state.settings.expiresAt]
      .filter((value): value is number => value !== null)
      .concat(
        state.participants
          .filter((member) => member.id === state.hostId && member.hostAbsentAt !== null)
          .map((member) => member.hostAbsentAt! + HOST_GRACE_MS),
      )
      .concat(
        this.ctx.getWebSockets()
          .map((socket) => readAttachment(socket))
          .filter((attachment): attachment is PendingExtensionConnectionAttachment => Boolean(
            attachment?.clientType === 'browser-extension' && !attachment.authenticated,
          ))
          .map((attachment) => attachment.authDeadline),
      )
    const activeConnections = this.ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN)
    if (activeConnections.length === 0) deadlines.push(Date.now() + EMPTY_ROOM_CLEANUP_MS)
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines))
  }

  async initialize(input: RoomInitialization) {
    const existing = await this.readState()
    if (existing) return serialise(existing)
    const now = Date.now()
    const host = input.state.participants[0]
    const state: InternalState = {
      ...input.state,
      stateUpdatedAt: input.state.stateUpdatedAt || now,
      revision: 0,
      participants: [{ ...host, principalId: input.hostPrincipalId, hostAbsentAt: null }],
      activity: [{ id: crypto.randomUUID(), message: `${host.displayName} created the room.`, createdAt: now }],
      processedEventIds: [],
      usedExtensionTokenIds: [],
      hostEpoch: 1,
    }
    await this.writeState(state)
    await this.schedule(state)
    return serialise(state)
  }

  async summary() {
    const state = await this.readState()
    return state ? serialise(state) : null
  }

  async join(input: RoomJoinInput) {
    const state = await this.readState()
    if (!state || state.playbackState === 'ended') throw new Error('ROOM_UNAVAILABLE')
    if (state.settings.locked) throw new Error('ROOM_LOCKED')
    const existing = state.participants.find((member) => member.principalId === input.principalId)
    if (!existing && state.participants.length >= state.settings.maxParticipants) throw new Error('ROOM_FULL')
    if (!existing && !state.settings.allowLateJoin && state.playbackState === 'playing') throw new Error('LATE_JOIN_DISABLED')

    if (existing) {
      existing.connectionStatus = 'connected'
      existing.hostAbsentAt = null
    } else {
      state.participants.push({
        id: input.memberId,
        principalId: input.principalId,
        displayName: input.displayName,
        role: 'participant',
        canControl: state.settings.controlMode === 'everyone',
        ready: false,
        buffering: false,
        connectionStatus: 'connected',
        syncStatus: 'synchronized',
        joinedAt: Date.now(),
        hostAbsentAt: null,
      })
      this.addActivity(state, `${input.displayName} joined the room.`)
      state.revision += 1
    }
    await this.persistAndBroadcast(state)
    return serialise(state)
  }

  async authorise(memberId: string) {
    const state = await this.readState()
    return Boolean(state?.participants.some((member) => member.id === memberId))
  }

  private canControl(state: InternalState, member: RoomMember) {
    if (member.id === state.hostId) return true
    if (state.settings.controlMode === 'everyone') return true
    return member.canControl
  }

  private reject(socket: WebSocket, code: string, message: string, revision?: number) {
    socket.send(JSON.stringify({ type: 'error', code, message, ...(revision === undefined ? {} : { revision }) }))
  }

  private closeAuthentication(socket: WebSocket, code: string, message: string) {
    this.reject(socket, code, message)
    socket.close(4401, message)
  }

  private async authenticateExtension(
    socket: WebSocket,
    attachment: PendingExtensionConnectionAttachment,
    event: Extract<WatchPartyClientEvent, { type: 'extension:authenticate' }>,
    state: InternalState,
  ) {
    const now = Date.now()
    if (attachment.authDeadline < now) return this.closeAuthentication(socket, 'AUTH_TIMEOUT', 'Extension authentication timed out.')
    const token = await readWatchPartyToken<WatchPartyExtensionTokenPayload>(event.token, this.env.WATCH_PARTY_SIGNING_SECRET)
    const valid = token
      && token.purpose === 'browser-extension'
      && token.roomId === state.roomId
      && token.nonce === event.nonce
      && token.clientSessionId === event.clientSessionId
      && token.capabilityVersion === event.capabilityVersion
      && token.expiresAt > now
      && isIdentifier(token.memberId, 2)
      && isIdentifier(token.tokenId, 16, 128)
    if (!valid) return this.closeAuthentication(socket, 'AUTH_INVALID', 'Extension authentication failed.')
    const member = state.participants.find((candidate) => candidate.id === token.memberId)
    if (!member) return this.closeAuthentication(socket, 'AUTH_INVALID', 'Extension authentication failed.')
    state.usedExtensionTokenIds = state.usedExtensionTokenIds.filter((entry) => entry.expiresAt > now)
    if (state.usedExtensionTokenIds.some((entry) => entry.tokenId === token.tokenId)) {
      return this.closeAuthentication(socket, 'TOKEN_REPLAYED', 'Extension token was already used.')
    }
    state.usedExtensionTokenIds.push({ tokenId: token.tokenId, expiresAt: token.expiresAt })
    for (const candidate of this.ctx.getWebSockets()) {
      if (candidate === socket || candidate.readyState !== WebSocket.OPEN) continue
      const candidateAttachment = readAttachment(candidate)
      if (
        candidateAttachment?.clientType === 'browser-extension'
        && candidateAttachment.authenticated
        && candidateAttachment.clientSessionId === token.clientSessionId
      ) {
        candidate.close(4001, 'Replaced by a newer extension connection')
      }
    }
    const authenticated: ExtensionConnectionAttachment = {
      memberId: token.memberId,
      clientType: 'browser-extension',
      authenticated: true,
      capabilityVersion: token.capabilityVersion,
      extensionOrigin: attachment.extensionOrigin,
      clientSessionId: token.clientSessionId,
    }
    socket.serializeAttachment(authenticated)
    member.connectionStatus = 'connected'
    member.hostAbsentAt = null
    await this.writeState(state)
    socket.send(JSON.stringify(this.event(state, 'room:joined')))
    this.broadcast(this.event(state, 'room:state'))
    await this.schedule(state)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 })
    const clientType = (request.headers.get('X-Watch-Party-Client-Type') ?? 'website') as WatchPartyClientType
    if (clientType !== 'website' && clientType !== 'browser-extension') return new Response('Forbidden', { status: 403 })
    const memberId = request.headers.get('X-Watch-Party-Member')
    if (clientType === 'website' && (!memberId || !(await this.authorise(memberId)))) return new Response('Forbidden', { status: 403 })
    const pair = new WebSocketPair()
    const [client, server] = Object.values(pair)
    this.ctx.acceptWebSocket(server)
    const state = await this.readState()
    if (clientType === 'browser-extension') {
      const extensionOrigin = request.headers.get('X-Watch-Party-Extension-Origin') ?? ''
      server.serializeAttachment({
        clientType: 'browser-extension',
        authenticated: false,
        capabilityVersion: 1,
        extensionOrigin,
        authDeadline: Date.now() + EXTENSION_AUTH_TIMEOUT_MS,
      } satisfies PendingExtensionConnectionAttachment)
      if (state) await this.schedule(state)
    } else if (state && memberId) {
      server.serializeAttachment({
        memberId,
        clientType: 'website',
        authenticated: true,
        capabilityVersion: 0,
      } satisfies WebsiteConnectionAttachment)
      const member = state.participants.find((candidate) => candidate.id === memberId)
      if (member) {
        member.connectionStatus = 'connected'
        member.hostAbsentAt = null
        await this.writeState(state)
        server.send(JSON.stringify(this.event(state, 'room:joined')))
        this.broadcast(this.event(state, 'room:state'))
      }
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string) {
    if (typeof message !== 'string' || message.length > MAX_EVENT_BYTES) return this.reject(socket, 'INVALID_EVENT', 'Invalid room message.')
    let parsed: unknown
    try {
      parsed = JSON.parse(message)
    } catch {
      return this.reject(socket, 'INVALID_EVENT', 'Invalid room message.')
    }
    if (!isWatchPartyClientEvent(parsed)) return this.reject(socket, 'INVALID_EVENT', 'Invalid room message.')
    const attachment = readAttachment(socket)
    const state = await this.readState()
    if (!state) return this.reject(socket, 'ROOM_UNAVAILABLE', 'This room is unavailable.')
    if (attachment?.clientType === 'browser-extension' && !attachment.authenticated) {
      if (parsed.type !== 'extension:authenticate') return this.closeAuthentication(socket, 'AUTH_REQUIRED', 'Authenticate before sending room events.')
      await this.authenticateExtension(socket, attachment, parsed, state)
      return
    }
    if (!isAuthenticatedAttachment(attachment)) return this.reject(socket, 'AUTH_REQUIRED', 'Reconnect to the room.')
    if (parsed.type === 'extension:authenticate') return this.reject(socket, 'ALREADY_AUTHENTICATED', 'The extension is already authenticated.')
    const member = state.participants.find((candidate) => candidate.id === attachment.memberId)
    if (!member) return this.reject(socket, 'AUTH_REQUIRED', 'Reconnect to the room.')
    if (parsed.type === 'playback:client-snapshot') {
      if (attachment.clientType !== 'browser-extension') return this.reject(socket, 'FORBIDDEN', 'Snapshots are accepted from the browser extension only.')
      socket.serializeAttachment({
        ...attachment,
        latestSnapshot: {
          positionMs: parsed.positionMs,
          playbackState: parsed.playbackState,
          playbackRate: parsed.playbackRate,
          buffering: parsed.buffering,
          readyState: parsed.readyState,
          driftMs: parsed.driftMs,
        },
      } satisfies ExtensionConnectionAttachment)
      return
    }
    if (state.processedEventIds.includes(parsed.eventId)) return
    if (parsed.type !== 'room:sync-request' && parsed.baseRevision !== state.revision) {
      return this.reject(socket, 'STALE_REVISION', 'The room changed. Synchronizing now.', state.revision)
    }
    if (state.processedEventIds.length >= 200) state.processedEventIds.shift()
    state.processedEventIds.push(parsed.eventId)

    if (parsed.type === 'room:sync-request') {
      await this.writeState(state)
      socket.send(JSON.stringify(this.event(state, 'playback:sync', { eventId: parsed.eventId })))
      return
    }
    if (parsed.type === 'room:ready') {
      member.ready = parsed.ready
      state.revision += 1
      this.addActivity(state, `${member.displayName} is ${parsed.ready ? 'ready' : 'not ready'}.`)
      await this.persistAndBroadcast(state)
      return
    }
    if (parsed.type === 'playback:buffering') {
      member.buffering = parsed.buffering
      member.syncStatus = parsed.buffering ? 'buffering' : 'synchronized'
      state.revision += 1
      await this.persistAndBroadcast(state)
      return
    }
    if (parsed.type === 'control:request') {
      this.addActivity(state, `${member.displayName} requested playback control.`)
      state.revision += 1
      await this.persistAndBroadcast(state)
      return
    }
    if (parsed.type === 'control:grant') {
      if (member.id !== state.hostId) return this.reject(socket, 'FORBIDDEN', 'Only the host can change control permissions.')
      const target = state.participants.find((candidate) => candidate.id === parsed.participantId)
      if (!target) return this.reject(socket, 'PARTICIPANT_NOT_FOUND', 'Participant not found.')
      target.canControl = parsed.canControl
      state.revision += 1
      this.addActivity(state, `${target.displayName} ${parsed.canControl ? 'can now control playback' : 'can no longer control playback'}.`)
      await this.persistAndBroadcast(state)
      return
    }
    if (parsed.type === 'host:transfer') {
      if (member.id !== state.hostId) return this.reject(socket, 'FORBIDDEN', 'Only the host can transfer ownership.')
      const target = state.participants.find((candidate) => candidate.id === parsed.participantId && candidate.connectionStatus === 'connected')
      if (!target || target.id === member.id) return this.reject(socket, 'PARTICIPANT_NOT_FOUND', 'Choose a connected participant.')
      member.role = 'participant'
      member.canControl = false
      target.role = 'host'
      target.canControl = true
      state.hostId = target.id
      state.hostEpoch += 1
      state.revision += 1
      this.addActivity(state, `Host control transferred to ${target.displayName}.`)
      await this.persistAndBroadcast(state)
      return
    }
    if (parsed.type === 'room:lock') {
      if (member.id !== state.hostId) return this.reject(socket, 'FORBIDDEN', 'Only the host can lock the room.')
      state.settings.locked = parsed.locked
      state.revision += 1
      this.addActivity(state, `The room is ${parsed.locked ? 'locked' : 'unlocked'}.`)
      await this.persistAndBroadcast(state)
      return
    }
    if (parsed.type === 'room:end') {
      if (member.id !== state.hostId) return this.reject(socket, 'FORBIDDEN', 'Only the host can end the room.')
      state.playbackState = 'ended'
      state.stateUpdatedAt = Date.now()
      state.revision += 1
      this.addActivity(state, `${member.displayName} ended the room.`)
      await this.writeState(state)
      await this.env.DB.prepare('UPDATE watch_rooms SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?')
        .bind('ended', Date.now(), Date.now(), state.roomId).run()
      this.broadcast({ type: 'room:ended', revision: state.revision, serverNow: Date.now() })
      return
    }
    if (parsed.type === 'participant:remove') {
      if (member.id !== state.hostId && member.role !== 'moderator') return this.reject(socket, 'FORBIDDEN', 'Host or moderator permission is required.')
      const target = state.participants.find((candidate) => candidate.id === parsed.participantId)
      if (!target || target.id === state.hostId) return this.reject(socket, 'PARTICIPANT_NOT_FOUND', 'Participant not found.')
      state.participants = state.participants.filter((candidate) => candidate.id !== target.id)
      state.revision += 1
      this.addActivity(state, `${target.displayName} was ${parsed.ban ? 'banned' : 'removed'} from the room.`)
      if (parsed.ban) {
        await this.env.DB.prepare('INSERT OR REPLACE INTO watch_room_bans (room_id, principal_id, created_by_member_id, created_at) VALUES (?, ?, ?, ?)')
          .bind(state.roomId, target.principalId, member.id, Date.now()).run()
      }
      for (const candidateSocket of this.ctx.getWebSockets()) {
        const candidateAttachment = readAttachment(candidateSocket)
        if (isAuthenticatedAttachment(candidateAttachment) && candidateAttachment.memberId === target.id) candidateSocket.close(4003, 'Removed from room')
      }
      await this.persistAndBroadcast(state)
      return
    }
    if (!this.canControl(state, member)) return this.reject(socket, 'CONTROL_FORBIDDEN', 'Only permitted participants can control playback.')

    const now = Date.now()
    let commandReason: WatchPartyPlaybackCommand['reason']
    if (parsed.type === 'playback:play-request') {
      commandReason = 'play'
      state.positionMs = this.expectedPosition(state, now)
      state.playbackState = 'playing'
      this.addActivity(state, `${member.displayName} resumed playback.`)
    } else if (parsed.type === 'playback:pause-request') {
      commandReason = 'pause'
      state.positionMs = this.expectedPosition(state, now)
      state.playbackState = 'paused'
      this.addActivity(state, `${member.displayName} paused the movie.`)
    } else if (parsed.type === 'playback:seek-request') {
      commandReason = 'seek'
      state.positionMs = Math.max(0, Math.floor(parsed.positionMs))
      this.addActivity(state, `${member.displayName} skipped to ${formatPosition(state.positionMs)}.`)
    } else if (parsed.type === 'playback:restart-request') {
      commandReason = 'restart'
      state.positionMs = 0
      state.playbackState = 'paused'
      this.addActivity(state, `${member.displayName} restarted playback.`)
    } else if (parsed.type === 'playback:rate-request') {
      commandReason = 'rate'
      if (!Number.isFinite(parsed.playbackRate) || parsed.playbackRate < 0.5 || parsed.playbackRate > 2) {
        return this.reject(socket, 'INVALID_RATE', 'Choose a playback rate between 0.5× and 2×.')
      }
      state.positionMs = this.expectedPosition(state, now)
      state.playbackRate = parsed.playbackRate
      this.addActivity(state, `${member.displayName} changed playback speed to ${parsed.playbackRate}×.`)
    } else {
      return this.reject(socket, 'UNSUPPORTED_EVENT', 'This room action is not available yet.')
    }
    state.stateUpdatedAt = now
    state.revision += 1
    const command: WatchPartyPlaybackCommand = {
      reason: commandReason,
      executeAtServerMs: now + EXTENSION_COMMAND_LEAD_MS,
    }
    await this.persistAndBroadcast(state, 'playback:state', { eventId: parsed.eventId, command })
  }

  async webSocketClose(socket: WebSocket) {
    const attachment = readAttachment(socket)
    if (!isAuthenticatedAttachment(attachment)) {
      const state = await this.readState()
      if (state) await this.schedule(state)
      return
    }
    const state = await this.readState()
    if (!state) return
    const member = state.participants.find((candidate) => candidate.id === attachment.memberId)
    if (!member) return
    const hasAnotherConnection = this.ctx.getWebSockets().some((candidate) => {
      if (candidate === socket || candidate.readyState !== WebSocket.OPEN) return false
      const candidateAttachment = readAttachment(candidate)
      return isAuthenticatedAttachment(candidateAttachment) && candidateAttachment.memberId === member.id
    })
    if (!hasAnotherConnection) {
      member.connectionStatus = 'reconnecting'
      if (member.id === state.hostId) member.hostAbsentAt = Date.now()
      this.addActivity(state, `${member.displayName} disconnected.`)
      state.revision += 1
      await this.writeState(state)
      await this.schedule(state)
      this.broadcast(this.event(state, 'room:state'))
    }
  }

  async alarm() {
    const state = await this.readState()
    if (!state || state.playbackState === 'ended') return
    const now = Date.now()
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = readAttachment(socket)
      if (
        attachment?.clientType === 'browser-extension'
        && !attachment.authenticated
        && attachment.authDeadline <= now
      ) {
        socket.close(4401, 'Extension authentication timed out')
      }
    }
    state.usedExtensionTokenIds = state.usedExtensionTokenIds.filter((entry) => entry.expiresAt > now)
    if (state.settings.expiresAt !== null && state.settings.expiresAt <= now) {
      state.playbackState = 'ended'
      state.revision += 1
      this.addActivity(state, 'The room expired.')
      await this.writeState(state)
      await this.env.DB.prepare('UPDATE watch_rooms SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?')
        .bind('expired', now, now, state.roomId).run()
      this.broadcast({ type: 'room:ended', revision: state.revision, serverNow: now })
      return
    }
    const host = state.participants.find((member) => member.id === state.hostId)
    if (host?.hostAbsentAt && host.hostAbsentAt + HOST_GRACE_MS <= now) {
      const replacement = state.participants
        .filter((member) => member.id !== host.id && member.connectionStatus === 'connected')
        .sort((left, right) => (right.role === 'moderator' ? 1 : 0) - (left.role === 'moderator' ? 1 : 0) || left.joinedAt - right.joinedAt)[0]
      if (replacement) {
        host.role = 'participant'
        host.canControl = false
        replacement.role = 'host'
        replacement.canControl = true
        state.hostId = replacement.id
        state.hostEpoch += 1
        state.revision += 1
        this.addActivity(state, `Host control transferred to ${replacement.displayName}.`)
        await this.persistAndBroadcast(state)
      }
    }
    await this.schedule(state)
  }
}
