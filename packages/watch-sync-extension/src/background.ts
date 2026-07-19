import playerControllerFile from './content/player-controller.ts?iife'
import { ClockEstimator, localEpochMs } from './clock'
import { DiagnosticRing } from './diagnostics'
import { discoverFrameOrigins, normalizeHttpOrigin, originPattern } from './origins'
import { reconnectDelayMs } from './reconnect'
import { chooseCandidate } from './scoring'
import {
  isInternalMessage,
  isRoomServerEvent,
  type AuthoritativeState,
  type CandidateSummary,
  type ControllerTarget,
  type FrameTarget,
  type InternalMessage,
  type PlaybackCommandMetadata,
  type PopupViewState,
  type SocketStatus,
} from './types'

const SESSION_KEY = 'watchSyncRoomSession'
const LOCAL_KEY = 'watchSyncPreferences'
const trustedAppOrigins = new Set([
  'https://movie-app.jordanvorster404.workers.dev',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
])

interface StoredSession {
  roomId: string | null
  memberId: string | null
  socketUrl: string | null
  extensionToken: string | null
  nonce: string
  clientSessionId: string
  roomTabId: number | null
  status: SocketStatus
  message: string
  reconnectAttempt: number
  reconnectGeneration: number
  revision: number
  role: string | null
  driftMs: number | null
  playerState: PopupViewState['playerState']
  userDisconnected: boolean
  retryStopped: boolean
}

interface LocalPreferences {
  selectedOriginsByTopOrigin: Record<string, string[]>
  diagnosticsEnabled: boolean
}

const emptySession = (): StoredSession => ({
  roomId: null,
  memberId: null,
  socketUrl: null,
  extensionToken: null,
  nonce: crypto.randomUUID(),
  clientSessionId: crypto.randomUUID(),
  roomTabId: null,
  status: 'idle',
  message: 'Open a Fedora Movies watch-party room to connect.',
  reconnectAttempt: 0,
  reconnectGeneration: 0,
  revision: 0,
  role: null,
  driftMs: null,
  playerState: 'unavailable',
  userDisconnected: false,
  retryStopped: false,
})

const emptyLocal = (): LocalPreferences => ({ selectedOriginsByTopOrigin: {}, diagnosticsEnabled: false })

let session = emptySession()
let preferences = emptyLocal()
let hydrated: Promise<void> | null = null
let socket: WebSocket | null = null
let keepaliveTimer: number | null = null
let reconnectTimer: number | null = null
let authoritativeState: AuthoritativeState | null = null
let selectedTarget: ControllerTarget | null = null
let manualTarget: ControllerTarget | null = null
const framePorts = new Map<string, { port: chrome.runtime.Port; target: FrameTarget }>()
const candidatesByFrame = new Map<string, CandidateSummary[]>()
const clock = new ClockEstimator()
const syncRequests = new Map<string, number>()
const diagnostics = new DiagnosticRing(500)

function frameKey(target: Pick<FrameTarget, 'tabId' | 'frameId' | 'documentId'>) {
  return `${target.tabId}:${target.frameId}:${target.documentId}`
}

function senderOrigin(sender: chrome.runtime.MessageSender) {
  return sender.url ? normalizeHttpOrigin(sender.url) : null
}

async function hydrate() {
  if (hydrated) return hydrated
  hydrated = (async () => {
    const [storedSession, storedLocal] = await Promise.all([
      chrome.storage.session.get(SESSION_KEY),
      chrome.storage.local.get(LOCAL_KEY),
    ])
    session = { ...emptySession(), ...(storedSession[SESSION_KEY] as Partial<StoredSession> | undefined) }
    preferences = { ...emptyLocal(), ...(storedLocal[LOCAL_KEY] as Partial<LocalPreferences> | undefined) }
  })()
  return hydrated
}

async function persistSession() {
  await chrome.storage.session.set({ [SESSION_KEY]: session })
}

async function persistPreferences() {
  await chrome.storage.local.set({ [LOCAL_KEY]: preferences })
}

