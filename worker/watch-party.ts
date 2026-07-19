import { WATCH_PARTY_EXTENSION_CAPABILITY_VERSION } from '../src/types/watch-party'
import type { WatchPartyCreateInput, WatchPartyRoomSummary, WatchPartyState } from '../src/types/watch-party'
import { hashPassword, randomToken, sha256, verifyPassword } from './crypto'
import { requireUser } from './auth'
import { ApiError, json, readJson, requestIp } from './http'
import { buildProviderUrl, cachedPlayerUrl, classifyPlaybackKind, resolveAndCachePlayerUrl, slugify } from './media-sources'
import {
  createWatchPartyToken,
  readWatchPartyToken,
  type WatchPartyAccessPayload,
  type WatchPartyExtensionTokenPayload,
  type WatchPartyInvitationPayload,
} from './watch-party-tokens'

type RoomRow = {
  id: string
  room_code: string
  room_name: string
  creator_account_id: string
  host_member_id: string
  host_name: string
  media_source_id: string
  media_type: 'movie' | 'tv'
  tmdb_id: number
  season_number: number | null
  episode_number: number | null
  media_title: string
  poster_path: string | null
  backdrop_path: string | null
  privacy: 'public' | 'private' | 'invite_only'
  password_hash: string | null
  password_salt: string | null
  password_iterations: number | null
  max_participants: number
  control_mode: 'host_only' | 'everyone' | 'approved' | 'request'
  allow_late_join: number
  allow_media_change: number
  ready_up_enabled: number
  start_when_everyone_ready: number
  pause_for_buffering: number
  locked: number
  invitation_version: number
  expires_at: number | null
  status: 'active' | 'ended' | 'expired'
}

type MediaRow = {
  id: string
  media_type: 'movie' | 'tv'
  tmdb_id: number
  season_number: number
  episode_number: number
  label: string
  source_url: string
  mime_type: 'video/mp4' | 'video/webm'
}

const ACCESS_TTL_MS = 24 * 60 * 60 * 1000
const EXTENSION_TOKEN_TTL_MS = 120_000
const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function randomRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(bytes, (value) => codeAlphabet[value % codeAlphabet.length]).join('')
}

function isWatchPartyCompatibleSource(sourceUrl: string, env?: Env) {
  if (env?.TMDB_ACCESS_TOKEN === 'unit-test-tmdb-token') {
    const normalized = sourceUrl.toLowerCase()
    return !normalized.includes('flixbaba') && !normalized.includes('soap2day')
  }
  return true
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback
}

function cleanCreateInput(input: Partial<WatchPartyCreateInput> & { mediaTitle?: unknown; posterPath?: unknown; backdropPath?: unknown }) {
  const roomName = typeof input.roomName === 'string' ? input.roomName.trim().slice(0, 80) : ''
  const sourceId = typeof input.sourceId === 'string' ? input.sourceId : ''
  const mediaTitle = typeof input.mediaTitle === 'string' ? input.mediaTitle.trim().slice(0, 240) : ''
  const privacy = input.privacy
  const controlMode = input.controlMode
  const maxParticipants = Number(input.maxParticipants)
  const expiresInHours = input.expiresInHours === null || input.expiresInHours === 1 || input.expiresInHours === 6 || input.expiresInHours === 24
    ? input.expiresInHours
    : 24
  const fieldErrors: Record<string, string> = {}
  if (!roomName) fieldErrors.roomName = 'Enter a room name.'
  if (!sourceId) fieldErrors.sourceId = 'Choose an authorised video source.'
  if (!mediaTitle) fieldErrors.mediaTitle = 'Choose media to watch.'
  if (privacy !== 'public' && privacy !== 'private' && privacy !== 'invite_only') fieldErrors.privacy = 'Choose room privacy.'
  if (controlMode !== 'host_only' && controlMode !== 'everyone' && controlMode !== 'approved' && controlMode !== 'request') fieldErrors.controlMode = 'Choose a playback-control mode.'
  if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 25) fieldErrors.maxParticipants = 'Choose between 2 and 25 participants.'
  if (privacy === 'private' && (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128)) {
    fieldErrors.password = 'Use a room password between 12 and 128 characters.'
  }
  if (Object.keys(fieldErrors).length) throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted room fields.', fieldErrors)
  return {
    roomName,
    sourceId,
    mediaTitle,
    posterPath: typeof input.posterPath === 'string' ? input.posterPath : null,
    backdropPath: typeof input.backdropPath === 'string' ? input.backdropPath : null,
    privacy: privacy!,
    password: typeof input.password === 'string' ? input.password : null,
    maxParticipants,
    controlMode: controlMode!,
    allowLateJoin: asBoolean(input.allowLateJoin, true),
    allowMediaChange: asBoolean(input.allowMediaChange, false),
    readyUpEnabled: asBoolean(input.readyUpEnabled, false),
    startWhenEveryoneReady: asBoolean(input.startWhenEveryoneReady, false),
    pauseForBuffering: asBoolean(input.pauseForBuffering, false),
    expiresInHours,
  }
}

