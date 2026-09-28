import type { WatchPartyCreateInput, WatchPartyState } from '../../src/types/watch-party'
import { hashPassword, randomToken, verifyPassword } from '../auth/crypto'
import { requireUser } from '../auth/sessions'
import { classifyPlaybackKind, resolvePlayerUrl } from '../catalog/stream-resolver'
import { isDynamicSourceId } from '../catalog/search-providers'
import { ApiError, json, readJson } from '../http'
import { createThrottle } from '../throttle'
import { assertNoFieldErrors, trimmedString } from '../validate'
import { ACCESS_TTL_MS, activeRoom, activeRoomByCode, findRoomSource, roomStub, roomSummary, roomUnavailable, type RoomRow } from './rooms'
import { createWatchPartyToken, readWatchPartyToken, type WatchPartyAccessPayload, type WatchPartyInvitationPayload } from './tokens'

const HOUR_MS = 60 * 60 * 1000
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ROOM_CODE_LENGTH = 8
const ROOM_CODE_ATTEMPTS = 5

const joinThrottle = createThrottle('watch_room_join_attempts', 'Too many join attempts. Try again later.')

type CreatePayload = Partial<WatchPartyCreateInput> & { mediaTitle?: unknown; posterPath?: unknown; backdropPath?: unknown }

function randomRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))
  return Array.from(bytes, (value) => ROOM_CODE_ALPHABET[value % ROOM_CODE_ALPHABET.length]).join('')
}

async function uniqueRoomCode(db: D1Database) {
  let roomCode = randomRoomCode()
  for (let attempts = 0; attempts < ROOM_CODE_ATTEMPTS; attempts += 1) {
    const existing = await db.prepare('SELECT id FROM watch_rooms WHERE room_code = ?').bind(roomCode).first()
    if (!existing) break
    roomCode = randomRoomCode()
  }
  return roomCode
}

const booleanOr = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)

function cleanCreateInput(input: CreatePayload) {
  const roomName = trimmedString(input.roomName, 80)
  const sourceId = typeof input.sourceId === 'string' ? input.sourceId : ''
  const mediaTitle = trimmedString(input.mediaTitle, 240)
  const { privacy, controlMode } = input
  const maxParticipants = Number(input.maxParticipants)
  const expiresInHours = input.expiresInHours === null || input.expiresInHours === 1 || input.expiresInHours === 6 || input.expiresInHours === 24
    ? input.expiresInHours
    : 24

  const fieldErrors: Record<string, string> = {}
  if (!roomName) fieldErrors.roomName = 'Enter a room name.'
  if (!sourceId) fieldErrors.sourceId = 'Choose an authorised video source.'
  if (!mediaTitle) fieldErrors.mediaTitle = 'Choose media to watch.'
  if (privacy !== 'public' && privacy !== 'private' && privacy !== 'invite_only') fieldErrors.privacy = 'Choose room privacy.'
  if (controlMode !== 'host_only' && controlMode !== 'everyone' && controlMode !== 'approved' && controlMode !== 'request') {
    fieldErrors.controlMode = 'Choose a playback-control mode.'
  }
  if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 25) {
    fieldErrors.maxParticipants = 'Choose between 2 and 25 participants.'
  }
  if (privacy === 'private' && (typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128)) {
    fieldErrors.password = 'Use a room password between 12 and 128 characters.'
  }
  assertNoFieldErrors(fieldErrors, 'Check the highlighted room fields.')

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
    allowLateJoin: booleanOr(input.allowLateJoin, true),
    allowMediaChange: booleanOr(input.allowMediaChange, false),
    readyUpEnabled: booleanOr(input.readyUpEnabled, false),
    startWhenEveryoneReady: booleanOr(input.startWhenEveryoneReady, false),
    pauseForBuffering: booleanOr(input.pauseForBuffering, false),
    expiresInHours,
  }
}

// Signed-in viewers join as themselves; anyone else joins as a named guest.
async function principalForJoin(request: Request, env: Env, suppliedName: unknown) {
  try {
    const session = await requireUser(request, env.DB)
    return { principalId: `account:${session.account.id}`, displayName: session.account.display_name }
  } catch {
    const displayName = trimmedString(suppliedName, 32)
    if (displayName.length < 2) {
      throw new ApiError(400, 'VALIDATION_ERROR', 'Enter a display name of at least 2 characters.', { displayName: 'Enter 2 to 32 characters.' })
    }
    return { principalId: `guest:${randomToken()}`, displayName }
  }
}

