import { DurableObject } from 'cloudflare:workers'
import { formatClock } from '../../src/lib/format'
import { expectedPlaybackPosition } from '../../src/features/watch-party/sync'
import type {
  WatchPartyClientEvent,
  WatchPartyClientType,
  WatchPartyPlaybackCommand,
  WatchPartyServerEvent,
} from '../../src/types/watch-party'
import {
  isAuthenticatedAttachment,
  isIdentifier,
  isPendingExtension,
  isWatchPartyClientEvent,
  readAttachment,
  serialise,
  type AuthenticatedAttachment,
  type ExtensionConnectionAttachment,
  type InternalState,
  type PendingExtensionConnectionAttachment,
  type RoomInitialization,
  type RoomJoinInput,
  type RoomMember,
  type WebsiteConnectionAttachment,
} from './protocol'
import { readWatchPartyToken, type WatchPartyExtensionTokenPayload } from './tokens'

const STATE_KEY = 'watch-party-state'
// How long a disconnected host keeps the role before it passes to someone else.
const HOST_GRACE_MS = 2 * 60 * 1000
const EMPTY_ROOM_CLEANUP_MS = 15 * 60 * 1000
const EXTENSION_AUTH_TIMEOUT_MS = 10_000
// Extensions schedule playback commands slightly ahead so every tab acts together.
const EXTENSION_COMMAND_LEAD_MS = 120
const MAX_EVENT_BYTES = 8_000
const MAX_ACTIVITY = 40
const MAX_PROCESSED_EVENTS = 200

type RoomEvent = Exclude<WatchPartyClientEvent, { type: 'extension:authenticate' | 'playback:client-snapshot' }>
type EventOf<Type extends RoomEvent['type']> = Extract<RoomEvent, { type: Type }>
type PlaybackEvent = EventOf<'playback:play-request' | 'playback:pause-request' | 'playback:seek-request' | 'playback:restart-request' | 'playback:rate-request'>

interface EventContext<Event> {
  socket: WebSocket
  state: InternalState
  member: RoomMember
  event: Event
}

/**
 * One watch party room. Holds the authoritative playback state, accepts
 * members' WebSockets (the website and the companion extension), and
 * broadcasts every change. State survives hibernation in Durable Object storage.
 */
export class WatchPartyRoom extends DurableObject<Env> {
  // --- Storage and broadcasting ---

  private async readState() {
    const state = await this.ctx.storage.get<InternalState>(STATE_KEY)
    // Rooms stored before extension tokens existed lack the replay list.
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
    state.activity = [...state.activity, activity].slice(-MAX_ACTIVITY)
    return activity
  }

