import { WATCH_PARTY_EXTENSION_CAPABILITY_VERSION, type WatchPartyState } from '../../src/types/watch-party'
import { ApiError, json, readJson } from '../http'
import { isRecord } from '../validate'
import { activeRoom, activeRoomByCode, roomStub, type RoomRow } from './rooms'
import { accessFor, joinWatchParty } from './routes'
import { createWatchPartyToken, type WatchPartyExtensionTokenPayload } from './tokens'

// Short-lived: the extension trades it for an authenticated socket straight away.
const EXTENSION_TOKEN_TTL_MS = 120_000
const EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/

interface ExtensionTokenInput {
  nonce: string
  clientSessionId: string
  capabilityVersion: typeof WATCH_PARTY_EXTENSION_CAPABILITY_VERSION
}

// Nonces and session ids are random URL-safe strings.
function isBridgeId(value: unknown) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

function cleanExtensionTokenInput(input: unknown): ExtensionTokenInput {
  const invalid = () => new ApiError(400, 'VALIDATION_ERROR', 'Invalid extension connection request.')
  if (!isRecord(input)) throw invalid()
  const keys = Object.keys(input)
  const valid = keys.length === 3
    && keys.includes('nonce')
    && keys.includes('clientSessionId')
    && keys.includes('capabilityVersion')
    && isBridgeId(input.nonce)
    && isBridgeId(input.clientSessionId)
    && input.capabilityVersion === WATCH_PARTY_EXTENSION_CAPABILITY_VERSION
  if (!valid) throw invalid()
  return input as unknown as ExtensionTokenInput
}

async function mintExtensionToken(env: Env, room: RoomRow, memberId: string, input: ExtensionTokenInput) {
  const now = Date.now()
  const expiresAt = Math.min(room.expires_at ?? now + EXTENSION_TOKEN_TTL_MS, now + EXTENSION_TOKEN_TTL_MS)
  const payload: WatchPartyExtensionTokenPayload = {
    purpose: 'browser-extension',
    roomId: room.id,
    memberId,
    nonce: input.nonce,
    capabilityVersion: input.capabilityVersion,
    clientSessionId: input.clientSessionId,
    expiresAt,
    tokenId: crypto.randomUUID(),
  }
  return {
    extensionToken: await createWatchPartyToken(payload, env.WATCH_PARTY_SIGNING_SECRET),
    expiresAt,
    capabilityVersion: input.capabilityVersion,
  }
}

/** Issued to a room member's page, which hands it to the companion extension. */
export async function watchPartyExtensionToken(request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  const access = await accessFor(request, env, roomId, false)
  const input = cleanExtensionTokenInput(await readJson<unknown>(request))
  return json(await mintExtensionToken(env, room, access.memberId, input))
}

/**
 * The extension's socket carries no credentials in the URL or headers; it must
 * authenticate with its token in the first message.
 */
export async function watchPartyExtensionSocket(request: Request, env: Env, roomId: string) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiError(400, 'WEBSOCKET_REQUIRED', 'A WebSocket connection is required.')
  }
  const origin = request.headers.get('Origin')
  if (!origin || !EXTENSION_ORIGIN.test(origin)) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'The extension origin is not allowed.')
  }
  if (new URL(request.url).search || request.headers.has('Authorization')) {
    throw new ApiError(400, 'URL_CREDENTIAL_FORBIDDEN', 'Authenticate after the WebSocket opens.')
  }
  await activeRoom(env.DB, roomId)
  const headers = new Headers(request.headers)
  headers.set('X-Watch-Party-Client-Type', 'browser-extension')
  headers.set('X-Watch-Party-Extension-Origin', origin)
  return roomStub(env, roomId).fetch(new Request(request, { headers }))
}

/**
 * Local development only: joins a room by code and returns an extension token
 * in one step, so the extension can be tested without the website.
 */
export async function watchPartyExtensionDevConnect(request: Request, env: Env) {
  const url = new URL(request.url)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new ApiError(404, 'NOT_FOUND', 'API route not found.')
  }
  const origin = request.headers.get('Origin')
  if (origin && !EXTENSION_ORIGIN.test(origin)) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'The extension origin is not allowed.')
  }
  const body = await readJson<Record<string, unknown>>(request)
  const room = await activeRoomByCode(env.DB, body.roomCode)
  const extensionInput = cleanExtensionTokenInput({
    nonce: body.nonce,
    clientSessionId: body.clientSessionId,
    capabilityVersion: body.capabilityVersion,
  })
  const clientIp = request.headers.get('CF-Connecting-IP')
  const joinRequest = new Request(`${url.origin}/api/watch-party/rooms/${encodeURIComponent(room.id)}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(clientIp ? { 'CF-Connecting-IP': clientIp } : {}),
    },
    body: JSON.stringify({ displayName: body.displayName, password: body.password }),
  })
  const joinedResponse = await joinWatchParty(joinRequest, env, room.id)
  const joined = (await joinedResponse.json()) as { data: { state: WatchPartyState; memberId: string } }
  return json({
    state: joined.data.state,
    memberId: joined.data.memberId,
    ...await mintExtensionToken(env, room, joined.data.memberId, extensionInput),
  })
}