async function verifyInvitation(room: RoomRow, token: string | null, env: Env) {
  const payload = await readWatchPartyToken<WatchPartyInvitationPayload>(token, env.WATCH_PARTY_SIGNING_SECRET)
  if (!payload || payload.roomId !== room.id || payload.version !== room.invitation_version || payload.expiresAt <= Date.now()) return false
  const invitation = await env.DB
    .prepare('SELECT id FROM watch_room_invitations WHERE id = ? AND room_id = ? AND version = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(payload.invitationId, room.id, payload.version, Date.now())
    .first()
  return Boolean(invitation)
}

function invitationUrl(request: Request, roomId: string, invitationToken: string | null) {
  const query = invitationToken ? `?invite=${encodeURIComponent(invitationToken)}` : ''
  return `${new URL(request.url).origin}/watch-party/${roomId}${query}`
}

/** Room access lasts a day, or until the room expires if that is sooner. */
function accessToken(env: Env, room: Pick<RoomRow, 'id' | 'expires_at'>, memberId: string) {
  const now = Date.now()
  const payload: WatchPartyAccessPayload = {
    roomId: room.id,
    memberId,
    expiresAt: Math.min(room.expires_at ?? now + ACCESS_TTL_MS, now + ACCESS_TTL_MS),
  }
  return createWatchPartyToken(payload, env.WATCH_PARTY_SIGNING_SECRET)
}

/** The member a request speaks for, from its Bearer token (or `?access=` for WebSockets). */
export async function accessFor(request: Request, env: Env, roomId: string, allowQueryToken = true) {
  const authorization = request.headers.get('Authorization')
  const queryToken = allowQueryToken ? new URL(request.url).searchParams.get('access') : null
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : queryToken
  const payload = await readWatchPartyToken<WatchPartyAccessPayload>(token, env.WATCH_PARTY_SIGNING_SECRET)
  if (!payload || payload.roomId !== roomId || payload.expiresAt <= Date.now() || !(await roomStub(env, roomId).authorise(payload.memberId))) {
    throw new ApiError(401, 'ROOM_AUTH_REQUIRED', 'Join the room to continue.')
  }
  return payload
}

export async function createWatchParty(request: Request, env: Env) {
  const session = await requireUser(request, env.DB)
  const input = cleanCreateInput(await readJson<CreatePayload>(request))
  const source = await findRoomSource(env, input.sourceId, input.mediaTitle)
  if (!source) throw new ApiError(400, 'SOURCE_UNAVAILABLE', 'Choose an active authorised video source.')

  const now = Date.now()
  const roomId = randomToken()
  const roomCode = await uniqueRoomCode(env.DB)
  const expiresAt = input.expiresInHours === null ? null : now + input.expiresInHours * HOUR_MS
  const password = input.password ? await hashPassword(input.password) : null
  const hostId = `account:${session.account.id}`
  const seasonNumber = source.media_type === 'tv' ? source.season_number : null
  const episodeNumber = source.media_type === 'tv' ? source.episode_number : null

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
    source.media_type, source.tmdb_id, seasonNumber, episodeNumber, input.mediaTitle, input.posterPath, input.backdropPath,
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
        seasonNumber,
        episodeNumber,
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
  const hostAccess = await createWatchPartyToken(
    { roomId, memberId: hostId, expiresAt: expiresAt ?? now + ACCESS_TTL_MS } satisfies WatchPartyAccessPayload,
    env.WATCH_PARTY_SIGNING_SECRET,
  )

  let invitationToken: string | null = null
  if (input.privacy === 'invite_only') {
    const invitationId = crypto.randomUUID()
    const invitationExpiresAt = Math.min(expiresAt ?? now + ACCESS_TTL_MS, now + ACCESS_TTL_MS)
    await env.DB.prepare('INSERT INTO watch_room_invitations (id, room_id, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(invitationId, roomId, 1, invitationExpiresAt, now).run()
    invitationToken = await createWatchPartyToken(
      { roomId, invitationId, version: 1, expiresAt: invitationExpiresAt } satisfies WatchPartyInvitationPayload,
      env.WATCH_PARTY_SIGNING_SECRET,
    )
  }
  return json({ state, accessToken: hostAccess, memberId: hostId, invitationUrl: invitationUrl(request, roomId, invitationToken) }, 201)
}

export async function lookupWatchParty(request: Request, env: Env) {
  const room = await activeRoomByCode(env.DB, new URL(request.url).searchParams.get('code'))
  const state = await roomStub(env, room.id).summary()
  return json({ room: roomSummary(room, state) })
}

export async function watchPartyRoomInfo(_request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  const state = await roomStub(env, room.id).summary()
  return json({ room: roomSummary(room, state) })
}

// Every refusal looks the same, so a guesser learns nothing about the room.
export async function joinWatchParty(request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  const body = await readJson<{ displayName?: unknown; password?: unknown; inviteToken?: unknown }>(request)
  const throttleKey = await joinThrottle.assertAllowed(request, env.DB, `watch-party:${room.id}`)
  if (room.privacy === 'private') {
    const valid = Boolean(room.password_hash && room.password_salt && room.password_iterations && typeof body.password === 'string'
      && await verifyPassword(body.password, room.password_hash, room.password_salt, room.password_iterations))
    if (!valid) {
      await joinThrottle.recordFailure(env.DB, throttleKey)
      throw roomUnavailable(403)
    }
  }
  if (room.privacy === 'invite_only' && !(await verifyInvitation(room, typeof body.inviteToken === 'string' ? body.inviteToken : null, env))) {
    await joinThrottle.recordFailure(env.DB, throttleKey)
    throw roomUnavailable(403)
  }
  const principal = await principalForJoin(request, env, body.displayName)
  const memberId = principal.principalId
  const banned = await env.DB.prepare('SELECT room_id FROM watch_room_bans WHERE room_id = ? AND principal_id = ?')
    .bind(room.id, principal.principalId).first()
  if (banned) throw roomUnavailable(403)

  let state: WatchPartyState
  try {
    state = await roomStub(env, room.id).join({ memberId, principalId: principal.principalId, displayName: principal.displayName })
  } catch {
    throw roomUnavailable(403)
  }
  return json({ state, accessToken: await accessToken(env, room, memberId), memberId })
}

export async function watchPartyState(request: Request, env: Env, roomId: string) {
  await activeRoom(env.DB, roomId)
  await accessFor(request, env, roomId)
  const state = await roomStub(env, roomId).summary()
  if (!state) throw roomUnavailable()
  return json({ state })
}

export async function watchPartyMedia(request: Request, env: Env, roomId: string) {
  const room = await activeRoom(env.DB, roomId)
  await accessFor(request, env, roomId)
  const source = await findRoomSource(env, room.media_source_id, room.media_title)
  if (!source) throw new ApiError(404, 'SOURCE_UNAVAILABLE', 'The authorised video is unavailable.')

  // Dynamic sources play through an extracted player URL. It is resolved here,
  // where the room token authorises access, so guests without an account
  // session can still load the player.
  const dynamic = isDynamicSourceId(room.media_source_id)
  let extractedUrl: string | null = null
  if (dynamic) {
    try {
      extractedUrl = await resolvePlayerUrl(env.DB, source.source_url)
    } catch {
      extractedUrl = null
    }
  }
  // A directly playable stream ('video' | 'hls') drives the app's synced
  // <video>; an iframe embed ('embed') cannot be synchronised.
  const playbackUrl = dynamic ? extractedUrl : source.source_url
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
  if (room.creator_account_id !== session.account.id || room.privacy !== 'invite_only') {
    throw new ApiError(403, 'FORBIDDEN', 'Only the host can regenerate this invitation.')
  }
  const version = room.invitation_version + 1
  const now = Date.now()
  const expiresAt = Math.min(room.expires_at ?? now + ACCESS_TTL_MS, now + ACCESS_TTL_MS)
  const invitationId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('UPDATE watch_room_invitations SET revoked_at = ? WHERE room_id = ? AND revoked_at IS NULL').bind(now, room.id),
    env.DB.prepare('UPDATE watch_rooms SET invitation_version = ?, updated_at = ? WHERE id = ?').bind(version, now, room.id),
    env.DB.prepare('INSERT INTO watch_room_invitations (id, room_id, version, expires_at, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(invitationId, room.id, version, expiresAt, now),
  ])
  const invite = await createWatchPartyToken(
    { roomId, invitationId, version, expiresAt } satisfies WatchPartyInvitationPayload,
    env.WATCH_PARTY_SIGNING_SECRET,
  )
  return json({ invitationUrl: invitationUrl(request, roomId, invite) })
}