async function notifyBridge(status = session.status, message = session.message) {
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

async function setStatus(status: SocketStatus, message: string) {
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

function sendRoomEvent(event: Record<string, unknown>) {
  return sendRaw({
    ...event,
    eventId: crypto.randomUUID(),
    baseRevision: session.revision,
  })
}

function requestSync() {
  const eventId = crypto.randomUUID()
  syncRequests.set(eventId, localEpochMs())
  sendRaw({ type: 'room:sync-request', eventId, baseRevision: session.revision })
  if (syncRequests.size > 16) syncRequests.delete(syncRequests.keys().next().value ?? '')
}

function startKeepalive() {
  stopKeepalive()
  keepaliveTimer = setInterval(requestSync, 20_000) as unknown as number
}

function decodeMemberId(token: string) {
  try {
    const payload = token.split('.', 1)[0].replaceAll('-', '+').replaceAll('_', '/')
    const decoded = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { memberId?: unknown }
    return typeof decoded.memberId === 'string' ? decoded.memberId : null
  } catch {
    return null
  }
}

function selectedPort() {
  if (!selectedTarget) return null
  return framePorts.get(frameKey(selectedTarget))?.port ?? null
}

function routeAuthoritativeState(state: AuthoritativeState, command?: PlaybackCommandMetadata) {
  const port = selectedPort()
  if (!port) return
  port.postMessage({
    type: 'background:remote-command',
    state,
    command,
    clockOffsetMs: clock.estimate(),
  } satisfies InternalMessage)
}

function applyServerState(state: AuthoritativeState, command?: PlaybackCommandMetadata) {
  if (state.revision < session.revision) return
  authoritativeState = state
  session.revision = state.revision
  const member = session.memberId ? state.participants.find((participant) => participant.id === session.memberId) : null
  session.role = member?.role ?? null
  void persistSession()
  routeAuthoritativeState(state, command)
}

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
    if (['AUTH_INVALID', 'AUTH_TIMEOUT', 'TOKEN_REPLAYED', 'AUTH_REQUIRED'].includes(parsed.code)) {
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
  if (parsed.eventId) {
    const sentAt = syncRequests.get(parsed.eventId)
    if (sentAt !== undefined) {
      clock.addSample(sentAt, localEpochMs(), parsed.state.serverNow)
      syncRequests.delete(parsed.eventId)
    }
  }
  applyServerState(parsed.state, parsed.command)
  return true
}

async function reconnectTokenFromRoom(generation: number) {
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

async function connectSocket(extensionToken: string, generation = session.reconnectGeneration) {
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

async function disconnect(userInitiated = true) {
  session.reconnectGeneration += 1
  session.userDisconnected = userInitiated
  session.retryStopped = userInitiated
  session.extensionToken = null
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
  stopKeepalive()
  socket?.close(4000, 'Disconnected by user')
  socket = null
  for (const entry of framePorts.values()) entry.port.postMessage({ type: 'background:shutdown' } satisfies InternalMessage)
  await setStatus('disconnected', 'Companion disconnected.')
}

async function safeFrames(tabId: number) {
  const rawFrames = await chrome.webNavigation.getAllFrames({ tabId }) ?? []
  return rawFrames.flatMap((frame) => {
    const origin = normalizeHttpOrigin(frame.url)
    if (!origin) return []
    return [{ tabId, frameId: frame.frameId, documentId: frame.documentId ?? '', origin } satisfies FrameTarget]
  })
}

async function scanOrigins(tabId: number) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }) ?? []
  return discoverFrameOrigins(frames.map((frame) => ({ frameId: frame.frameId, url: frame.url })))
}

async function injectFrame(target: FrameTarget) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      files: [playerControllerFile],
      world: 'ISOLATED',
      injectImmediately: true,
    })
    const result = results[0]
    diagnostics.add({
      kind: 'controller-injected',
      tabId: target.tabId,
      frameId: result?.frameId ?? target.frameId,
      documentId: result?.documentId ?? target.documentId,
      origin: target.origin,
      controllerState: 'injected',
    })
    return { ok: true, documentId: result?.documentId ?? target.documentId }
  } catch (error) {
    diagnostics.add({
      kind: 'controller-inaccessible',
      tabId: target.tabId,
      frameId: target.frameId,
      documentId: target.documentId,
      origin: target.origin,
      controllerState: 'inaccessible',
      message: error instanceof Error ? error.message : 'Injection failed',
    })
    return { ok: false, documentId: target.documentId }
  }
}

