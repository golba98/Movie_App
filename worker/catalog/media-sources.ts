import type { MediaMimeType, RightsBasis } from '../../src/types/media-source'
import type { MediaType } from '../../src/types/tmdb'
import { auditAdminEvent } from '../auth/audit'
import { requireAdmin, requireUser } from '../auth/sessions'
import { ApiError, json, readJson } from '../http'
import { assertNoFieldErrors, positiveInteger, rethrowUniqueViolation, trimmedString } from '../validate'
import { probeEmbedPolicy } from './embed-policy'
import { activeSearchProviders, dynamicSourcesFor } from './search-providers'
import { classifyPlaybackKind, resolvePlayerUrl } from './stream-resolver'
import { withSubtitle } from './subtitles'
import { fetchTmdbTitle } from './tmdb'

const MAX_ADMIN_RESULTS = 200
const MAX_SOURCE_URL_LENGTH = 2_000

interface MediaSourceRow {
  id: string
  media_type: MediaType
  tmdb_id: number
  season_number: number
  episode_number: number
  label: string
  source_url: string
  mime_type: MediaMimeType
  rights_basis: RightsBasis
  rights_note: string
  is_active: number
  created_at: number
  updated_at: number
}

interface MediaSourcePayload {
  mediaType?: unknown
  tmdbId?: unknown
  seasonNumber?: unknown
  episodeNumber?: unknown
  label?: unknown
  sourceUrl?: unknown
  mimeType?: unknown
  rightsBasis?: unknown
  rightsNote?: unknown
  active?: unknown
}

const sourceExists = () => new ApiError(409, 'MEDIA_SOURCE_EXISTS', 'A source already exists for this movie or episode.')

function publicMediaSource(row: MediaSourceRow, includeAdminFields = false) {
  return {
    id: row.id,
    mediaType: row.media_type,
    tmdbId: row.tmdb_id,
    seasonNumber: row.media_type === 'tv' ? row.season_number : null,
    episodeNumber: row.media_type === 'tv' ? row.episode_number : null,
    label: row.label,
    sourceUrl: row.source_url,
    mimeType: row.mime_type,
    rightsBasis: row.rights_basis,
    isDynamic: false as boolean | undefined,
    ...(includeAdminFields
      ? {
          rightsNote: row.rights_note,
          active: row.is_active === 1,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        }
      : {}),
  }
}

/** A same-origin path, or an HTTPS URL without credentials or a fragment. */
function cleanSourceUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const sourceUrl = value.trim()
  if (!sourceUrl || sourceUrl.length > MAX_SOURCE_URL_LENGTH || sourceUrl.startsWith('//')) return null
  if (sourceUrl.startsWith('/')) return sourceUrl
  try {
    const url = new URL(sourceUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    return url.toString()
  } catch {
    return null
  }
}

function cleanRightsBasis(value: unknown) {
  if (value === undefined) return 'licensed'
  return value === 'owned' || value === 'licensed' || value === 'public-domain' ? value : null
}

function cleanMediaSource(input: MediaSourcePayload) {
  const fieldErrors: Record<string, string> = {}
  const mediaType = input.mediaType === 'movie' || input.mediaType === 'tv' ? input.mediaType : null
  const tmdbId = positiveInteger(input.tmdbId)
  const label = trimmedString(input.label, 160)
  const sourceUrl = cleanSourceUrl(input.sourceUrl)
  const mimeType = input.mimeType === 'video/mp4' || input.mimeType === 'video/webm' ? input.mimeType : null
  const rightsBasis = cleanRightsBasis(input.rightsBasis)
  const rightsNote = trimmedString(input.rightsNote, 500)
  const active = input.active === undefined ? true : input.active

  if (!mediaType) fieldErrors.mediaType = 'Choose movie or TV.'
  if (!tmdbId) fieldErrors.tmdbId = 'Enter a positive TMDB ID.'
  if (!label) fieldErrors.label = 'Enter a label up to 160 characters.'
  if (!sourceUrl) fieldErrors.sourceUrl = 'Use a same-origin path or an HTTPS URL without embedded credentials or a fragment.'
  if (!mimeType) fieldErrors.mimeType = 'Choose MP4 or WebM.'
  if (!rightsBasis) fieldErrors.rightsBasis = 'Confirm whether the media is owned or licensed.'
  if (typeof active !== 'boolean') fieldErrors.active = 'Active must be true or false.'

  // Movies store 0 for season and episode so the unique index still applies.
  const seasonNumber = mediaType === 'tv' ? positiveInteger(input.seasonNumber) : 0
  const episodeNumber = mediaType === 'tv' ? positiveInteger(input.episodeNumber) : 0
  if (mediaType === 'tv' && !seasonNumber) fieldErrors.seasonNumber = 'Enter a positive season number.'
  if (mediaType === 'tv' && !episodeNumber) fieldErrors.episodeNumber = 'Enter a positive episode number.'
  assertNoFieldErrors(fieldErrors, 'Check the highlighted media-source fields.')

  return {
    mediaType: mediaType!,
    tmdbId: tmdbId!,
    seasonNumber: seasonNumber!,
    episodeNumber: episodeNumber!,
    label,
    sourceUrl: sourceUrl!,
    mimeType: mimeType!,
    rightsBasis: rightsBasis!,
    rightsNote,
    active: active as boolean,
  }
}

