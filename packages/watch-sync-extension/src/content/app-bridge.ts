// Relays between the watch-party page (window.postMessage) and the background
// worker (chrome.runtime), on trusted app pages only.
import {
  BRIDGE_VERSION,
  EXTENSION_SOURCE,
  isBridgeId,
  isRecord,
  isSocketStatus,
  TRUSTED_APP_ORIGINS,
  WEBSITE_SOURCE,
} from '../protocol'
import type { InternalMessage } from '../types'

interface BridgeIdentity {
  nonce: string
  clientSessionId: string
}

interface WebsiteMessage {
  source: typeof WEBSITE_SOURCE
  type: 'website:connect' | 'website:token' | 'website:disconnect'
  protocolVersion: typeof BRIDGE_VERSION
  roomId?: string
  nonce?: string
  clientSessionId: string
  extensionToken?: string
  socketUrl?: string
}

function isWebsiteHello(value: unknown) {
  return isRecord(value)
    && value.source === WEBSITE_SOURCE
    && value.protocolVersion === BRIDGE_VERSION
    && value.type === 'website:hello'
    && Object.keys(value).length === 3
}

function isWebsiteMessage(value: unknown): value is WebsiteMessage {
  if (!isRecord(value)) return false
  const candidate = value
  if (candidate.source !== WEBSITE_SOURCE || candidate.protocolVersion !== BRIDGE_VERSION || !isBridgeId(candidate.clientSessionId)) return false
  if (candidate.type === 'website:disconnect') {
    return Object.keys(candidate).length === 4
  }
  return (candidate.type === 'website:connect' || candidate.type === 'website:token')
    && typeof candidate.roomId === 'string'
    && candidate.roomId.length >= 16
    && isBridgeId(candidate.nonce)
    && typeof candidate.extensionToken === 'string'
    && candidate.extensionToken.length >= 32
    && typeof candidate.socketUrl === 'string'
    && candidate.socketUrl.startsWith(location.protocol === 'https:' ? 'wss:' : 'ws:')
    && Object.keys(candidate).length === 9
}

function postToPage(message: Record<string, unknown>) {
  window.postMessage({
    source: EXTENSION_SOURCE,
    protocolVersion: BRIDGE_VERSION,
    ...message,
  }, location.origin)
}

if (window === window.top && TRUSTED_APP_ORIGINS.includes(location.origin)) {
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
        if (!response || !isBridgeId(response.nonce) || !isBridgeId(response.clientSessionId)) return
        identity = response
        announce()
      })
      .catch(() => undefined)
      .finally(() => {
        handshakeInFlight = false
      })
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
    if (!isRecord(message)) return
    const candidate = message
    if (candidate.type === 'background:token-request' && isBridgeId(candidate.nonce) && isBridgeId(candidate.clientSessionId)) {
      postToPage({
        type: 'extension:token-request',
        nonce: candidate.nonce,
        clientSessionId: candidate.clientSessionId,
      })
    }
    if (
      candidate.type === 'background:status'
      && isBridgeId(candidate.clientSessionId)
      && typeof candidate.message === 'string'
      && isSocketStatus(candidate.status)
    ) {
      postToPage({
        type: 'extension:status',
        clientSessionId: candidate.clientSessionId,
        status: candidate.status,
        message: candidate.message.slice(0, 240),
      })
    }
  })
}