async function enableOrigins(tabId: number, origins: string[]) {
  const { topOrigin } = await scanOrigins(tabId)
  if (!topOrigin) return { injected: 0, inaccessible: 0 }
  preferences.selectedOriginsByTopOrigin[topOrigin] = [...new Set(origins)]
  await persistPreferences()
  const frames = await safeFrames(tabId)
  const results = await Promise.all(frames.filter((frame) => origins.includes(frame.origin)).map((frame) => injectFrame(frame)))
  return { injected: results.filter((result) => result.ok).length, inaccessible: results.filter((result) => !result.ok).length }
}

async function shutdownOrigins(tabId: number, origins: string[]) {
  for (const [key, entry] of framePorts) {
    if (entry.target.tabId === tabId && origins.includes(entry.target.origin)) {
      entry.port.postMessage({ type: 'background:shutdown' } satisfies InternalMessage)
      framePorts.delete(key)
      candidatesByFrame.delete(key)
    }
  }
  const { topOrigin } = await scanOrigins(tabId)
  if (topOrigin) {
    preferences.selectedOriginsByTopOrigin[topOrigin] = (preferences.selectedOriginsByTopOrigin[topOrigin] ?? []).filter((origin) => !origins.includes(origin))
    await persistPreferences()
  }
}

function reconcileSelection() {
  const candidates = [...candidatesByFrame.values()].flat()
  const scored = candidates.map((candidate) => ({
    id: `${candidate.tabId}:${candidate.documentId}:${candidate.fingerprint}`,
    fingerprint: candidate.fingerprint,
    score: candidate.score,
    eligible: true,
    value: candidate,
  }))
  const manual = manualTarget ? { id: `${manualTarget.tabId}:${manualTarget.documentId}:${manualTarget.fingerprint}`, fingerprint: manualTarget.fingerprint } : null
  const choice = chooseCandidate(scored, manual)
  if (!choice.selected) {
    selectedTarget = null
    return
  }
  const candidate = choice.selected.value
  selectedTarget = {
    tabId: candidate.tabId,
    frameId: candidate.frameId,
    documentId: candidate.documentId,
    fingerprint: candidate.fingerprint,
    manual: choice.reason === 'manual-preserved',
  }
  const port = selectedPort()
  port?.postMessage({ type: 'background:select-target', fingerprint: candidate.fingerprint } satisfies InternalMessage)
  if (authoritativeState) routeAuthoritativeState(authoritativeState)
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
    positionMs: authoritativeState?.positionMs ?? 0,
    driftMs: session.driftMs,
    reconnectAttempt: session.reconnectAttempt,
    tabId,
    topOrigin: origins.topOrigin,
    embeddedOrigins: origins.embeddedOrigins,
    grantedOrigins: [...new Set(grantedOrigins)],
    candidates: [...candidatesByFrame.values()].flat().filter((candidate) => tabId === null || candidate.tabId === tabId),
    selectedTarget,
    diagnosticsEnabled: preferences.diagnosticsEnabled,
    playerState: session.playerState,
  }
}