function findMediaSource(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM media_sources WHERE id = ?').bind(id).first<MediaSourceRow>()
}

async function requireMediaSource(db: D1Database, id: string) {
  const source = await findMediaSource(db, id)
  if (!source) throw new ApiError(404, 'MEDIA_SOURCE_NOT_FOUND', 'Media source not found.')
  return source
}

/** Sources a viewer can play: the catalog's active files, then one per active search provider. */
export async function listMediaSourcesForViewer(request: Request, env: Env, mediaType: MediaType, tmdbId: number) {
  await requireUser(request, env.DB)
  const rows = await env.DB
    .prepare(
      `SELECT * FROM media_sources
       WHERE media_type = ? AND tmdb_id = ? AND is_active = 1
       ORDER BY season_number, episode_number`,
    )
    .bind(mediaType, tmdbId)
    .all<MediaSourceRow>()
  const sources = rows.results.map((row) => publicMediaSource(row))

  if (env.TMDB_ACCESS_TOKEN && env.TMDB_ACCESS_TOKEN !== 'unit-test-tmdb-token') {
    try {
      const providers = await activeSearchProviders(env.DB)
      const title = providers.length ? await fetchTmdbTitle(env, mediaType, tmdbId) : ''
      if (title) sources.push(...dynamicSourcesFor(providers, mediaType, tmdbId, title))
    } catch (error) {
      console.error('Dynamic search provider check failed:', error)
    }
  }

  return json({ sources })
}

export async function listMediaSourcesForAdmin(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const search = new URL(request.url).searchParams.get('search')?.trim().toLowerCase() ?? ''
  const pattern = `%${search}%`
  const rows = search
    ? await env.DB
        .prepare(
          `SELECT * FROM media_sources
           WHERE lower(label) LIKE ? OR CAST(tmdb_id AS TEXT) LIKE ?
           ORDER BY updated_at DESC LIMIT ?`,
        )
        .bind(pattern, pattern, MAX_ADMIN_RESULTS)
        .all<MediaSourceRow>()
    : await env.DB
        .prepare('SELECT * FROM media_sources ORDER BY updated_at DESC LIMIT ?')
        .bind(MAX_ADMIN_RESULTS)
        .all<MediaSourceRow>()
  return json({ sources: rows.results.map((row) => publicMediaSource(row, true)) })
}

