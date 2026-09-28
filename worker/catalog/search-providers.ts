import type { MediaType } from '../../src/types/tmdb'
import { requireAdmin } from '../auth/sessions'
import { auditAdminEvent } from '../auth/audit'
import { ApiError, json, readJson } from '../http'
import { assertNoFieldErrors, trimmedString } from '../validate'

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

interface SearchProviderPayload {
  label?: unknown
  baseUrl?: unknown
  movieUrlPattern?: unknown
  tvUrlPattern?: unknown
  active?: unknown
}

const DEFAULT_PATTERNS: Record<MediaType, string> = {
  movie: '{baseUrl}/movie/{tmdbId}/{slug}/watch',
  tv: '{baseUrl}/tv/{tmdbId}/{slug}',
}

// Dynamic source ids look like `dynamic:<providerId>:<mediaType>:<tmdbId>`.
const DYNAMIC_PREFIX = 'dynamic:'

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function buildProviderUrl(pattern: string, baseUrl: string, tmdbId: number, slug: string, mediaType: MediaType) {
  return (pattern || DEFAULT_PATTERNS[mediaType])
    .replace(/{baseUrl}/g, baseUrl)
    .replace(/{tmdbId}/g, String(tmdbId))
    .replace(/{slug}/g, slug)
}

function providerUrl(provider: SearchProviderRow, mediaType: MediaType, tmdbId: number, title: string) {
  const pattern = mediaType === 'movie' ? provider.movie_url_pattern : provider.tv_url_pattern
  return buildProviderUrl(pattern, provider.base_url, tmdbId, slugify(title), mediaType)
}

export const dynamicSourceId = (providerId: string, mediaType: MediaType, tmdbId: number) =>
  `${DYNAMIC_PREFIX}${providerId}:${mediaType}:${tmdbId}`

export const isDynamicSourceId = (sourceId: string) => sourceId.startsWith(DYNAMIC_PREFIX)

export async function activeSearchProviders(db: D1Database) {
  const rows = await db
    .prepare('SELECT * FROM search_providers WHERE is_active = 1 ORDER BY created_at ASC')
    .all<SearchProviderRow>()
  return rows.results
}

/** One playable source per active provider, pointing at that provider's page for the title. */
export function dynamicSourcesFor(providers: SearchProviderRow[], mediaType: MediaType, tmdbId: number, title: string) {
  return providers.map((provider) => ({
    id: dynamicSourceId(provider.id, mediaType, tmdbId),
    mediaType,
    tmdbId,
    seasonNumber: null,
    episodeNumber: null,
    label: `${provider.label} Stream (Dynamic)`,
    sourceUrl: providerUrl(provider, mediaType, tmdbId, title),
    mimeType: 'video/mp4' as const,
    rightsBasis: 'licensed' as const,
    isDynamic: true,
  }))
}

/**
 * Rebuilds a dynamic source from its id, or null when its provider is gone or
 * inactive. The title slug comes from `title`, the name the room was made for.
 */
export async function resolveDynamicSource(db: D1Database, sourceId: string, title: string) {
  const [, providerId, rawMediaType, rawTmdbId] = sourceId.split(':')
  const mediaType = rawMediaType as MediaType
  const tmdbId = Number(rawTmdbId)
  const provider = await db
    .prepare('SELECT * FROM search_providers WHERE id = ? AND is_active = 1')
    .bind(providerId)
    .first<SearchProviderRow>()
  if (!provider) return null
  return {
    id: sourceId,
    mediaType,
    tmdbId,
    label: `${provider.label} Stream (Dynamic)`,
    sourceUrl: providerUrl(provider, mediaType, tmdbId, title),
  }
}

function cleanSearchProvider(input: SearchProviderPayload) {
  const fieldErrors: Record<string, string> = {}
  const label = trimmedString(input.label, 160)
  const baseUrl = trimmedString(input.baseUrl, 500)
  const movieUrlPattern = trimmedString(input.movieUrlPattern, 500)
  const tvUrlPattern = trimmedString(input.tvUrlPattern, 500)
  const active = input.active === undefined ? true : input.active

  if (!label) fieldErrors.label = 'Enter a label.'
  if (!baseUrl) fieldErrors.baseUrl = 'Enter a base URL.'
  if (typeof active !== 'boolean') fieldErrors.active = 'Active must be true or false.'
  assertNoFieldErrors(fieldErrors, 'Check search provider fields.')

  return { label, baseUrl, movieUrlPattern, tvUrlPattern, active: active as boolean }
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

function findSearchProvider(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM search_providers WHERE id = ?').bind(id).first<SearchProviderRow>()
}

async function requireSearchProvider(db: D1Database, id: string) {
  const provider = await findSearchProvider(db, id)
  if (!provider) throw new ApiError(404, 'PROVIDER_NOT_FOUND', 'Search provider not found.')
  return provider
}

export async function listSearchProvidersForAdmin(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const rows = await env.DB
    .prepare('SELECT * FROM search_providers ORDER BY updated_at DESC')
    .all<SearchProviderRow>()
  return json({ providers: rows.results.map(publicSearchProvider) })
}

export async function createSearchProvider(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const provider = cleanSearchProvider(await readJson<SearchProviderPayload>(request))
  const id = crypto.randomUUID()
  const now = Date.now()
  await env.DB
    .prepare(
      `INSERT INTO search_providers
        (id, label, base_url, movie_url_pattern, tv_url_pattern, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, provider.label, provider.baseUrl, provider.movieUrlPattern, provider.tvUrlPattern, provider.active ? 1 : 0, now, now)
    .run()

  await auditAdminEvent(request, env, 'search_provider.create', null, { searchProviderId: id, label: provider.label })
  return json({ provider: publicSearchProvider((await findSearchProvider(env.DB, id))!) }, 201)
}

export async function updateSearchProvider(request: Request, env: Env, id: string) {
  await requireAdmin(request, env.DB)
  const current = await requireSearchProvider(env.DB, id)
  const changes = await readJson<SearchProviderPayload>(request)
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
    .bind(provider.label, provider.baseUrl, provider.movieUrlPattern, provider.tvUrlPattern, provider.active ? 1 : 0, Date.now(), id)
    .run()

  await auditAdminEvent(request, env, 'search_provider.update', null, { searchProviderId: id, label: provider.label })
  return json({ provider: publicSearchProvider((await findSearchProvider(env.DB, id))!) })
}

export async function deleteSearchProvider(request: Request, env: Env, id: string) {
  await requireAdmin(request, env.DB)
  const current = await requireSearchProvider(env.DB, id)
  await env.DB.prepare('DELETE FROM search_providers WHERE id = ?').bind(id).run()
  await auditAdminEvent(request, env, 'search_provider.delete', null, { searchProviderId: id, label: current.label })
  return json({ removed: true })
}
