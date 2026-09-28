import type { PlaybackKind } from '../../src/types/watch-party'

const EXTRACTOR_REQUEST_TIMEOUT_MS = 12_000
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
  const matches = (pattern: RegExp) => pattern.test(pathname) || pattern.test(url)
  if (matches(/\.m3u8(?:$|[?#])/i)) return 'hls'
  if (matches(/\.(?:mp4|webm|mov|m4v)(?:$|[?#])/i)) return 'video'
  return 'embed'
}

// Known dynamic hosts render their player client-side, so their pages are
// mapped straight to the matching vidsrc embed instead of being scraped.
function knownHostEmbed(url: string) {
  if (!url.includes('flixbaba') && !url.includes('soap2day')) return null
  const movieMatch = url.match(/\/movie\/(\d+)/)
  if (movieMatch && !url.includes('/season/')) return `https://vidsrc.to/embed/movie/${movieMatch[1]}`

  const tvMatch = url.match(/\/tv\/(\d+)/)
  if (!tvMatch) return null
  const season = url.match(/\/season\/(\d+)/)?.[1] ?? '1'
  const episodeFromPath = () => url.match(/\/episode\/(\d+)/)?.[1]
  let episode = '1'
  try {
    const parsed = new URL(url)
    episode = parsed.searchParams.get('e') || parsed.searchParams.get('episode') || '1'
    if (episode === '1') episode = episodeFromPath() ?? episode
  } catch {
    episode = episodeFromPath() ?? episode
  }
  return `https://vidsrc.to/embed/tv/${tvMatch[1]}/${season}/${episode}`
}

/** Finds the player inside a provider's watch page, preferring a directly playable stream. */
export async function extractDirectPlayerUrl(url: string, signal: AbortSignal): Promise<string | null> {
  const known = knownHostEmbed(url)
  if (known) return known

  try {
    const response = await fetch(url, { method: 'GET', signal, headers: { 'User-Agent': BROWSER_USER_AGENT } })
    if (response.status !== 200) return null
    const html = await response.text()

    // A direct stream loads into the app's own <video>, which can be synchronised.
    const direct = html.match(DIRECT_STREAM_PATTERN)?.[0]
    if (direct) return direct.replace(/\\\//g, '/')

    const iframeSrc = html.match(IFRAME_SRC_PATTERN)?.[1]
    if (iframeSrc) {
      if (iframeSrc.startsWith('//')) return `https:${iframeSrc}`
      if (iframeSrc.startsWith('/')) return `${new URL(url).origin}${iframeSrc}`
      return iframeSrc
    }

    // Fall back to the first link to a known player host that is not the page's own host.
    const originalHost = new URL(url).hostname
    return html.match(PLAYER_LINK_PATTERN)?.find((link) => !link.includes(originalHost)) ?? null
  } catch (error) {
    if (signal.aborted) return null
    console.error(`Failed to extract player from ${url}:`, error)
    return null
  }
}

export async function cachedPlayerUrl(db: D1Database, sourceUrl: string) {
  const row = await db
    .prepare('SELECT extracted_url FROM stream_resolution_cache WHERE source_url = ? AND expires_at > ?')
    .bind(sourceUrl, Date.now())
    .first<{ extracted_url: string }>()
  return row?.extracted_url ?? null
}

export async function resolveAndCachePlayerUrl(db: D1Database, sourceUrl: string) {
  const existing = inFlight.get(sourceUrl)
  if (existing) return existing

  const resolution = (async () => {
    const extractedUrl = await extractDirectPlayerUrl(sourceUrl, AbortSignal.timeout(EXTRACTOR_REQUEST_TIMEOUT_MS))
    if (!extractedUrl) return null

    const now = Date.now()
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
export async function resolvePlayerUrl(db: D1Database, sourceUrl: string) {
  return await cachedPlayerUrl(db, sourceUrl) ?? await resolveAndCachePlayerUrl(db, sourceUrl)
}