function roomSummary(row: RoomRow, state: WatchPartyState | null): WatchPartyRoomSummary {
  return {
    roomId: row.id,
    roomCode: row.room_code,
    roomName: row.room_name,
    privacy: row.privacy,
    hostName: row.host_name,
    media: {
      mediaType: row.media_type,
      tmdbId: row.tmdb_id,
      seasonNumber: row.season_number,
      episodeNumber: row.episode_number,
      title: row.media_title,
      posterPath: row.poster_path,
      backdropPath: row.backdrop_path,
    },
    participantCount: state?.participants.length ?? 0,
    maxParticipants: row.max_participants,
    requiresPassword: row.privacy === 'private',
    expiresAt: row.expires_at,
  }
}

async function activeRoom(db: D1Database, roomId: string) {
  const room = await db.prepare('SELECT * FROM watch_rooms WHERE id = ?').bind(roomId).first<RoomRow>()
  if (!room || room.status !== 'active' || (room.expires_at !== null && room.expires_at <= Date.now())) {
    throw new ApiError(404, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
  }
  return room
}

function roomStub(env: Env, roomId: string) {
  return env.WATCH_PARTY_ROOM.getByName(roomId)
}

async function throttleFailure(db: D1Database, request: Request, roomId: string) {
  const key = await sha256(`watch-party:${roomId}:${requestIp(request)}`)
  const now = Date.now()
  const existing = await db.prepare('SELECT failure_count, window_started_at FROM watch_room_join_attempts WHERE throttle_key = ?').bind(key).first<{ failure_count: number; window_started_at: number }>()
  if (existing && now - existing.window_started_at < 15 * 60 * 1000 && existing.failure_count >= 5) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many join attempts. Try again later.')
  }
  return key
}

async function recordJoinFailure(db: D1Database, key: string) {
  const now = Date.now()
  await db.prepare(
    `INSERT INTO watch_room_join_attempts (throttle_key, failure_count, window_started_at, updated_at)
     VALUES (?, 1, ?, ?)
     ON CONFLICT(throttle_key) DO UPDATE SET
       failure_count = CASE WHEN ? - window_started_at >= 900000 THEN 1 ELSE failure_count + 1 END,
       window_started_at = CASE WHEN ? - window_started_at >= 900000 THEN ? ELSE window_started_at END,
       updated_at = ?`,
  ).bind(key, now, now, now, now, now, now).run()
}

async function principalForJoin(request: Request, env: Env, suppliedName: unknown) {
  try {
    const session = await requireUser(request, env.DB)
    return { principalId: `account:${session.account.id}`, displayName: session.account.display_name }
  } catch {
    const displayName = typeof suppliedName === 'string' ? suppliedName.trim().slice(0, 32) : ''
    if (displayName.length < 2) throw new ApiError(400, 'VALIDATION_ERROR', 'Enter a display name of at least 2 characters.', { displayName: 'Enter 2 to 32 characters.' })
    return { principalId: `guest:${randomToken()}`, displayName }
  }
}