function handleFrameMessage(message: InternalMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id
  const frameId = sender.frameId
  const documentId = sender.documentId
  const origin = senderOrigin(sender)
  if (tabId === undefined || frameId === undefined || !documentId || !origin) return
  const key = frameKey({ tabId, frameId, documentId })
  if (message.type === 'frame:candidates') {
    candidatesByFrame.set(key, message.candidates.map((candidate) => ({ ...candidate, tabId, frameId, documentId, origin })))
    diagnostics.add({ kind: 'candidate-update', tabId, frameId, documentId, origin, candidateCount: message.candidates.length })
    reconcileSelection()
  } else if (message.type === 'frame:local-intent') {
    const payload = message.intent === 'seek'
      ? { type: 'playback:seek-request', positionMs: message.positionMs }
      : message.intent === 'rate'
        ? { type: 'playback:rate-request', playbackRate: message.playbackRate }
        : { type: `playback:${message.intent}-request` }
    sendRoomEvent(payload)
  } else if (message.type === 'frame:snapshot') {
    session.driftMs = message.driftMs
    session.playerState = message.playbackState
    void persistSession()
    sendRoomEvent({ ...message, type: 'playback:client-snapshot' })
  } else if (message.type === 'frame:activation-required') {
    session.message = message.message
    void setStatus(session.status, message.message)
  } else if (message.type === 'frame:unavailable') {
    session.playerState = 'unavailable'
    diagnostics.add({ kind: 'player-unavailable', tabId, frameId, documentId, origin, message: message.reason })
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'watch-sync-player') return
  const tabId = port.sender?.tab?.id
  const frameId = port.sender?.frameId
  const documentId = port.sender?.documentId
  const origin = port.sender ? senderOrigin(port.sender) : null
  if (tabId === undefined || frameId === undefined || !documentId || !origin) return port.disconnect()
  const target = { tabId, frameId, documentId, origin }
  const key = frameKey(target)
  framePorts.set(key, { port, target })
  port.onMessage.addListener((message: unknown) => {
    if (!isInternalMessage(message)) return
    handleFrameMessage(message, port.sender!)
  })
  port.onDisconnect.addListener(() => {
    framePorts.delete(key)
    candidatesByFrame.delete(key)
    if (selectedTarget && frameKey(selectedTarget) === key) selectedTarget = null
    reconcileSelection()
  })
})

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isInternalMessage(raw)) return false
  void (async () => {
    await hydrate()
    const message = raw
    if (message.type === 'bridge:hello') {
      const origin = senderOrigin(sender)
      if (!origin || !trustedAppOrigins.has(origin) || sender.tab?.id === undefined) return sendResponse(undefined)
      session.roomTabId = sender.tab.id
      session.nonce = crypto.randomUUID()
      if (!session.clientSessionId) session.clientSessionId = crypto.randomUUID()
      await persistSession()
      sendResponse({ nonce: session.nonce, clientSessionId: session.clientSessionId })
      return
    }
    if (message.type === 'bridge:connect' || message.type === 'bridge:token') {
      const origin = senderOrigin(sender)
      if (!origin || !trustedAppOrigins.has(origin) || sender.tab?.id === undefined) return sendResponse({ ok: false })
      if (message.clientSessionId !== session.clientSessionId || message.nonce !== session.nonce) return sendResponse({ ok: false })
      session.roomId = message.roomId
      session.socketUrl = message.socketUrl
      session.extensionToken = message.extensionToken
      session.memberId = decodeMemberId(message.extensionToken)
      session.roomTabId = sender.tab.id
      session.userDisconnected = false
      session.retryStopped = false
      session.reconnectGeneration += 1
      await persistSession()
      void connectSocket(message.extensionToken, session.reconnectGeneration)
      sendResponse({ ok: true })
      return
    }
    if (message.type === 'bridge:disconnect' || message.type === 'popup:disconnect') {
      await disconnect(true)
      sendResponse({ ok: true })
      return
    }
    if (message.type.startsWith('frame:')) {
      handleFrameMessage(message, sender)
      sendResponse({ ok: true })
      return
    }
    if (message.type === 'popup:get-state') {
      sendResponse(await popupState())
      return
    }
    if (message.type === 'popup:rescan') {
      sendResponse({ state: await popupState(), ...await enableOrigins(message.tabId, message.grantedOrigins) })
      return
    }
    if (message.type === 'popup:enable') {
      sendResponse(await enableOrigins(message.tabId, message.origins))
      return
    }
    if (message.type === 'popup:shutdown-origins') {
      await shutdownOrigins(message.tabId, message.origins)
      sendResponse({ ok: true })
      return
    }
    if (message.type === 'popup:select-target') {
      const actual = [...candidatesByFrame.values()].flat().find((candidate) =>
        candidate.frameId === message.target.frameId
        && candidate.documentId === message.target.documentId
        && candidate.fingerprint === message.target.fingerprint)
      if (actual) {
        manualTarget = { ...message.target, manual: true }
        selectedTarget = manualTarget
        selectedPort()?.postMessage({ type: 'background:select-target', fingerprint: actual.fingerprint } satisfies InternalMessage)
      }
      sendResponse({ ok: Boolean(actual) })
      return
    }
    if (message.type === 'popup:control') {
      const payload = message.intent === 'seek'
        ? { type: 'playback:seek-request', positionMs: message.positionMs }
        : message.intent === 'rate'
          ? { type: 'playback:rate-request', playbackRate: message.playbackRate }
          : { type: `playback:${message.intent}-request` }
      sendResponse({ ok: sendRoomEvent(payload) })
      return
    }
    if (message.type === 'popup:dev-connect') {
      session.nonce = crypto.randomUUID()
      session.clientSessionId = session.clientSessionId || crypto.randomUUID()
      let host = 'http://127.0.0.1:4173'
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      const tabOrigin = tab?.url ? normalizeHttpOrigin(tab.url) : null
      if (tabOrigin && trustedAppOrigins.has(tabOrigin)) {
        host = tabOrigin
      } else if (session.roomTabId !== null) {
        try {
          const rTab = await chrome.tabs.get(session.roomTabId)
          const rOrigin = rTab.url ? normalizeHttpOrigin(rTab.url) : null
          if (rOrigin && trustedAppOrigins.has(rOrigin)) {
            host = rOrigin
          }
        } catch {
          // Tab may have closed or is not accessible, fallback to default host
        }
      }
      const baseUrl = host.replace(/\/$/, '')
      const wsProto = baseUrl.startsWith('https://') ? 'wss://' : 'ws://'
      const wsUrl = baseUrl.replace(/^https?:\/\//, wsProto)
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
      session.roomId = payload.data.state.roomId
      session.memberId = payload.data.memberId
      session.socketUrl = `${wsUrl}/api/watch-party/rooms/${encodeURIComponent(payload.data.state.roomId)}/extension-socket`
      session.extensionToken = payload.data.extensionToken
      session.userDisconnected = false
      session.retryStopped = false
      session.reconnectGeneration += 1
      await persistSession()
      void connectSocket(payload.data.extensionToken, session.reconnectGeneration)
      sendResponse({ ok: true })
      return
    }
    if (message.type === 'popup:set-diagnostics') {
      preferences.diagnosticsEnabled = message.enabled
      await persistPreferences()
      sendResponse({ ok: true })
      return
    }
    if (message.type === 'popup:get-diagnostics') {
      sendResponse({ generatedAt: Date.now(), entries: diagnostics.export() })
    }
  })().catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'Unexpected extension error' }))
  return true
})

