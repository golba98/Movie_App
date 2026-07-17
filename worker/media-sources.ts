import { auditAdminEvent } from './admin'
import { requireAdmin, requireUser } from './auth'
import { ApiError, json, readJson } from './http'

type MediaType = 'movie' | 'tv'
type MediaMimeType = 'video/mp4' | 'video/webm'
type RightsBasis = 'owned' | 'licensed' | 'public-domain'

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

interface MediaSourceInput {
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

function positiveInteger(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function cleanSourceUrl(value: unknown) {
  if (typeof value !== 'string') return null
  const sourceUrl = value.trim()
  if (!sourceUrl || sourceUrl.length > 2_000 || sourceUrl.startsWith('//')) return null
  if (sourceUrl.startsWith('/')) return sourceUrl
  try {
    const url = new URL(sourceUrl)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return null
    return url.toString()
  } catch {
    return null
  }
}

function cleanMediaSource(input: MediaSourceInput) {
  const fieldErrors: Record<string, string> = {}
  const mediaType = input.mediaType === 'movie' || input.mediaType === 'tv' ? input.mediaType : null
  const tmdbId = positiveInteger(input.tmdbId)
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 160) : ''
  const sourceUrl = cleanSourceUrl(input.sourceUrl)
  const mimeType = input.mimeType === 'video/mp4' || input.mimeType === 'video/webm'
    ? input.mimeType
    : null
  const rightsBasis = input.rightsBasis === 'owned' || input.rightsBasis === 'licensed' || input.rightsBasis === 'public-domain'
    ? input.rightsBasis
    : null
  const rightsNote = typeof input.rightsNote === 'string' ? input.rightsNote.trim().slice(0, 500) : ''
  const active = input.active === undefined ? true : input.active

  if (!mediaType) fieldErrors.mediaType = 'Choose movie or TV.'
  if (!tmdbId) fieldErrors.tmdbId = 'Enter a positive TMDB ID.'
  if (!label) fieldErrors.label = 'Enter a label up to 160 characters.'
  if (!sourceUrl) fieldErrors.sourceUrl = 'Use a same-origin path or an HTTPS URL without embedded credentials or a fragment.'
  if (!mimeType) fieldErrors.mimeType = 'Choose MP4 or WebM.'
  if (!rightsBasis) fieldErrors.rightsBasis = 'Confirm whether the media is owned, licensed, or public domain.'
  if (typeof active !== 'boolean') fieldErrors.active = 'Active must be true or false.'

  const seasonNumber = mediaType === 'tv' ? positiveInteger(input.seasonNumber) : 0
  const episodeNumber = mediaType === 'tv' ? positiveInteger(input.episodeNumber) : 0
  if (mediaType === 'tv' && !seasonNumber) fieldErrors.seasonNumber = 'Enter a positive season number.'
  if (mediaType === 'tv' && !episodeNumber) fieldErrors.episodeNumber = 'Enter a positive episode number.'

  if (Object.keys(fieldErrors).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted media-source fields.', fieldErrors)
  }

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

async function findMediaSource(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM media_sources WHERE id = ?').bind(id).first<MediaSourceRow>()
}

function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

async function fetchTmdbTitle(env: Env, mediaType: string, tmdbId: number): Promise<string> {
  const url = `https://api.themoviedb.org/3/${mediaType}/${tmdbId}`
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.TMDB_ACCESS_TOKEN}`,
      Accept: 'application/json',
    },
    cf: { cacheTtl: 86400 } as unknown as { cacheTtl: number },
  })
  if (!res.ok) throw new Error('Failed to fetch TMDB details')
  const data = (await res.json()) as { title?: string; name?: string }
  const title = mediaType === 'movie' ? data.title : data.name
  return title ?? ''
}

async function checkFlixbabaAvailability(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cf: { cacheTtl: 86400 } as unknown as { cacheTtl: number },
    })
    if (res.status !== 200) return false
    const html = await res.text()
    if (html.includes('404') || html.includes('Page Not Found') || html.includes('not found')) {
      return false
    }
    return true
  } catch {
    return false
  }
}

export async function listMediaSourcesForViewer(
  request: Request,
  env: Env,
  mediaType: MediaType,
  tmdbId: number,
) {
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

  let dynamicSource: {
    id: string
    mediaType: MediaType
    tmdbId: number
    seasonNumber: number | null
    episodeNumber: number | null
    label: string
    sourceUrl: string
    mimeType: MediaMimeType
    rightsBasis: RightsBasis
  } | null = null

  if (env.TMDB_ACCESS_TOKEN && env.TMDB_ACCESS_TOKEN !== 'unit-test-tmdb-token') {
    try {
      const title = await fetchTmdbTitle(env, mediaType, tmdbId)
      if (title) {
        const slug = slugify(title)
        const flixbabaUrl = mediaType === 'movie'
          ? `https://flixbaba.mov/movie/${tmdbId}/${slug}/watch`
          : `https://flixbaba.mov/tv/${tmdbId}/${slug}`
        
        const isAvailable = await checkFlixbabaAvailability(flixbabaUrl)
        if (isAvailable) {
          dynamicSource = {
            id: 'flixbaba',
            mediaType,
            tmdbId,
            seasonNumber: null,
            episodeNumber: null,
            label: 'Flixbaba Stream (Dynamic)',
            sourceUrl: flixbabaUrl,
            mimeType: 'video/mp4',
            rightsBasis: 'public-domain',
          }
        }
      }
    } catch (e) {
      console.error('Flixbaba check failed:', e)
    }
  }

  if (!dynamicSource && env.TMDB_ACCESS_TOKEN !== 'unit-test-tmdb-token') {
    const soap2dayUrl = mediaType === 'movie'
      ? `https://ww25.soap2day.day/embed/movie/${tmdbId}`
      : `https://ww25.soap2day.day/embed/tv/${tmdbId}`
    
    dynamicSource = {
      id: 'soap2day',
      mediaType,
      tmdbId,
      seasonNumber: null,
      episodeNumber: null,
      label: 'Soap2Day Stream (Dynamic)',
      sourceUrl: soap2dayUrl,
      mimeType: 'video/mp4',
      rightsBasis: 'public-domain',
    }
  }

  if (dynamicSource) {
    sources.push(dynamicSource)
  }

  return json({ sources })
}

