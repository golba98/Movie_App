import { normalizeHttpOrigin } from '../origins'
import { TRUSTED_APP_ORIGINS } from '../protocol'
import type { AuthoritativeState, InternalMessage, PopupViewState } from '../types'
import {
  allCandidates,
  currentTarget,
  enableOrigins,
  handleFrameMessage,
  scanOrigins,
  selectTargetManually,
  senderOrigin,
  shutdownAllFrames,
  shutdownOrigins,
} from './frames'
import { closeSocket, currentRoomState, decodeMemberId, playbackRequest, sendRoomEvent, setStatus, startConnection } from './room-socket'
import { diagnostics, persistPreferences, persistSession, preferences, session } from './store'

const DEFAULT_DEV_HOST = 'http://127.0.0.1:4173'

type MessageOf<Type extends InternalMessage['type']> = Extract<InternalMessage, { type: Type }>
type Handler<Type extends InternalMessage['type']> = (message: MessageOf<Type>, sender: chrome.runtime.MessageSender) => Promise<unknown>

const isTrusted = (origin: string | null): origin is string => origin !== null && TRUSTED_APP_ORIGINS.includes(origin)

async function disconnect() {
  closeSocket(true)
  shutdownAllFrames()
  await setStatus('disconnected', 'Companion disconnected.')
}

async function popupState(): Promise<PopupViewState> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabId = tab?.id ?? null
  const origins = tabId === null ? { topOrigin: null, embeddedOrigins: [] } : await scanOrigins(tabId)
  const granted = await chrome.permissions.getAll()
  const grantedOrigins = (granted.origins ?? []).flatMap((pattern) => {
    const normalized = normalizeHttpOrigin(pattern.replace(/\/\*$/, '/'))
    return normalized ? [normalized] : []
  })
  // Forget enabled origins whose permission the viewer has since revoked.
  if (origins.topOrigin) {
    const actual = new Set(grantedOrigins)
    const saved = preferences.selectedOriginsByTopOrigin[origins.topOrigin] ?? []
    const reconciled = saved.filter((origin) => actual.has(origin))
    if (reconciled.length !== saved.length) {
      preferences.selectedOriginsByTopOrigin[origins.topOrigin] = reconciled
      await persistPreferences()
    }
  }
  return {
    socketStatus: session.status,
    socketMessage: session.message,
    roomId: session.roomId,
    role: session.role,
    revision: session.revision,
    positionMs: currentRoomState()?.positionMs ?? 0,
    driftMs: session.driftMs,
    reconnectAttempt: session.reconnectAttempt,
    tabId,
    topOrigin: origins.topOrigin,
    embeddedOrigins: origins.embeddedOrigins,
    grantedOrigins: [...new Set(grantedOrigins)],
    candidates: allCandidates().filter((candidate) => tabId === null || candidate.tabId === tabId),
    selectedTarget: currentTarget(),
    diagnosticsEnabled: preferences.diagnosticsEnabled,
    playerState: session.playerState,
  }
}

// The app host for local dev-connect: the active tab, else the room tab, else the default preview server.
async function devConnectHost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const tabOrigin = tab?.url ? normalizeHttpOrigin(tab.url) : null
  if (isTrusted(tabOrigin)) return tabOrigin
  if (session.roomTabId !== null) {
    try {
      const roomTab = await chrome.tabs.get(session.roomTabId)
      const roomOrigin = roomTab.url ? normalizeHttpOrigin(roomTab.url) : null
      if (isTrusted(roomOrigin)) return roomOrigin
    } catch {
      // The room tab closed or is not accessible; use the default host.
    }
  }
  return DEFAULT_DEV_HOST
}

