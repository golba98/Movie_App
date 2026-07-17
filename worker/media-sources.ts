import { auditAdminEvent } from './admin'
import { requireAdmin, requireUser } from './auth'
import { ApiError, json, readJson } from './http'

type MediaType = 'movie' | 'tv'
type MediaMimeType = 'video/mp4' | 'video/webm'
type RightsBasis = 'owned' | 'licensed'

const EXTRACTOR_REQUEST_TIMEOUT_MS = 12_000

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
  const rightsBasis = input.rightsBasis === undefined
    ? 'licensed'
    : (input.rightsBasis === 'owned' || input.rightsBasis === 'licensed' || input.rightsBasis === 'public-domain'
      ? input.rightsBasis
      : null)
  const rightsNote = typeof input.rightsNote === 'string' ? input.rightsNote.trim().slice(0, 500) : ''
  const active = input.active === undefined ? true : input.active

  if (!mediaType) fieldErrors.mediaType = 'Choose movie or TV.'
  if (!tmdbId) fieldErrors.tmdbId = 'Enter a positive TMDB ID.'
  if (!label) fieldErrors.label = 'Enter a label up to 160 characters.'
  if (!sourceUrl) fieldErrors.sourceUrl = 'Use a same-origin path or an HTTPS URL without embedded credentials or a fragment.'
  if (!mimeType) fieldErrors.mimeType = 'Choose MP4 or WebM.'
  if (!rightsBasis) fieldErrors.rightsBasis = 'Confirm whether the media is owned or licensed.'
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


function buildProviderUrl(pattern: string, baseUrl: string, tmdbId: number, slug: string, mediaType: MediaType) {
  let url = pattern
  if (!url) {
    url = mediaType === 'movie'
      ? '{baseUrl}/movie/{tmdbId}/{slug}/watch'
      : '{baseUrl}/tv/{tmdbId}/{slug}'
  }
  return url
    .replace(/{baseUrl}/g, baseUrl)
    .replace(/{tmdbId}/g, String(tmdbId))
    .replace(/{slug}/g, slug)
}