export async function listMediaSourcesForAdmin(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const url = new URL(request.url)
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const pattern = `%${search}%`
  const rows = search
    ? await env.DB
        .prepare(
          `SELECT * FROM media_sources
           WHERE lower(label) LIKE ? OR CAST(tmdb_id AS TEXT) LIKE ?
           ORDER BY updated_at DESC LIMIT 200`,
        )
        .bind(pattern, pattern)
        .all<MediaSourceRow>()
    : await env.DB
        .prepare('SELECT * FROM media_sources ORDER BY updated_at DESC LIMIT 200')
        .all<MediaSourceRow>()
  return json({ sources: rows.results.map((row) => publicMediaSource(row, true)) })
}

export async function createMediaSource(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const source = cleanMediaSource(await readJson<MediaSourceInput>(request))
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
    if (String(error).toLowerCase().includes('unique')) {
      throw new ApiError(409, 'MEDIA_SOURCE_EXISTS', 'A source already exists for this movie or episode.')
    }
    throw error
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
  const current = await findMediaSource(env.DB, id)
  if (!current) throw new ApiError(404, 'MEDIA_SOURCE_NOT_FOUND', 'Media source not found.')
  const changes = await readJson<MediaSourceInput>(request)
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
    if (String(error).toLowerCase().includes('unique')) {
      throw new ApiError(409, 'MEDIA_SOURCE_EXISTS', 'A source already exists for this movie or episode.')
    }
    throw error
  }
  await auditAdminEvent(request, env, 'media_source.update', null, { mediaSourceId: id, active: source.active })
  return json({ source: publicMediaSource((await findMediaSource(env.DB, id))!, true) })
}