export async function createMediaSource(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const source = cleanMediaSource(await readJson<MediaSourcePayload>(request))
  const id = crypto.randomUUID()
  const now = Date.now()
  try {
    await env.DB
      .prepare(
        `INSERT INTO media_sources
          (id, media_type, tmdb_id, season_number, episode_number, label, source_url,
           mime_type, rights_basis, rights_note, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        source.mediaType,
        source.tmdbId,
        source.seasonNumber,
        source.episodeNumber,
        source.label,
        source.sourceUrl,
        source.mimeType,
        source.rightsBasis,
        source.rightsNote,
        source.active ? 1 : 0,
        now,
        now,
      )
      .run()
  } catch (error) {
    rethrowUniqueViolation(error, sourceExists())
  }
  await auditAdminEvent(request, env, 'media_source.create', null, {
    mediaSourceId: id,
    mediaType: source.mediaType,
    tmdbId: source.tmdbId,
    seasonNumber: source.seasonNumber,
    episodeNumber: source.episodeNumber,
  })
  return json({ source: publicMediaSource((await findMediaSource(env.DB, id))!, true) }, 201)
}

export async function updateMediaSource(request: Request, env: Env, id: string) {
  await requireAdmin(request, env.DB)
  const current = await requireMediaSource(env.DB, id)
  const changes = await readJson<MediaSourcePayload>(request)
  const source = cleanMediaSource({
    mediaType: current.media_type,
    tmdbId: current.tmdb_id,
    seasonNumber: current.season_number,
    episodeNumber: current.episode_number,
    label: current.label,
    sourceUrl: current.source_url,
    mimeType: current.mime_type,
    rightsBasis: current.rights_basis,
    rightsNote: current.rights_note,
    active: current.is_active === 1,
    ...changes,
  })
  try {
    await env.DB
      .prepare(
        `UPDATE media_sources SET
          media_type = ?, tmdb_id = ?, season_number = ?, episode_number = ?, label = ?,
          source_url = ?, mime_type = ?, rights_basis = ?, rights_note = ?, is_active = ?,
          updated_at = ? WHERE id = ?`,
      )
      .bind(
        source.mediaType,
        source.tmdbId,
        source.seasonNumber,
        source.episodeNumber,
        source.label,
        source.sourceUrl,
        source.mimeType,
        source.rightsBasis,
        source.rightsNote,
        source.active ? 1 : 0,
        Date.now(),
        id,
      )
      .run()
  } catch (error) {
    rethrowUniqueViolation(error, sourceExists())
  }
  await auditAdminEvent(request, env, 'media_source.update', null, { mediaSourceId: id, active: source.active })
  return json({ source: publicMediaSource((await findMediaSource(env.DB, id))!, true) })
}

export async function deleteMediaSource(request: Request, env: Env, id: string) {
  await requireAdmin(request, env.DB)
  const current = await requireMediaSource(env.DB, id)
  await env.DB.prepare('DELETE FROM media_sources WHERE id = ?').bind(id).run()
  await auditAdminEvent(request, env, 'media_source.delete', null, {
    mediaSourceId: id,
    mediaType: current.media_type,
    tmdbId: current.tmdb_id,
  })
  return json({ removed: true })
}

/**
 * Resolves a dynamic source's page to its player, and reports whether that
 * player refuses to be framed here so the client can offer another source.
 * A Source 1 player comes back with a checked English subtitle attached.
 */
export async function extractStreamEndpoint(request: Request, env: Env) {
  await requireUser(request, env.DB)
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')
  if (!targetUrl) throw new ApiError(400, 'MISSING_URL', 'The url parameter is required.')

  const cleanedUrl = cleanSourceUrl(targetUrl)
  if (!cleanedUrl || !cleanedUrl.startsWith('https://')) throw new ApiError(400, 'INVALID_URL', 'Use a valid HTTPS target URL.')

  const refresh = url.searchParams.get('refresh') === '1'
  const extractedUrl = await resolvePlayerUrl(env.DB, cleanedUrl, refresh)
  const playbackKind = extractedUrl ? classifyPlaybackKind(extractedUrl) : null
  const duration = Number(url.searchParams.get('duration'))
  const context = {
    observedDuration: Number.isFinite(duration) && duration > 0 && duration <= 86400 ? duration : undefined,
    releaseFingerprint: url.searchParams.get('release') ?? undefined,
    subtitleId: url.searchParams.get('subtitle') ?? undefined,
  }
  const [embedBlocked, subtitles] = await Promise.all([
    extractedUrl && playbackKind === 'embed' ? probeEmbedPolicy(extractedUrl, url.origin, refresh) : null,
    extractedUrl ? withSubtitle(env, extractedUrl, url.origin, context) : null,
  ])
  return json({ extractedUrl: subtitles?.playerUrl ?? null, embedBlocked, playbackKind,
    ...(subtitles && 'subtitles' in subtitles ? { subtitles: subtitles.subtitles } : {}),
    ...(subtitles && 'subtitleNotice' in subtitles ? { subtitleNotice: subtitles.subtitleNotice } : {}),
    ...(subtitles && 'subtitleContext' in subtitles ? { subtitleContext: subtitles.subtitleContext } : {}),
  })
}
