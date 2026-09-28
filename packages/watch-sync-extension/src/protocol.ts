// Constants and guards shared by the background worker, the content scripts
// and the manifest. Must stay free of chrome.* calls so any context can import it.
import trustedOrigins from '../trusted-origins.json'

// Pages allowed to hand the extension a room connection; configured in trusted-origins.json.
export const TRUSTED_APP_ORIGINS: readonly string[] = trustedOrigins.origins

// The window.postMessage protocol spoken with the website (see src/features/watch-party/extension-bridge.ts).
export const BRIDGE_VERSION = 1
export const WEBSITE_SOURCE = 'fedora-movies-watch-party' as const
export const EXTENSION_SOURCE = 'fedora-movies-watch-sync-extension' as const

export const SOCKET_STATUSES = ['idle', 'connecting', 'connected', 'reconnecting', 'disconnected', 'error'] as const
export type SocketStatus = typeof SOCKET_STATUSES[number]

export const isSocketStatus = (value: unknown): value is SocketStatus => (SOCKET_STATUSES as readonly unknown[]).includes(value)

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Nonces and session ids are random URL-safe strings.
export function isBridgeId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}
