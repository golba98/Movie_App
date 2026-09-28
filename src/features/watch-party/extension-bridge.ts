import { isRecord } from '../../lib/is-record'
import { roomSocketUrl } from './api'

// The window.postMessage protocol between a room page and the companion
// browser extension's content script.
export const WATCH_SYNC_BRIDGE_VERSION = 1 as const
export const WATCH_SYNC_WEBSITE_SOURCE = 'fedora-movies-watch-party' as const
const WATCH_SYNC_EXTENSION_SOURCE = 'fedora-movies-watch-sync-extension' as const

const BRIDGE_STATUSES = ['idle', 'connecting', 'connected', 'reconnecting', 'disconnected', 'error'] as const
export type ExtensionBridgeStatus = typeof BRIDGE_STATUSES[number]

export type ExtensionBridgeMessage =
  | {
      source: typeof WATCH_SYNC_EXTENSION_SOURCE
      type: 'extension:hello'
      protocolVersion: 1
      nonce: string
      clientSessionId: string
    }
  | {
      source: typeof WATCH_SYNC_EXTENSION_SOURCE
      type: 'extension:status'
      protocolVersion: 1
      clientSessionId: string
      status: ExtensionBridgeStatus
      message: string
    }
  | {
      source: typeof WATCH_SYNC_EXTENSION_SOURCE
      type: 'extension:token-request'
      protocolVersion: 1
      nonce: string
      clientSessionId: string
    }

type WebsiteBridgeMessage =
  | {
      source: typeof WATCH_SYNC_WEBSITE_SOURCE
      type: 'website:hello'
      protocolVersion: 1
    }
  | {
      source: typeof WATCH_SYNC_WEBSITE_SOURCE
      type: 'website:connect' | 'website:token'
      protocolVersion: 1
      roomId: string
      nonce: string
      clientSessionId: string
      extensionToken: string
      socketUrl: string
    }
  | {
      source: typeof WATCH_SYNC_WEBSITE_SOURCE
      type: 'website:disconnect'
      protocolVersion: 1
      clientSessionId: string
    }

// Nonces and session ids are random URL-safe strings.
function isBridgeId(value: unknown) {
  return typeof value === 'string'
    && value.length >= 16
    && value.length <= 128
    && /^[A-Za-z0-9_-]+$/.test(value)
}

export function isExtensionBridgeMessage(value: unknown): value is ExtensionBridgeMessage {
  if (!isRecord(value)) return false
  const candidate = value as Partial<ExtensionBridgeMessage>
  if (candidate.source !== WATCH_SYNC_EXTENSION_SOURCE || candidate.protocolVersion !== WATCH_SYNC_BRIDGE_VERSION) return false
  if (candidate.type === 'extension:hello' || candidate.type === 'extension:token-request') {
    return isBridgeId(candidate.nonce) && isBridgeId(candidate.clientSessionId)
  }
  if (candidate.type === 'extension:status') {
    return isBridgeId(candidate.clientSessionId)
      && typeof candidate.message === 'string'
      && candidate.message.length <= 240
      && (BRIDGE_STATUSES as readonly string[]).includes(candidate.status ?? '')
  }
  return false
}

export function extensionSocketUrl(roomId: string) {
  return roomSocketUrl(roomId, 'extension-socket')
}

export function postToExtension(message: WebsiteBridgeMessage) {
  window.postMessage(message, window.location.origin)
}
