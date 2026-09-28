import { ClockEstimator, localEpochMs } from '../clock'
import { reconnectDelayMs } from '../reconnect'
import {
  isRoomServerEvent,
  type AuthoritativeState,
  type InternalMessage,
  type PlaybackCommandMetadata,
  type SocketStatus,
} from '../types'
import { diagnostics, persistSession, session } from './store'

const KEEPALIVE_MS = 20_000
const MAX_PENDING_SYNC_REQUESTS = 16
// Server errors that mean the token is spent; retrying cannot help.
const FATAL_AUTH_ERRORS = ['AUTH_INVALID', 'AUTH_TIMEOUT', 'TOKEN_REPLAYED', 'AUTH_REQUIRED']

let socket: WebSocket | null = null
let keepaliveTimer: number | null = null
let reconnectTimer: number | null = null
let authoritativeState: AuthoritativeState | null = null
let stateListener: (state: AuthoritativeState, command?: PlaybackCommandMetadata) => void = () => undefined
export const clock = new ClockEstimator()
// Sync requests in flight, by event id, with their local send time for clock sampling.
const syncRequests = new Map<string, number>()

export const currentRoomState = () => authoritativeState

/** Receives every accepted room state, e.g. to forward it to the controlled player. */
export function onRoomState(listener: typeof stateListener) {
  stateListener = listener
}

async function notifyBridge(status: SocketStatus, message: string) {
  if (session.roomTabId === null) return
  try {
    await chrome.tabs.sendMessage(session.roomTabId, {
      type: 'background:status',
      status,
      message,
      clientSessionId: session.clientSessionId,
    } satisfies InternalMessage)
  } catch {
    // A closed or reloading room tab is surfaced by reconnectTokenFromRoom().
  }
}

export async function setStatus(status: SocketStatus, message: string) {
  session.status = status
  session.message = message
  await persistSession()
  await notifyBridge(status, message)
  diagnostics.add({ kind: 'socket-status', socketState: status, message, reconnectAttempt: session.reconnectAttempt })
}

function stopKeepalive() {
  if (keepaliveTimer !== null) clearInterval(keepaliveTimer)
  keepaliveTimer = null
}

function sendRaw(event: Record<string, unknown>) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false
  socket.send(JSON.stringify(event))
  return true
}

export function sendRoomEvent(event: Record<string, unknown>) {
  return sendRaw({ ...event, eventId: crypto.randomUUID(), baseRevision: session.revision })
}

/** A player intent (from the controlled video or the popup) as a room request. */
export function playbackRequest(intent: 'play' | 'pause' | 'seek' | 'restart' | 'rate', positionMs?: number, playbackRate?: number) {
  if (intent === 'seek') return { type: 'playback:seek-request', positionMs }
  if (intent === 'rate') return { type: 'playback:rate-request', playbackRate }
  return { type: `playback:${intent}-request` }
}

// Doubles as the keepalive, and each reply is a clock-offset sample.
function requestSync() {
  const eventId = crypto.randomUUID()
  syncRequests.set(eventId, localEpochMs())
  sendRaw({ type: 'room:sync-request', eventId, baseRevision: session.revision })
  if (syncRequests.size > MAX_PENDING_SYNC_REQUESTS) syncRequests.delete(syncRequests.keys().next().value ?? '')
}

function startKeepalive() {
  stopKeepalive()
  keepaliveTimer = setInterval(requestSync, KEEPALIVE_MS) as unknown as number
}

/** The member id inside an extension token (the payload half is plain base64url JSON). */
export function decodeMemberId(token: string) {
  try {
    const payload = token.split('.', 1)[0].replaceAll('-', '+').replaceAll('_', '/')
    const decoded = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { memberId?: unknown }
    return typeof decoded.memberId === 'string' ? decoded.memberId : null
  } catch {
    return null
  }
}

function applyServerState(state: AuthoritativeState, command?: PlaybackCommandMetadata) {
  if (state.revision < session.revision) return
  authoritativeState = state
  session.revision = state.revision
  const member = session.memberId ? state.participants.find((participant) => participant.id === session.memberId) : null
  session.role = member?.role ?? null
  void persistSession()
  stateListener(state, command)
}