/** Local development: joins a room by code without the website, then connects. */
async function devConnect(message: MessageOf<'popup:dev-connect'>) {
  session.nonce = crypto.randomUUID()
  session.clientSessionId = session.clientSessionId || crypto.randomUUID()
  const baseUrl = (await devConnectHost()).replace(/\/$/, '')
  const socketBase = baseUrl.replace(/^https?:\/\//, baseUrl.startsWith('https://') ? 'wss://' : 'ws://')
  const response = await fetch(`${baseUrl}/api/watch-party/extension/dev-connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      roomCode: message.roomCode,
      displayName: message.displayName,
      password: message.password,
      nonce: session.nonce,
      clientSessionId: session.clientSessionId,
      capabilityVersion: 1,
    }),
  })
  const payload = await response.json() as {
    data?: { extensionToken: string; memberId: string; state: AuthoritativeState }
    error?: { message?: string }
  }
  if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? 'Local room connection failed.')
  const { state, memberId, extensionToken } = payload.data
  session.roomId = state.roomId
  session.memberId = memberId
  session.socketUrl = `${socketBase}/api/watch-party/rooms/${encodeURIComponent(state.roomId)}/extension-socket`
  session.extensionToken = extensionToken
  await startConnection(extensionToken)
  return { ok: true }
}

// The room page hands over a token (first connect, or a refresh after a reconnect).
async function acceptBridgeToken(message: MessageOf<'bridge:connect' | 'bridge:token'>, sender: chrome.runtime.MessageSender) {
  if (!isTrusted(senderOrigin(sender)) || sender.tab?.id === undefined) return { ok: false }
  if (message.clientSessionId !== session.clientSessionId || message.nonce !== session.nonce) return { ok: false }
  session.roomId = message.roomId
  session.socketUrl = message.socketUrl
  session.extensionToken = message.extensionToken
  session.memberId = decodeMemberId(message.extensionToken)
  session.roomTabId = sender.tab.id
  await startConnection(message.extensionToken)
  return { ok: true }
}

const disconnectHandler = async () => {
  await disconnect()
  return { ok: true }
}

const frameHandler = async (message: InternalMessage, sender: chrome.runtime.MessageSender) => {
  handleFrameMessage(message, sender)
  return { ok: true }
}

// Replies to each message type sent with chrome.runtime.sendMessage.
const handlers: { [Type in InternalMessage['type']]?: Handler<Type> } = {
  'bridge:hello': async (_message, sender) => {
    if (!isTrusted(senderOrigin(sender)) || sender.tab?.id === undefined) return undefined
    session.roomTabId = sender.tab.id
    session.nonce = crypto.randomUUID()
    if (!session.clientSessionId) session.clientSessionId = crypto.randomUUID()
    await persistSession()
    return { nonce: session.nonce, clientSessionId: session.clientSessionId }
  },
  'bridge:connect': acceptBridgeToken,
  'bridge:token': acceptBridgeToken,
  'bridge:disconnect': disconnectHandler,
  'popup:disconnect': disconnectHandler,
  'frame:candidates': frameHandler,
  'frame:local-intent': frameHandler,
  'frame:snapshot': frameHandler,
  'frame:activation-required': frameHandler,
  'frame:unavailable': frameHandler,
  'popup:get-state': () => popupState(),
  'popup:rescan': async (message) => ({ state: await popupState(), ...await enableOrigins(message.tabId, message.grantedOrigins) }),
  'popup:enable': (message) => enableOrigins(message.tabId, message.origins),
  'popup:shutdown-origins': async (message) => {
    await shutdownOrigins(message.tabId, message.origins)
    return { ok: true }
  },
  'popup:select-target': async (message) => ({ ok: selectTargetManually(message.target) }),
  'popup:control': async (message) => ({ ok: sendRoomEvent(playbackRequest(message.intent, message.positionMs, message.playbackRate)) }),
  'popup:dev-connect': devConnect,
  'popup:set-diagnostics': async (message) => {
    preferences.diagnosticsEnabled = message.enabled
    await persistPreferences()
    return { ok: true }
  },
  'popup:get-diagnostics': async () => ({ generatedAt: Date.now(), entries: diagnostics.export() }),
}

/** Runs the handler for a validated message; resolves undefined for types nobody answers. */
export function handleMessage(message: InternalMessage, sender: chrome.runtime.MessageSender) {
  const handler = handlers[message.type] as Handler<typeof message.type> | undefined
  return handler ? handler(message as never, sender) : Promise.resolve(undefined)
}
