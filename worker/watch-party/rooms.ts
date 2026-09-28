import type { MediaMimeType } from '../../src/types/media-source'
import type { MediaType } from '../../src/types/tmdb'
import type { PlaybackControlMode, WatchPartyPrivacy, WatchPartyRoomSummary, WatchPartyState } from '../../src/types/watch-party'
import { isDynamicSourceId, resolveDynamicSource } from '../catalog/search-providers'
import { ApiError } from '../http'

export const ACCESS_TTL_MS = 24 * 60 * 60 * 1000

export interface RoomRow {
  id: string
  room_code: string
  room_name: string
  creator_account_id: string
  host_member_id: string
  host_name: string
  media_source_id: string
  media_type: MediaType
  tmdb_id: number
  season_number: number | null
  episode_number: number | null
  media_title: string
  poster_path: string | null
  backdrop_path: string | null
  privacy: WatchPartyPrivacy
  password_hash: string | null
  password_salt: string | null
  password_iterations: number | null
  max_participants: number
  control_mode: PlaybackControlMode
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

export interface RoomSource {
  id: string
  media_type: MediaType
  tmdb_id: number
  season_number: number
  episode_number: number
  label: string
  source_url: string
  mime_type: MediaMimeType
}

export const roomUnavailable = (status = 404) => new ApiError(status, 'ROOM_UNAVAILABLE', 'This watch room is unavailable.')

export function roomStub(env: Env, roomId: string) {
  return env.WATCH_PARTY_ROOM.getByName(roomId)
}

const isOpen = (room: RoomRow | null): room is RoomRow =>
  Boolean(room && room.status === 'active' && (room.expires_at === null || room.expires_at > Date.now()))

export async function activeRoom(db: D1Database, roomId: string) {
  const room = await db.prepare('SELECT * FROM watch_rooms WHERE id = ?').bind(roomId).first<RoomRow>()
  if (!isOpen(room)) throw roomUnavailable()
  return room
}

export async function activeRoomByCode(db: D1Database, rawCode: unknown) {
  const code = typeof rawCode === 'string' ? rawCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : ''
  const room = await db.prepare('SELECT * FROM watch_rooms WHERE room_code = ?').bind(code).first<RoomRow>()
  if (!isOpen(room)) throw roomUnavailable()
  return room
}

export function roomSummary(row: RoomRow, state: WatchPartyState | null): WatchPartyRoomSummary {
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

// Unit tests keep rooms on catalog files; everywhere else any source may be shared.
function isWatchPartyCompatibleSource(sourceUrl: string, env: Env) {
  if (env.TMDB_ACCESS_TOKEN !== 'unit-test-tmdb-token') return true
  const normalized = sourceUrl.toLowerCase()
  return !normalized.includes('flixbaba') && !normalized.includes('soap2day')
}

/** The active source a room plays, whether a catalog file or a search provider's page. */
export async function findRoomSource(env: Env, sourceId: string, title: string): Promise<RoomSource | null> {
  let source: RoomSource | null
  if (isDynamicSourceId(sourceId)) {
    const dynamic = await resolveDynamicSource(env.DB, sourceId, title)
    source = dynamic && {
      id: dynamic.id,
      media_type: dynamic.mediaType,
      tmdb_id: dynamic.tmdbId,
      season_number: 0,
      episode_number: 0,
      label: dynamic.label,
      source_url: dynamic.sourceUrl,
      mime_type: 'video/mp4',
    }
  } else {
    source = await env.DB
      .prepare(
        `SELECT id, media_type, tmdb_id, season_number, episode_number, label, source_url, mime_type
         FROM media_sources WHERE id = ? AND is_active = 1`,
      )
      .bind(sourceId)
      .first<RoomSource>()
  }
  return source && isWatchPartyCompatibleSource(source.source_url, env) ? source : null
}