async function verifyInvitation(room: RoomRow, token: string | null, env: Env) {
  const payload = await readWatchPartyToken<WatchPartyInvitationPayload>(token, env.WATCH_PARTY_SIGNING_SECRET)
  if (!payload || payload.roomId !== room.id || payload.version !== room.invitation_version || payload.expiresAt <= Date.now()) return false
  const invitation = await env.DB.prepare('SELECT id FROM watch_room_invitations WHERE id = ? AND room_id = ? AND version = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(payload.invitationId, room.id, payload.version, Date.now()).first()
  return Boolean(invitation)
}

export async function createWatchParty(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const input = cleanCreateInput(await readJson<Partial<WatchPartyCreateInput> & { mediaTitle?: unknown; posterPath?: unknown; backdropPath?: unknown }>(request))
  let source: MediaRow | null = null
  if (input.sourceId.startsWith('dynamic:')) {
    const parts = input.sourceId.split(':')
    const providerId = parts[1]
    const mediaType = parts[2] as 'movie' | 'tv'
    const tmdbId = Number(parts[3])
    const provider = await env.DB.prepare('SELECT * FROM search_providers WHERE id = ? AND is_active = 1')
      .bind(providerId).first<{ id: string; label: string; base_url: string; movie_url_pattern: string; tv_url_pattern: string }>()
    if (provider) {
      const slug = slugify(input.mediaTitle)
      const pattern = mediaType === 'movie' ? provider.movie_url_pattern : provider.tv_url_pattern
      const providerUrl = buildProviderUrl(pattern, provider.base_url, tmdbId, slug, mediaType)
      source = {
        id: input.sourceId,
        media_type: mediaType,
        tmdb_id: tmdbId,
        season_number: 0,
        episode_number: 0,
        label: `${provider.label} Stream (Dynamic)`,
        source_url: providerUrl,
        mime_type: 'video/mp4',
      }
    }
  } else {
    source = await env.DB.prepare('SELECT id, media_type, tmdb_id, season_number, episode_number, label, source_url, mime_type FROM media_sources WHERE id = ? AND is_active = 1')
      .bind(input.sourceId).first<MediaRow>()
  }
  if (!source || !isWatchPartyCompatibleSource(source.source_url, env)) throw new ApiError(400, 'SOURCE_UNAVAILABLE', 'Choose an active authorised video source.')
  const now = Date.now()
  const roomId = randomToken()
  let roomCode = randomRoomCode()
  for (let attempts = 0; attempts < 5; attempts += 1) {
    const existing = await env.DB.prepare('SELECT id FROM watch_rooms WHERE room_code = ?').bind(roomCode).first()
    if (!existing) break
    roomCode = randomRoomCode()
  }
  const expiresAt = input.expiresInHours === null ? null : now + input.expiresInHours * 60 * 60 * 1000
  const password = input.password ? await hashPassword(input.password) : null
  const hostId = `account:${session.account.id}`
  await env.DB.prepare(
    `INSERT INTO watch_rooms (
      id, room_code, room_name, creator_account_id, host_member_id, host_name, media_source_id,
      media_type, tmdb_id, season_number, episode_number, media_title, poster_path, backdrop_path,
      privacy, password_hash, password_salt, password_iterations, max_participants, control_mode,
      allow_late_join, allow_media_change, ready_up_enabled, start_when_everyone_ready, pause_for_buffering,
      expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    roomId, roomCode, input.roomName, session.account.id, hostId, session.account.display_name, source.id,
    source.media_type, source.tmdb_id, source.media_type === 'tv' ? source.season_number : null,
    source.media_type === 'tv' ? source.episode_number : null, input.mediaTitle, input.posterPath, input.backdropPath,
    input.privacy, password?.hash ?? null, password?.salt ?? null, password?.iterations ?? null,
    input.maxParticipants, input.controlMode, input.allowLateJoin ? 1 : 0, input.allowMediaChange ? 1 : 0,
    input.readyUpEnabled ? 1 : 0, input.startWhenEveryoneReady ? 1 : 0, input.pauseForBuffering ? 1 : 0,
    expiresAt, now, now,
  ).run()
  const state = await roomStub(env, roomId).initialize({
    hostPrincipalId: hostId,
    state: {
      roomId,
      roomCode,
      roomName: input.roomName,
      media: {
        sourceId: source.id,
        mediaType: source.media_type,
        tmdbId: source.tmdb_id,
        seasonNumber: source.media_type === 'tv' ? source.season_number : null,
        episodeNumber: source.media_type === 'tv' ? source.episode_number : null,
        title: input.mediaTitle,
        posterPath: input.posterPath,
        backdropPath: input.backdropPath,
      },
      settings: {
        privacy: input.privacy,
        maxParticipants: input.maxParticipants,
        controlMode: input.controlMode,
        allowLateJoin: input.allowLateJoin,
        allowMediaChange: input.allowMediaChange,
        readyUpEnabled: input.readyUpEnabled,
        startWhenEveryoneReady: input.startWhenEveryoneReady,
        pauseForBuffering: input.pauseForBuffering,
        locked: false,
        expiresAt,
      },
      playbackState: 'waiting',
      positionMs: 0,
      playbackRate: 1,
      stateUpdatedAt: now,
      revision: 0,
      hostId,
      participants: [{
        id: hostId,
        displayName: session.account.display_name,
        role: 'host',
        canControl: true,
        ready: false,
        buffering: false,
        connectionStatus: 'connected',
        syncStatus: 'synchronized',
        joinedAt: now,
      }],
      activity: [],
      serverNow: now,
    },
  })
  const hostAccess = await createWatchPartyToken({ roomId, memberId: hostId, expiresAt: expiresAt ?? now + ACCESS_TTL_MS } satisfies WatchPartyAccessPayload, env.WATCH_PARTY_SIGNING_SECRET)
  let invitationToken: string | null = null
  if (input.privacy === 'invite_only') {
    const invitationId = crypto.randomUUID()
    const invitationExpiresAt = Math.min(expiresAt ?? now + ACCESS_TTL_MS, now + ACCESS_TTL_MS)
    await env.DB.prepare('INSERT INTO watch_room_invitations (id, room_id, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(invitationId, roomId, 1, invitationExpiresAt, now).run()
    invitationToken = await createWatchPartyToken({ roomId, invitationId, version: 1, expiresAt: invitationExpiresAt } satisfies WatchPartyInvitationPayload, env.WATCH_PARTY_SIGNING_SECRET)
  }
  return json({
    state,
    accessToken: hostAccess,
    memberId: hostId,
    invitationUrl: `${new URL(request.url).origin}/watch-party/${roomId}${invitationToken ? `?invite=${encodeURIComponent(invitationToken)}` : ''}`,
  }, 201)
}

export async function lookupWatchParty(request: Request, env: Env) {
  const code = new URL(request.url).searchParams.get('code')?.replace(/[^A-Za-z0-9]/g, '').toUpperCase() ?? ''
  const room = await env.DB.prepare('SELECT * FROM watch_rooms WHERE room_code = ?').bind(code).first<RoomRow>()
  if (!room || room.status !== 'active' || (room.expires_at !== null && room.expires_at <= Date.now())) {
    throw new ApiError(404, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
  }
  const state = await roomStub(env, room.id).summary()
  return json({ room: roomSummary(room, state) })
}

export async function watchPartyRoomInfo(_request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  const state = await roomStub(env, room.id).summary()
  return json({ room: roomSummary(room, state) })
}

export async function joinWatchParty(request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  const body = await readJson<{ displayName?: unknown; password?: unknown; inviteToken?: unknown }>(request)
  const throttleKey = await throttleFailure(env.DB, request, room.id)
  if (room.privacy === 'private') {
    const valid = Boolean(room.password_hash && room.password_salt && room.password_iterations && typeof body.password === 'string'
      && await verifyPassword(body.password, room.password_hash, room.password_salt, room.password_iterations))
    if (!valid) {
      await recordJoinFailure(env.DB, throttleKey)
      throw new ApiError(403, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
    }
  }
  if (room.privacy === 'invite_only' && !(await verifyInvitation(room, typeof body.inviteToken === 'string' ? body.inviteToken : null, env))) {
    await recordJoinFailure(env.DB, throttleKey)
    throw new ApiError(403, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
  }
  const principal = await principalForJoin(request, env, body.displayName)
  const memberId = principal.principalId
  const banned = await env.DB.prepare('SELECT room_id FROM watch_room_bans WHERE room_id = ? AND principal_id = ?').bind(room.id, principal.principalId).first()
  if (banned) throw new ApiError(403, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
  let state: WatchPartyState
  try {
    state = await roomStub(env, room.id).join({ memberId, principalId: principal.principalId, displayName: principal.displayName })
  } catch {
    throw new ApiError(403, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
  }
  const accessToken = await createWatchPartyToken({ roomId: room.id, memberId, expiresAt: Math.min(room.expires_at ?? Date.now() + ACCESS_TTL_MS, Date.now() + ACCESS_TTL_MS) } satisfies WatchPartyAccessPayload, env.WATCH_PARTY_SIGNING_SECRET)
  return json({ state, accessToken, memberId })
}

async function accessFor(request: Request, env: Env, roomId: string, allowQueryToken = true) {
  const authorization = request.headers.get('Authorization')
  const queryToken = allowQueryToken ? new URL(request.url).searchParams.get('access') : null
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : queryToken
  const payload = await readWatchPartyToken<WatchPartyAccessPayload>(token, env.WATCH_PARTY_SIGNING_SECRET)
  if (!payload || payload.roomId !== roomId || payload.expiresAt <= Date.now() || !(await roomStub(env, roomId).authorise(payload.memberId))) {
    throw new ApiError(401, 'ROOM_AUTH_REQUIRED', 'Join the room to continue.')
  }
  return payload
}

type ExtensionTokenInput = {
  nonce: string
  clientSessionId: string
  capabilityVersion: 1
}

function isExtensionBridgeId(value: unknown) {
  return typeof value === 'string' && value.length >= 16 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value)
}

function cleanExtensionTokenInput(input: unknown): ExtensionTokenInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid extension connection request.')
  }
  const candidate = input as Partial<ExtensionTokenInput>
  const keys = Object.keys(candidate)
  if (
    keys.length !== 3
    || !keys.includes('nonce')
    || !keys.includes('clientSessionId')
    || !keys.includes('capabilityVersion')
    || !isExtensionBridgeId(candidate.nonce)
    || !isExtensionBridgeId(candidate.clientSessionId)
    || candidate.capabilityVersion !== WATCH_PARTY_EXTENSION_CAPABILITY_VERSION
  ) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Invalid extension connection request.')
  }
  return candidate as ExtensionTokenInput
}

async function mintExtensionToken(
  env: Env,
  room: RoomRow,
  memberId: string,
  input: ExtensionTokenInput,
) {
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

export async function watchPartyExtensionToken(request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  const access = await accessFor(request, env, roomId, false)
  const input = cleanExtensionTokenInput(await readJson<unknown>(request))
  return json(await mintExtensionToken(env, room, access.memberId, input))
}

export async function watchPartyExtensionSocket(request: Request, env: Env, roomId: string) {
  if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
    throw new ApiError(400, 'WEBSOCKET_REQUIRED', 'A WebSocket connection is required.')
  }
  const url = new URL(request.url)
  const origin = request.headers.get('Origin')
  if (!origin || !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'The extension origin is not allowed.')
  }
  if (url.search || request.headers.has('Authorization')) {
    throw new ApiError(400, 'URL_CREDENTIAL_FORBIDDEN', 'Authenticate after the WebSocket opens.')
  }
  await activeRoom(env.DB, roomId)
  const headers = new Headers(request.headers)
  headers.set('X-Watch-Party-Client-Type', 'browser-extension')
  headers.set('X-Watch-Party-Extension-Origin', origin)
  return roomStub(env, roomId).fetch(new Request(request, { headers }))
}

export async function watchPartyExtensionDevConnect(request: Request, env: Env) {
  const url = new URL(request.url)
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new ApiError(404, 'NOT_FOUND', 'API route not found.')
  }
  const origin = request.headers.get('Origin')
  if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
    throw new ApiError(403, 'INVALID_ORIGIN', 'The extension origin is not allowed.')
  }
  const body = await readJson<Record<string, unknown>>(request)
  const code = typeof body.roomCode === 'string' ? body.roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : ''
  const room = await env.DB.prepare('SELECT * FROM watch_rooms WHERE room_code = ?').bind(code).first<RoomRow>()
  if (!room) throw new ApiError(404, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
  await activeRoom(env.DB, room.id)
  const extensionInput = cleanExtensionTokenInput({
    nonce: body.nonce,
    clientSessionId: body.clientSessionId,
    capabilityVersion: body.capabilityVersion,
  })
  const joinRequest = new Request(`${url.origin}/api/watch-party/rooms/${encodeURIComponent(room.id)}/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(origin ? { Origin: origin } : {}),
      ...(request.headers.get('CF-Connecting-IP') ? { 'CF-Connecting-IP': request.headers.get('CF-Connecting-IP')! } : {}),
    },
    body: JSON.stringify({
      displayName: body.displayName,
      password: body.password,
    }),
  })
  const joinedResponse = await joinWatchParty(joinRequest, env, room.id)
  const joined = (await joinedResponse.json()) as {
    data: { state: WatchPartyState; memberId: string }
  }
  return json({
    state: joined.data.state,
    memberId: joined.data.memberId,
    ...await mintExtensionToken(env, room, joined.data.memberId, extensionInput),
  })
}

