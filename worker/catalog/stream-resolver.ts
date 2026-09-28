import type { PlaybackKind } from '../../src/types/watch-party'
import { ApiError } from '../http'
import { embedRuleFor, type EmbedRule } from './search-providers'

const EXTRACTOR_REQUEST_TIMEOUT_MS = 10_000
const MAX_PAGE_BYTES = 1_048_576
const CACHE_TTL_MS = 10 * 60 * 1_000
const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const DIRECT_STREAM_PATTERN = /https?:\/\/[^"'\s<>\\]+?\.(?:m3u8|mp4|webm)(?:[?#][^"'\s<>\\]*)?/gi
const IFRAME_SRC_PATTERN = /<iframe[^>]+src=["']([^"']+)["']/i
const PLAYER_LINK_PATTERN = /https?:\/\/[^"'\s<>]*?(vidsrc|embed|vidplay|filemoon|streamtape|mcloud|player|2embed)[^"'\s<>]*/gi

// Concurrent requests for the same page share one extraction.
const inFlight = new Map<string, Promise<string | null>>()

/**
 * How a resolved URL can be played, judged by its extension. 'video' and 'hls'
 * load into the app's own <video> and can join watch-party sync; 'embed' is an
 * opaque cross-origin iframe that cannot.
 */
export function classifyPlaybackKind(url: string): PlaybackKind {
  let pathname = url
  try {
    pathname = new URL(url).pathname
  } catch {
    // Not an absolute URL; match against the raw string.
  }
  const matches = (pattern: RegExp) => pattern.test(pathname)
  if (matches(/\.m3u8(?:$|[?#])/i)) return 'hls'
  if (matches(/\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i)) return 'video'
  return 'embed'
}

// Builds a provider's configured embed URL from the ids in one of its page URLs,
// e.g. /movie/<id>, or /tv/<id>/season/<n>?e=<n>.
function providerEmbed(url: string, rule: EmbedRule) {
  const parsed = new URL(url)
  const movieId = parsed.pathname.match(/\/movie\/([1-9]\d*)(?:\/|$)/)?.[1]
  if (movieId && !parsed.pathname.includes('/season/')) {
    return rule.movie ? rule.movie.replace(/{tmdbId}/g, movieId) : null
  }
  const showId = parsed.pathname.match(/\/tv\/([1-9]\d*)(?:\/|$)/)?.[1]
  if (!showId || !rule.tv) return null
  const season = parsed.pathname.match(/\/season\/(\d+)(?:\/|$)/)?.[1] ?? '1'
  const episode = parsed.searchParams.get('e') || parsed.searchParams.get('episode') || parsed.pathname.match(/\/episode\/(\d+)(?:\/|$)/)?.[1] || '1'
  if (![season, episode].every((value) => /^[1-9]\d*$/.test(value))) {
    throw new ApiError(400, 'INVALID_EPISODE', 'Choose a valid season and episode.')
  }
  return rule.tv.replace(/{tmdbId}/g, showId).replace(/{season}/g, season).replace(/{episode}/g, episode)
}

async function readProviderPage(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let bytes = 0
  let html = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > MAX_PAGE_BYTES) {
        await reader.cancel()
        throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This provider returned an unusable player page. Try another source.')
      }
      html += decoder.decode(value, { stream: true })
    }
    return html + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function playerUrl(candidate: string, baseUrl: string) {
  try {
    const parsed = new URL(candidate.replace(/&amp;/g, '&').replace(/\\\//g, '/'), baseUrl)
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : null
  } catch {
    return null
  }
}

/**
 * Finds the player for a provider's watch page: the provider's configured
 * embed URL when it has one, otherwise the page is scraped, preferring a
 * directly playable stream.
 */
export async function extractDirectPlayerUrl(url: string, signal: AbortSignal, rule: EmbedRule | null = null): Promise<string | null> {
  const embed = rule ? providerEmbed(url, rule) : null
  if (embed) return embed

  try {
    const response = await fetch(url, { method: 'GET', signal, headers: { 'User-Agent': BROWSER_USER_AGENT } })
    if (!response.ok) {
      await response.body?.cancel()
      console.warn('Provider unavailable', { host: new URL(url).hostname, status: response.status })
      throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This provider is unavailable. Try another source.')
    }
    const baseUrl = response.url || url
    const html = (await readProviderPage(response)).replace(/\\\//g, '/')

    // A direct stream loads into the app's own <video>, which can be synchronised.
    const direct = html.match(DIRECT_STREAM_PATTERN)?.[0]
    if (direct) return playerUrl(direct, baseUrl)

    const iframeSrc = html.match(IFRAME_SRC_PATTERN)?.[1]
    if (iframeSrc) {
      return playerUrl(iframeSrc, baseUrl)
    }

    // Fall back to the first link to a known player host that is not the page's own host.
    const originalHost = new URL(url).hostname
    const link = html.match(PLAYER_LINK_PATTERN)?.find((link) => {
      const candidate = playerUrl(link, baseUrl)
      return candidate && new URL(candidate).hostname !== originalHost
    })
    return link ? playerUrl(link, baseUrl) : null
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (signal.aborted) throw new ApiError(504, 'PROVIDER_TIMEOUT', 'This provider took too long to respond. Try another source.')
    console.warn('Provider fetch failed', { host: new URL(url).hostname })
    throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'This provider could not be reached. Try another source.')
  }
}

export async function cachedPlayerUrl(db: D1Database, sourceUrl: string) {
  try {
    const row = await db
      .prepare('SELECT extracted_url FROM stream_resolution_cache WHERE source_url = ? AND expires_at > ?')
      .bind(sourceUrl, Date.now())
      .first<{ extracted_url: string }>()
    return row?.extracted_url ?? null
  } catch {
    console.warn('Player cache read failed', { host: new URL(sourceUrl).hostname })
    return null
  }
}

export async function resolveAndCachePlayerUrl(db: D1Database, sourceUrl: string) {
  const existing = inFlight.get(sourceUrl)
  if (existing) return existing

  const resolution = (async () => {
    const rule = await embedRuleFor(db, sourceUrl)
    const extractedUrl = await extractDirectPlayerUrl(sourceUrl, AbortSignal.timeout(EXTRACTOR_REQUEST_TIMEOUT_MS), rule)
    if (!extractedUrl) return null

    const now = Date.now()
    try {
      await db
        .prepare(
          `INSERT INTO stream_resolution_cache (source_url, extracted_url, expires_at, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(source_url) DO UPDATE SET
             extracted_url = excluded.extracted_url,
             expires_at = excluded.expires_at,
             updated_at = excluded.updated_at`,
        )
        .bind(sourceUrl, extractedUrl, now + CACHE_TTL_MS, now)
        .run()
    } catch {
      console.warn('Player cache write failed', { host: new URL(sourceUrl).hostname })
    }
    return extractedUrl
  })()

  inFlight.set(sourceUrl, resolution)
  try {
    return await resolution
  } finally {
    inFlight.delete(sourceUrl)
  }
}

/** The player behind a provider page, from the cache when it is still fresh. */
export async function resolvePlayerUrl(db: D1Database, sourceUrl: string, refresh = false) {
  return (!refresh ? await cachedPlayerUrl(db, sourceUrl) : null) ?? await resolveAndCachePlayerUrl(db, sourceUrl)
}
