import { signValue, verifySignedValue } from './crypto'

export type WatchPartyAccessPayload = {
  roomId: string
  memberId: string
  expiresAt: number
}

export type WatchPartyInvitationPayload = {
  roomId: string
  invitationId: string
  version: number
  expiresAt: number
}

export type WatchPartyExtensionTokenPayload = {
  purpose: 'browser-extension'
  roomId: string
  memberId: string
  nonce: string
  capabilityVersion: 1
  clientSessionId: string
  expiresAt: number
  tokenId: string
}

function base64Json(value: object) {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function parseBase64Json<T>(value: string): T | null {
  try {
    const base64 = value.replaceAll('-', '+').replaceAll('_', '/')
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as T
  } catch {
    return null
  }
}

export async function createWatchPartyToken(payload: object, secret: string) {
  const encoded = base64Json(payload)
  return `${encoded}.${await signValue(encoded, secret)}`
}

export async function readWatchPartyToken<T>(token: string | null, secret: string): Promise<T | null> {
  if (!token) return null
  const [encoded, signature, ...extra] = token.split('.')
  if (!encoded || !signature || extra.length || !(await verifySignedValue(encoded, signature, secret))) return null
  return parseBase64Json<T>(encoded)
}
