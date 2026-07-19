import type { InternalMessage, SocketStatus } from '../types'

const VERSION = 1
const WEBSITE_SOURCE = 'fedora-movies-watch-party'
const EXTENSION_SOURCE = 'fedora-movies-watch-sync-extension'
const trustedOrigins = new Set([
  'https://movie-app.jordanvorster404.workers.dev',
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
])

interface BridgeIdentity {
  nonce: string
  clientSessionId: string
}

function bridgeId(value: unknown) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

function isWebsiteHello(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  return candidate.source === WEBSITE_SOURCE
    && candidate.protocolVersion === VERSION
    && candidate.type === 'website:hello'
    && Object.keys(candidate).length === 3
}

function isWebsiteMessage(value: unknown): value is {
  source: typeof WEBSITE_SOURCE
  type: 'website:connect' | 'website:token' | 'website:disconnect'
  protocolVersion: 1
  roomId?: string
  nonce?: string
  clientSessionId: string
  extensionToken?: string
  socketUrl?: string
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const candidate = value as Record<string, unknown>
  if (candidate.source !== WEBSITE_SOURCE || candidate.protocolVersion !== VERSION || !bridgeId(candidate.clientSessionId)) return false
  if (candidate.type === 'website:disconnect') {
    return Object.keys(candidate).length === 4
  }
  return (candidate.type === 'website:connect' || candidate.type === 'website:token')
    && typeof candidate.roomId === 'string'
    && candidate.roomId.length >= 16
    && bridgeId(candidate.nonce)
    && typeof candidate.extensionToken === 'string'
    && candidate.extensionToken.length >= 32
    && typeof candidate.socketUrl === 'string'
    && candidate.socketUrl.startsWith(location.protocol === 'https:' ? 'wss:' : 'ws:')
    && Object.keys(candidate).length === 9
}

function postToPage(message: Record<string, unknown>) {
  window.postMessage({
    source: EXTENSION_SOURCE,
    protocolVersion: VERSION,
    ...message,
  }, location.origin)
}

if (window === window.top && trustedOrigins.has(location.origin)) {
  let identity: BridgeIdentity | null = null
  let handshakeInFlight = false

  const announce = () => {
    if (!identity) return
    postToPage({ type: 'extension:hello', ...identity })
  }

  const requestIdentity = () => {
    if (identity) return announce()
    if (handshakeInFlight) return
    handshakeInFlight = true
    void chrome.runtime.sendMessage({ type: 'bridge:hello', origin: location.origin } satisfies InternalMessage)
      .then((response: BridgeIdentity | undefined) => {
        if (!response || !bridgeId(response.nonce) || !bridgeId(response.clientSessionId)) return
        identity = response
        announce()
      })
      .catch(() => undefined)
      .finally(() => { handshakeInFlight = false })
  }

  requestIdentity()

  window.addEventListener('pageshow', announce)
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return
    if (isWebsiteHello(event.data)) return requestIdentity()
    if (!identity || !isWebsiteMessage(event.data)) return
    const message = event.data
    if (message.clientSessionId !== identity.clientSessionId) return
    let internal: InternalMessage
    if (message.type === 'website:disconnect') {
      internal = { type: 'bridge:disconnect', clientSessionId: message.clientSessionId }
    } else {
      internal = {
        type: message.type === 'website:connect' ? 'bridge:connect' : 'bridge:token',
        roomId: message.roomId!,
        socketUrl: message.socketUrl!,
        nonce: message.nonce!,
        clientSessionId: message.clientSessionId,
        extensionToken: message.extensionToken!,
      }
    }
    void chrome.runtime.sendMessage(internal).catch(() => undefined)
  })

  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return
    const candidate = message as Record<string, unknown>
    if (candidate.type === 'background:token-request' && bridgeId(candidate.nonce) && bridgeId(candidate.clientSessionId)) {
      postToPage({
        type: 'extension:token-request',
        nonce: candidate.nonce,
        clientSessionId: candidate.clientSessionId,
      })
    }
    if (
      candidate.type === 'background:status'
      && bridgeId(candidate.clientSessionId)
      && typeof candidate.message === 'string'
      && ['idle', 'connecting', 'connected', 'reconnecting', 'disconnected', 'error'].includes(String(candidate.status))
    ) {
      postToPage({
        type: 'extension:status',
        clientSessionId: candidate.clientSessionId,
        status: candidate.status as SocketStatus,
        message: candidate.message.slice(0, 240),
      })
    }
  })
}