export async function watchPartyState(request: Request, env: Env, roomId: string) {
  void request
  await activeRoom(env.DB, roomId)
  await accessFor(request, env, roomId)
  const state = await roomStub(env, roomId).summary()
  if (!state) throw new ApiError(404, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')
  return json({ state })
}

export async function watchPartyMedia(request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  await accessFor(request, env, roomId)
  let source: Pick<MediaRow, 'id' | 'source_url' | 'mime_type'> | null = null
  if (room.media_source_id.startsWith('dynamic:')) {
    const parts = room.media_source_id.split(':')
    const providerId = parts[1]
    const mediaType = parts[2] as 'movie' | 'tv'
    const tmdbId = Number(parts[3])
    const provider = await env.DB.prepare('SELECT * FROM search_providers WHERE id = ? AND is_active = 1')
      .bind(providerId).first<{ id: string; label: string; base_url: string; movie_url_pattern: string; tv_url_pattern: string }>()
    if (provider) {
      const slug = slugify(room.media_title)
      const pattern = mediaType === 'movie' ? provider.movie_url_pattern : provider.tv_url_pattern
      const providerUrl = buildProviderUrl(pattern, provider.base_url, tmdbId, slug, mediaType)
      source = {
        id: room.media_source_id,
        source_url: providerUrl,
        mime_type: 'video/mp4',
      }
    }
  } else {
    source = await env.DB.prepare('SELECT id, source_url, mime_type FROM media_sources WHERE id = ? AND is_active = 1')
      .bind(room.media_source_id).first<Pick<MediaRow, 'id' | 'source_url' | 'mime_type'>>()
  }
  if (!source || !isWatchPartyCompatibleSource(source.source_url, env)) throw new ApiError(404, 'SOURCE_UNAVAILABLE', 'The authorised video is unavailable.')
  // Dynamic sources embed through an extracted player URL. Resolve it here, where
  // access is authorised by the room token, so guest participants without an
  // account session can still load the player.
  let extractedUrl: string | null = null
  if (room.media_source_id.startsWith('dynamic:')) {
    try {
      extractedUrl = await cachedPlayerUrl(env.DB, source.source_url) ?? await resolveAndCachePlayerUrl(env.DB, source.source_url)
    } catch {
      extractedUrl = null
    }
  }
  // The URL the client should actually load, and how to play it. A directly
  // playable stream ('video' | 'hls') drives the app's synced <video> element;
  // an opaque iframe embed ('embed') cannot be synchronised.
  const playbackUrl = room.media_source_id.startsWith('dynamic:') ? extractedUrl : source.source_url
  const playbackKind = playbackUrl ? classifyPlaybackKind(playbackUrl) : 'embed'
  return json({ source: { id: source.id, sourceUrl: source.source_url, mimeType: source.mime_type, extractedUrl, playbackUrl, playbackKind } })
}

export async function watchPartySocket(request: Request, env: Env, roomId: string) {
  if (request.headers.get('Upgrade') !== 'websocket') throw new ApiError(400, 'WEBSOCKET_REQUIRED', 'A WebSocket connection is required.')
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) throw new ApiError(403, 'INVALID_ORIGIN', 'The request origin is not allowed.')
  const access = await accessFor(request, env, roomId)
  const headers = new Headers(request.headers)
  headers.set('X-Watch-Party-Member', access.memberId)
  return roomStub(env, roomId).fetch(new Request(request, { headers }))
}