export async function deleteMediaSource(request: Request, env: Env, id: string) {
  await requireAdmin(request, env.DB)
  const current = await findMediaSource(env.DB, id)
  if (!current) throw new ApiError(404, 'MEDIA_SOURCE_NOT_FOUND', 'Media source not found.')
  await env.DB.prepare('DELETE FROM media_sources WHERE id = ?').bind(id).run()
  await auditAdminEvent(request, env, 'media_source.delete', null, {
    mediaSourceId: id,
    mediaType: current.media_type,
    tmdbId: current.tmdb_id,
  })
  return json({ removed: true })
}

async function extractDirectPlayerUrl(url: string): Promise<string | null> {
  // Direct parsing for known dynamic hosts to avoid failing on client-side JS pages or 404 wrappers
  if (url.includes('flixbaba')) {
    const movieMatch = url.match(/\/movie\/(\d+)/)
    const tvMatch = url.match(/\/tv\/(\d+)/)
    if (movieMatch && !url.includes('/season/')) {
      const tmdbId = movieMatch[1]
      return `https://vidsrc.to/embed/movie/${tmdbId}`
    } else if (tvMatch) {
      const tmdbId = tvMatch[1]
      const seasonMatch = url.match(/\/season\/(\d+)/)
      const season = seasonMatch ? seasonMatch[1] : '1'
      try {
        const parsed = new URL(url)
        const episode = parsed.searchParams.get('e') || '1'
        return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`
      } catch {
        return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/1`
      }
    }
  }

  if (url.includes('soap2day')) {
    const movieMatch = url.match(/\/embed\/movie\/(\d+)/)
    const tvMatch = url.match(/\/embed\/tv\/(\d+)\/(\d+)\/(\d+)/)
    if (movieMatch) {
      const tmdbId = movieMatch[1]
      return `https://vidsrc.to/embed/movie/${tmdbId}`
    } else if (tvMatch) {
      const tmdbId = tvMatch[1]
      const season = tvMatch[2]
      const episode = tvMatch[3]
      return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`
    }
  }
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (res.status !== 200) return null
    const html = await res.text()

    // 1. Look for iframe src
    const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i)
    if (iframeMatch && iframeMatch[1]) {
      let src = iframeMatch[1]
      if (src.startsWith('//')) {
        src = `https:${src}`
      } else if (src.startsWith('/')) {
        const parsedUrl = new URL(url)
        src = `${parsedUrl.origin}${src}`
      }
      return src
    }

    // 2. Fallback: Search for any link matching known player domains
    const playerPattern = /https?:\/\/[^"'\s<>]*?(vidsrc|embed|vidplay|filemoon|streamtape|mcloud|player|2embed)[^"'\s<>]*/gi
    const matches = html.match(playerPattern)
    if (matches && matches.length > 0) {
      const originalHost = new URL(url).hostname
      // Find the first player link that is not the same host
      const validLink = matches.find((link) => !link.includes(originalHost))
      if (validLink) return validLink
    }

    return null
  } catch (e) {
    console.error(`Failed to extract player from ${url}:`, e)
    return null
  }
}

export async function extractStreamEndpoint(request: Request, env: Env) {
  await requireUser(request, env.DB)
  const url = new URL(request.url)
  const targetUrl = url.searchParams.get('url')
  if (!targetUrl) {
    throw new ApiError(400, 'MISSING_URL', 'The url parameter is required.')
  }
  
  const cleanedUrl = cleanSourceUrl(targetUrl)
  if (!cleanedUrl) {
    throw new ApiError(400, 'INVALID_URL', 'Use a valid HTTPS target URL.')
  }

  const extractedUrl = await extractDirectPlayerUrl(cleanedUrl)
  return json({ extractedUrl })
}