// Resolves true when the message carried room state, which proves the socket is authenticated.
async function handleSocketMessage(event: MessageEvent) {
  let parsed: unknown
  try {
    parsed = JSON.parse(String(event.data))
  } catch {
    diagnostics.add({ kind: 'socket-error', message: 'Malformed server event' })
    return false
  }
  if (!isRoomServerEvent(parsed)) return false
  if (parsed.type === 'error') {
    diagnostics.add({ kind: 'socket-error', message: parsed.code, revision: parsed.revision })
    if (parsed.code === 'STALE_REVISION' && typeof parsed.revision === 'number') {
      session.revision = parsed.revision
      requestSync()
      return false
    }
    if (FATAL_AUTH_ERRORS.includes(parsed.code)) {
      session.retryStopped = true
      socket?.close(4401, 'Authentication failed')
      await setStatus('error', 'Authentication failed. Reopen the watch-party room and connect again.')
    }
    return false
  }
  if (parsed.type === 'room:ended') {
    session.retryStopped = true
    socket?.close(4000, 'Room ended')
    await setStatus('disconnected', 'The watch-party room ended.')
    return false
  }
  const sentAt = parsed.eventId ? syncRequests.get(parsed.eventId) : undefined
  if (parsed.eventId && sentAt !== undefined) {
    clock.addSample(sentAt, localEpochMs(), parsed.state.serverNow)
    syncRequests.delete(parsed.eventId)
  }
  applyServerState(parsed.state, parsed.command)
  return true
}

/** Tokens are single-use, so reconnecting asks the room page for a fresh one. */
export async function reconnectTokenFromRoom(generation: number) {
  if (generation !== session.reconnectGeneration || session.roomTabId === null) return
  session.nonce = crypto.randomUUID()
  await persistSession()
  try {
    await chrome.tabs.sendMessage(session.roomTabId, {
      type: 'background:token-request',
      nonce: session.nonce,
      clientSessionId: session.clientSessionId,
    } satisfies InternalMessage)
  } catch {
    session.retryStopped = true
    await setStatus('error', 'Reopen the watch-party room to reconnect.')
  }
}

function scheduleReconnect(generation: number) {
  if (session.userDisconnected || session.retryStopped || generation !== session.reconnectGeneration) return
  session.reconnectAttempt += 1
  const delay = reconnectDelayMs(session.reconnectAttempt - 1)
  void setStatus('reconnecting', `Connection interrupted. Retrying in ${Math.ceil(delay / 1_000)}s…`)
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => void reconnectTokenFromRoom(generation), delay) as unknown as number
}

export async function connectSocket(extensionToken: string, generation = session.reconnectGeneration) {
  if (!session.socketUrl || !session.roomId || generation !== session.reconnectGeneration) return
  socket?.close(4000, 'Superseded')
  stopKeepalive()
  await setStatus('connecting', 'Authenticating the room companion…')
  const nextSocket = new WebSocket(session.socketUrl)
  socket = nextSocket
  nextSocket.onopen = () => {
    if (generation !== session.reconnectGeneration || socket !== nextSocket) return nextSocket.close(4000, 'Stale connection')
    nextSocket.send(JSON.stringify({
      type: 'extension:authenticate',
      token: extensionToken,
      nonce: session.nonce,
      clientSessionId: session.clientSessionId,
      capabilityVersion: 1,
    }))
    session.extensionToken = null
    session.reconnectAttempt = 0
    void persistSession()
    startKeepalive()
  }
  nextSocket.onmessage = (event) => {
    void handleSocketMessage(event).then((authenticated) => {
      if (authenticated && session.status !== 'connected') {
        void setStatus('connected', 'Companion connected. Select a player tab if one is not already active.')
      }
    })
  }
  nextSocket.onerror = () => nextSocket.close()
  nextSocket.onclose = () => {
    if (socket === nextSocket) socket = null
    stopKeepalive()
    scheduleReconnect(generation)
  }
}

/** Starts a fresh connection generation with a newly issued token. */
export async function startConnection(extensionToken: string) {
  session.userDisconnected = false
  session.retryStopped = false
  session.reconnectGeneration += 1
  await persistSession()
  void connectSocket(extensionToken, session.reconnectGeneration)
}

export function closeSocket(userInitiated: boolean) {
  session.reconnectGeneration += 1
  session.userDisconnected = userInitiated
  session.retryStopped = userInitiated
  session.extensionToken = null
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
  stopKeepalive()
  socket?.close(4000, 'Disconnected by user')
  socket = null
}