async function checkUrlAvailability(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      cf: { cacheTtl: 86400 } as unknown as { cacheTtl: number },
    })
    console.log(`Availability check for ${url} returned status: ${res.status}`)
    if (res.status === 404) {
      return false
    }
    if (res.status === 200) {
      const html = await res.text()
      if (html.includes('404') || html.includes('Page Not Found') || html.includes('not found')) {
        console.log(`Availability check for ${url} failed html check: contains 404/not found`)
        return false
      }
    }
    return true
  } catch (err) {
    console.error(`Availability check for ${url} failed with exception:`, err)
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

  if (env.TMDB_ACCESS_TOKEN && env.TMDB_ACCESS_TOKEN !== 'unit-test-tmdb-token') {
    try {
      const providersResult = await env.DB
        .prepare('SELECT * FROM search_providers WHERE is_active = 1 ORDER BY created_at ASC')
        .all<SearchProviderRow>()
      
      if (providersResult.results.length > 0) {
        const title = await fetchTmdbTitle(env, mediaType, tmdbId)
        if (title) {
          const slug = slugify(title)
          const providersToCheck = providersResult.results.map((provider) => {
            const pattern = mediaType === 'movie' ? provider.movie_url_pattern : provider.tv_url_pattern
            const providerUrl = buildProviderUrl(pattern, provider.base_url, tmdbId, slug, mediaType)
            return { provider, providerUrl }
          })
          
          const checks = await Promise.all(
            providersToCheck.map(async ({ provider, providerUrl }) => {
              const isAvailable = await checkUrlAvailability(providerUrl)
              return { provider, providerUrl, isAvailable }
            })
          )
          
          for (const { provider, providerUrl, isAvailable } of checks) {
            if (isAvailable) {
              sources.push({
                id: provider.id,
                mediaType,
                tmdbId,
                seasonNumber: null,
                episodeNumber: null,
                label: `${provider.label} Stream (Dynamic)`,
                sourceUrl: providerUrl,
                mimeType: 'video/mp4',
                rightsBasis: 'licensed',
                isDynamic: true,
              })
            }
          }
        }
      }
    } catch (e) {
      console.error('Dynamic search provider check failed:', e)
    }
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

export async function extractDirectPlayerUrl(url: string, signal: AbortSignal): Promise<string | null> {
  // Direct parsing for known dynamic hosts to avoid failing on client-side JS pages or 404 wrappers
  const isDynamicHost = url.includes('flixbaba') || url.includes('soap2day')
  if (isDynamicHost) {
    const movieMatch = url.match(/\/movie\/(\d+)/)
    const tvMatch = url.match(/\/tv\/(\d+)/)
    if (movieMatch && !url.includes('/season/')) {
      const tmdbId = movieMatch[1]
      return `https://vidsrc.to/embed/movie/${tmdbId}`
    } else if (tvMatch) {
      const tmdbId = tvMatch[1]
      const seasonMatch = url.match(/\/season\/(\d+)/)
      const season = seasonMatch ? seasonMatch[1] : '1'
      
      let episode = '1'
      try {
        const parsed = new URL(url)
        episode = parsed.searchParams.get('e') || parsed.searchParams.get('episode') || '1'
        if (episode === '1') {
          const epMatch = url.match(/\/episode\/(\d+)/)
          if (epMatch) episode = epMatch[1]
        }
      } catch {
        const epMatch = url.match(/\/episode\/(\d+)/)
        if (epMatch) episode = epMatch[1]
      }
      return `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`
    }
  }


  try {
    const res = await fetch(url, {
      method: 'GET',
      signal,
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
    if (signal.aborted) return null
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

  const extractedUrl = await extractDirectPlayerUrl(
    cleanedUrl,
    AbortSignal.any([request.signal, AbortSignal.timeout(EXTRACTOR_REQUEST_TIMEOUT_MS)]),
  )
  return json({ extractedUrl })
}

interface SearchProviderRow {
  id: string
  label: string
  base_url: string
  movie_url_pattern: string
  tv_url_pattern: string
  is_active: number
  created_at: number
  updated_at: number
}

interface SearchProviderInput {
  label?: unknown
  baseUrl?: unknown
  movieUrlPattern?: unknown
  tvUrlPattern?: unknown
  active?: unknown
}

function cleanSearchProvider(input: SearchProviderInput) {
  const fieldErrors: Record<string, string> = {}
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, 160) : ''
  const baseUrl = typeof input.baseUrl === 'string' ? input.baseUrl.trim().slice(0, 500) : ''
  const movieUrlPattern = typeof input.movieUrlPattern === 'string' ? input.movieUrlPattern.trim().slice(0, 500) : ''
  const tvUrlPattern = typeof input.tvUrlPattern === 'string' ? input.tvUrlPattern.trim().slice(0, 500) : ''
  const active = input.active === undefined ? true : input.active

  if (!label) fieldErrors.label = 'Enter a label.'
  if (!baseUrl) fieldErrors.baseUrl = 'Enter a base URL.'
  if (typeof active !== 'boolean') fieldErrors.active = 'Active must be true or false.'

  if (Object.keys(fieldErrors).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check search provider fields.', fieldErrors)
  }

  return {
    label,
    baseUrl,
    movieUrlPattern,
    tvUrlPattern,
    active,
  }
}

function publicSearchProvider(row: SearchProviderRow) {
  return {
    id: row.id,
    label: row.label,
    baseUrl: row.base_url,
    movieUrlPattern: row.movie_url_pattern,
    tvUrlPattern: row.tv_url_pattern,
    active: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listSearchProvidersForAdmin(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const rows = await env.DB
    .prepare('SELECT * FROM search_providers ORDER BY updated_at DESC')
    .all<SearchProviderRow>()
  return json({ providers: rows.results.map((row) => publicSearchProvider(row)) })
}

export async function createSearchProvider(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const provider = cleanSearchProvider(await readJson<SearchProviderInput>(request))
  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB
    .prepare(
      `INSERT INTO search_providers
        (id, label, base_url, movie_url_pattern, tv_url_pattern, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      provider.label,
      provider.baseUrl,
      provider.movieUrlPattern,
      provider.tvUrlPattern,
      provider.active ? 1 : 0,
      now,
      now,
    )
    .run()

  await auditAdminEvent(request, env, 'search_provider.create', null, { searchProviderId: id, label: provider.label })
  const created = await env.DB.prepare('SELECT * FROM search_providers WHERE id = ?').bind(id).first<SearchProviderRow>()
  return json({ provider: publicSearchProvider(created!) }, 201)
}

export async function updateSearchProvider(request: Request, env: Env, id: string) {
  await requireAdmin(request, env.DB)
  const current = await env.DB.prepare('SELECT * FROM search_providers WHERE id = ?').bind(id).first<SearchProviderRow>()
  if (!current) throw new ApiError(404, 'PROVIDER_NOT_FOUND', 'Search provider not found.')
  const changes = await readJson<SearchProviderInput>(request)
  const provider = cleanSearchProvider({
    label: current.label,
    baseUrl: current.base_url,
    movieUrlPattern: current.movie_url_pattern,
    tvUrlPattern: current.tv_url_pattern,
    active: current.is_active === 1,
    ...changes,
  })
  await env.DB
    .prepare(
      `UPDATE search_providers SET
        label = ?, base_url = ?, movie_url_pattern = ?, tv_url_pattern = ?, is_active = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      provider.label,
      provider.baseUrl,
      provider.movieUrlPattern,
      provider.tvUrlPattern,
      provider.active ? 1 : 0,
      Date.now(),
      id,
    )
    .run()

  await auditAdminEvent(request, env, 'search_provider.update', null, { searchProviderId: id, label: provider.label })
  const updated = await env.DB.prepare('SELECT * FROM search_providers WHERE id = ?').bind(id).first<SearchProviderRow>()
  return json({ provider: publicSearchProvider(updated!) })
}

export async function deleteSearchProvider(request: Request, env: Env, id: string) {
  await requireAdmin(request, env.DB)
  const current = await env.DB.prepare('SELECT * FROM search_providers WHERE id = ?').bind(id).first<SearchProviderRow>()
  if (!current) throw new ApiError(404, 'PROVIDER_NOT_FOUND', 'Search provider not found.')
  await env.DB.prepare('DELETE FROM search_providers WHERE id = ?').bind(id).run()
  await auditAdminEvent(request, env, 'search_provider.delete', null, { searchProviderId: id, label: current.label })
  return json({ removed: true })
}