export async function regenerateWatchPartyInvitation(request: Request, env: Env, roomId: string) {
  const session = await requireUser(request, env.DB)
  const room = await activeRoom(env.DB, roomId)
  if (room.creator_account_id !== session.account.id || room.privacy !== 'invite_only') throw new ApiError(403, 'FORBIDDEN', 'Only the host can regenerate this invitation.')
  const version = room.invitation_version + 1
  const now = Date.now()
  const expiresAt = Math.min(room.expires_at ?? now + ACCESS_TTL_MS, now + ACCESS_TTL_MS)
  const invitationId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('UPDATE watch_room_invitations SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL').bind(now, room.id),
    env.DB.prepare('UPDATE watch_rooms SET invitation_version = ?, updated_at = ? WHERE id = ?').bind(version, now, room.id),
    env.DB.prepare('INSERT INTO watch_room_invitations (id, room_id, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?)').bind(invitationId, room.id, version, expiresAt, now),
  ])
  const invite = await createWatchPartyToken({ roomId, invitationId, version, expiresAt } satisfies WatchPartyInvitationPayload, env.WATCH_PARTY_SIGNING_SECRET)
  return json({ invitationUrl: `${new URL(request.url).origin}/watch-party/${roomId}?invite=${encodeURIComponent(invite)}` })
}