chrome.webNavigation.onCommitted.addListener((details) => {
  void (async () => {
    await hydrate()
    for (const [key, entry] of framePorts) {
      if (entry.target.tabId === details.tabId && entry.target.frameId === details.frameId && entry.target.documentId !== details.documentId) {
        entry.port.postMessage({ type: 'background:shutdown' } satisfies InternalMessage)
        framePorts.delete(key)
        candidatesByFrame.delete(key)
      }
    }
    const origin = normalizeHttpOrigin(details.url)
    if (!origin) return
    const tab = await chrome.tabs.get(details.tabId)
    const topOrigin = tab.url ? normalizeHttpOrigin(tab.url) : null
    if (!topOrigin || !(preferences.selectedOriginsByTopOrigin[topOrigin] ?? []).includes(origin)) return
    const pattern = originPattern(origin)
    if (!pattern || !(await chrome.permissions.contains({ origins: [pattern] }))) return
    await injectFrame({ tabId: details.tabId, frameId: details.frameId, documentId: details.documentId ?? '', origin })
  })()
})

void hydrate().then(() => {
  if (session.roomId && !session.userDisconnected && !session.retryStopped) {
    session.reconnectGeneration += 1
    void reconnectTokenFromRoom(session.reconnectGeneration)
  }
})