  /** Wakes the room for its next deadline: expiry, host hand-over, extension auth, or empty-room cleanup. */
  private async schedule(state: InternalState) {
    const sockets = this.ctx.getWebSockets()
    const deadlines = [
      ...(state.settings.expiresAt !== null ? [state.settings.expiresAt] : []),
      ...state.participants
        .filter((member) => member.id === state.hostId && member.hostAbsentAt !== null)
        .map((member) => member.hostAbsentAt! + HOST_GRACE_MS),
      ...sockets
        .map((socket) => readAttachment(socket))
        .filter(isPendingExtension)
        .map((attachment) => attachment.authDeadline),
    ]
    if (!sockets.some((socket) => socket.readyState === WebSocket.OPEN)) deadlines.push(Date.now() + EMPTY_ROOM_CLEANUP_MS)
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines))
  }

  private async endRoom(state: InternalState, status: 'ended' | 'expired', now: number) {
    await this.writeState(state)
    await this.env.DB.prepare('UPDATE watch_rooms SET status = ?, ended_at = ?, updated_at = ? WHERE id = ?')
      .bind(status, now, now, state.roomId).run()
    this.broadcast({ type: 'room:ended', revision: state.revision, serverNow: now })
  }

  private transferHost(state: InternalState, from: RoomMember, to: RoomMember) {
    from.role = 'participant'
    from.canControl = false
    to.role = 'host'
    to.canControl = true
    state.hostId = to.id
    state.hostEpoch += 1
    state.revision += 1
    this.addActivity(state, `Host control transferred to ${to.displayName}.`)
  }

  private socketsOf(memberId: string) {
    return this.ctx.getWebSockets().filter((socket) => {
      const attachment = readAttachment(socket)
      return isAuthenticatedAttachment(attachment) && attachment.memberId === memberId
    })
  }

  // --- RPC from the Worker ---

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

  // --- WebSocket connections ---

  private reject(socket: WebSocket, code: string, message: string, revision?: number) {
    socket.send(JSON.stringify({ type: 'error', code, message, ...(revision === undefined ? {} : { revision }) }))
  }

  private closeAuthentication(socket: WebSocket, code: string, message: string) {
    this.reject(socket, code, message)
    socket.close(4401, message)
  }

  private async markConnected(socket: WebSocket, state: InternalState, member: RoomMember) {
    member.connectionStatus = 'connected'
    member.hostAbsentAt = null
    await this.writeState(state)
    socket.send(JSON.stringify(this.event(state, 'room:joined')))
    this.broadcast(this.event(state, 'room:state'))
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

    // Each token works once.
    state.usedExtensionTokenIds = state.usedExtensionTokenIds.filter((entry) => entry.expiresAt > now)
    if (state.usedExtensionTokenIds.some((entry) => entry.tokenId === token.tokenId)) {
      return this.closeAuthentication(socket, 'TOKEN_REPLAYED', 'Extension token was already used.')
    }
    state.usedExtensionTokenIds.push({ tokenId: token.tokenId, expiresAt: token.expiresAt })

    // A reconnecting extension replaces its own earlier socket.
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
    socket.serializeAttachment({
      memberId: token.memberId,
      clientType: 'browser-extension',
      authenticated: true,
      capabilityVersion: token.capabilityVersion,
      extensionOrigin: attachment.extensionOrigin,
      clientSessionId: token.clientSessionId,
    } satisfies ExtensionConnectionAttachment)
    await this.markConnected(socket, state, member)
    await this.schedule(state)
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Upgrade required', { status: 426 })
    const clientType = (request.headers.get('X-Watch-Party-Client-Type') ?? 'website') as WatchPartyClientType
    if (clientType !== 'website' && clientType !== 'browser-extension') return new Response('Forbidden', { status: 403 })
    const memberId = request.headers.get('X-Watch-Party-Member')
    if (clientType === 'website' && (!memberId || !(await this.authorise(memberId)))) return new Response('Forbidden', { status: 403 })

    const [client, server] = Object.values(new WebSocketPair())
    this.ctx.acceptWebSocket(server)
    const state = await this.readState()
    if (clientType === 'browser-extension') {
      // The extension must authenticate with its token before the deadline.
      server.serializeAttachment({
        clientType: 'browser-extension',
        authenticated: false,
        capabilityVersion: 1,
        extensionOrigin: request.headers.get('X-Watch-Party-Extension-Origin') ?? '',
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
      if (member) await this.markConnected(server, state, member)
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

    if (isPendingExtension(attachment)) {
      if (parsed.type !== 'extension:authenticate') return this.closeAuthentication(socket, 'AUTH_REQUIRED', 'Authenticate before sending room events.')
      return this.authenticateExtension(socket, attachment, parsed, state)
    }
    if (!isAuthenticatedAttachment(attachment)) return this.reject(socket, 'AUTH_REQUIRED', 'Reconnect to the room.')
    if (parsed.type === 'extension:authenticate') return this.reject(socket, 'ALREADY_AUTHENTICATED', 'The extension is already authenticated.')
    const member = state.participants.find((candidate) => candidate.id === attachment.memberId)
    if (!member) return this.reject(socket, 'AUTH_REQUIRED', 'Reconnect to the room.')
    if (parsed.type === 'playback:client-snapshot') return this.storeSnapshot(socket, attachment, parsed)

    // Retries of an event already applied are ignored; events based on an old
    // revision are refused so the client resynchronises first.
    if (state.processedEventIds.includes(parsed.eventId)) return
    if (parsed.type !== 'room:sync-request' && parsed.baseRevision !== state.revision) {
      return this.reject(socket, 'STALE_REVISION', 'The room changed. Synchronizing now.', state.revision)
    }
    if (state.processedEventIds.length >= MAX_PROCESSED_EVENTS) state.processedEventIds.shift()
    state.processedEventIds.push(parsed.eventId)

    const context = { socket, state, member, event: parsed }
    const handler = this.roomHandlers[parsed.type as keyof typeof this.roomHandlers] as
      | ((context: EventContext<RoomEvent>) => Promise<void>)
      | undefined
    if (handler) return handler(context)
    if (!this.canControl(state, member)) return this.reject(socket, 'CONTROL_FORBIDDEN', 'Only permitted participants can control playback.')
    return this.applyPlayback(context as EventContext<PlaybackEvent>)
  }

  private storeSnapshot(
    socket: WebSocket,
    attachment: AuthenticatedAttachment,
    event: Extract<WatchPartyClientEvent, { type: 'playback:client-snapshot' }>,
  ) {
    if (attachment.clientType !== 'browser-extension') {
      return this.reject(socket, 'FORBIDDEN', 'Snapshots are accepted from the browser extension only.')
    }
    const { positionMs, playbackState, playbackRate, buffering, readyState, driftMs } = event
    socket.serializeAttachment({
      ...attachment,
      latestSnapshot: { positionMs, playbackState, playbackRate, buffering, readyState, driftMs },
    } satisfies ExtensionConnectionAttachment)
  }

  private canControl(state: InternalState, member: RoomMember) {
    return member.id === state.hostId || state.settings.controlMode === 'everyone' || member.canControl
  }

  private requireHost(socket: WebSocket, state: InternalState, member: RoomMember, message: string) {
    if (member.id === state.hostId) return true
    this.reject(socket, 'FORBIDDEN', message)
    return false
  }

  // Room events that are not playback commands, keyed by event type.
  private readonly roomHandlers: { [Type in Exclude<RoomEvent['type'], PlaybackEvent['type']>]: (context: EventContext<EventOf<Type>>) => Promise<void> } = {
    'room:sync-request': async ({ socket, state, event }) => {
      await this.writeState(state)
      socket.send(JSON.stringify(this.event(state, 'playback:sync', { eventId: event.eventId })))
    },

    'room:ready': async ({ state, member, event }) => {
      member.ready = event.ready
      state.revision += 1
      this.addActivity(state, `${member.displayName} is ${event.ready ? 'ready' : 'not ready'}.`)
      await this.persistAndBroadcast(state)
    },

    'playback:buffering': async ({ state, member, event }) => {
      member.buffering = event.buffering
      member.syncStatus = event.buffering ? 'buffering' : 'synchronized'
      state.revision += 1
      await this.persistAndBroadcast(state)
    },

    'control:request': async ({ state, member }) => {
      this.addActivity(state, `${member.displayName} requested playback control.`)
      state.revision += 1
      await this.persistAndBroadcast(state)
    },

    'control:grant': async ({ socket, state, member, event }) => {
      if (!this.requireHost(socket, state, member, 'Only the host can change control permissions.')) return
      const target = state.participants.find((candidate) => candidate.id === event.participantId)
      if (!target) return this.reject(socket, 'PARTICIPANT_NOT_FOUND', 'Participant not found.')
      target.canControl = event.canControl
      state.revision += 1
      this.addActivity(state, `${target.displayName} ${event.canControl ? 'can now control playback' : 'can no longer control playback'}.`)
      await this.persistAndBroadcast(state)
    },

    'host:transfer': async ({ socket, state, member, event }) => {
      if (!this.requireHost(socket, state, member, 'Only the host can transfer ownership.')) return
      const target = state.participants.find((candidate) => candidate.id === event.participantId && candidate.connectionStatus === 'connected')
      if (!target || target.id === member.id) return this.reject(socket, 'PARTICIPANT_NOT_FOUND', 'Choose a connected participant.')
      this.transferHost(state, member, target)
      await this.persistAndBroadcast(state)
    },

    'room:lock': async ({ socket, state, member, event }) => {
      if (!this.requireHost(socket, state, member, 'Only the host can lock the room.')) return
      state.settings.locked = event.locked
      state.revision += 1
      this.addActivity(state, `The room is ${event.locked ? 'locked' : 'unlocked'}.`)
      await this.persistAndBroadcast(state)
    },

    'room:end': async ({ socket, state, member }) => {
      if (!this.requireHost(socket, state, member, 'Only the host can end the room.')) return
      state.playbackState = 'ended'
      state.stateUpdatedAt = Date.now()
      state.revision += 1
      this.addActivity(state, `${member.displayName} ended the room.`)
      await this.endRoom(state, 'ended', Date.now())
    },

    'participant:remove': async ({ socket, state, member, event }) => {
      if (member.id !== state.hostId && member.role !== 'moderator') {
        return this.reject(socket, 'FORBIDDEN', 'Host or moderator permission is required.')
      }
      const target = state.participants.find((candidate) => candidate.id === event.participantId)
      if (!target || target.id === state.hostId) return this.reject(socket, 'PARTICIPANT_NOT_FOUND', 'Participant not found.')
      state.participants = state.participants.filter((candidate) => candidate.id !== target.id)
      state.revision += 1
      this.addActivity(state, `${target.displayName} was ${event.ban ? 'banned' : 'removed'} from the room.`)
      if (event.ban) {
        await this.env.DB.prepare('INSERT OR REPLACE INTO watch_room_bans (room_id, principal_id, created_by_member_id, created_at) VALUES (?, ?, ?, ?)')
          .bind(state.roomId, target.principalId, member.id, Date.now()).run()
      }
      for (const targetSocket of this.socketsOf(target.id)) targetSocket.close(4003, 'Removed from room')
      await this.persistAndBroadcast(state)
    },
  }

  private async applyPlayback({ socket, state, member, event }: EventContext<PlaybackEvent>) {
    const now = Date.now()
    let reason: WatchPartyPlaybackCommand['reason']
    switch (event.type) {
      case 'playback:play-request':
        reason = 'play'
        state.positionMs = expectedPlaybackPosition(state, now)
        state.playbackState = 'playing'
        this.addActivity(state, `${member.displayName} resumed playback.`)
        break
      case 'playback:pause-request':
        reason = 'pause'
        state.positionMs = expectedPlaybackPosition(state, now)
        state.playbackState = 'paused'
        this.addActivity(state, `${member.displayName} paused the movie.`)
        break
      case 'playback:seek-request':
        reason = 'seek'
        state.positionMs = Math.max(0, Math.floor(event.positionMs))
        this.addActivity(state, `${member.displayName} skipped to ${formatClock(state.positionMs / 1000)}.`)
        break
      case 'playback:restart-request':
        reason = 'restart'
        state.positionMs = 0
        state.playbackState = 'paused'
        this.addActivity(state, `${member.displayName} restarted playback.`)
        break
      case 'playback:rate-request':
        reason = 'rate'
        if (!Number.isFinite(event.playbackRate) || event.playbackRate < 0.5 || event.playbackRate > 2) {
          return this.reject(socket, 'INVALID_RATE', 'Choose a playback rate between 0.5× and 2×.')
        }
        state.positionMs = expectedPlaybackPosition(state, now)
        state.playbackRate = event.playbackRate
        this.addActivity(state, `${member.displayName} changed playback speed to ${event.playbackRate}×.`)
        break
      default:
        return this.reject(socket, 'UNSUPPORTED_EVENT', 'This room action is not available yet.')
    }
    state.stateUpdatedAt = now
    state.revision += 1
    const command: WatchPartyPlaybackCommand = { reason, executeAtServerMs: now + EXTENSION_COMMAND_LEAD_MS }
    await this.persistAndBroadcast(state, 'playback:state', { eventId: event.eventId, command })
  }

  async webSocketClose(socket: WebSocket) {
    const attachment = readAttachment(socket)
    const state = await this.readState()
    if (!isAuthenticatedAttachment(attachment)) {
      if (state) await this.schedule(state)
      return
    }
    if (!state) return
    const member = state.participants.find((candidate) => candidate.id === attachment.memberId)
    if (!member) return
    // A member with another open tab or extension socket is still here.
    const stillConnected = this.socketsOf(member.id).some((candidate) => candidate !== socket && candidate.readyState === WebSocket.OPEN)
    if (stillConnected) return

    member.connectionStatus = 'reconnecting'
    if (member.id === state.hostId) member.hostAbsentAt = Date.now()
    this.addActivity(state, `${member.displayName} disconnected.`)
    state.revision += 1
    await this.writeState(state)
    await this.schedule(state)
    this.broadcast(this.event(state, 'room:state'))
  }

  async alarm() {
    const state = await this.readState()
    if (!state || state.playbackState === 'ended') return
    const now = Date.now()
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = readAttachment(socket)
      if (isPendingExtension(attachment) && attachment.authDeadline <= now) socket.close(4401, 'Extension authentication timed out')
    }
    state.usedExtensionTokenIds = state.usedExtensionTokenIds.filter((entry) => entry.expiresAt > now)

    if (state.settings.expiresAt !== null && state.settings.expiresAt <= now) {
      state.playbackState = 'ended'
      state.revision += 1
      this.addActivity(state, 'The room expired.')
      return this.endRoom(state, 'expired', now)
    }

    // An absent host hands over to a connected moderator, else the longest-standing member.
    const host = state.participants.find((member) => member.id === state.hostId)
    if (host?.hostAbsentAt && host.hostAbsentAt + HOST_GRACE_MS <= now) {
      const replacement = state.participants
        .filter((member) => member.id !== host.id && member.connectionStatus === 'connected')
        .sort((left, right) => (right.role === 'moderator' ? 1 : 0) - (left.role === 'moderator' ? 1 : 0) || left.joinedAt - right.joinedAt)[0]
      if (replacement) {
        this.transferHost(state, host, replacement)
        await this.persistAndBroadcast(state)
      }
    }
    await this.schedule(state)
  }
}
