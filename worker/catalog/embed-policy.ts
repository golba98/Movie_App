import type { EmbedBlockReason } from '../../src/types/media-source'

const PROBE_TIMEOUT_MS = 4_000
const CACHE_TTL_MS = 10 * 60 * 1_000

const cache = new Map<string, { expiresAt: number; result: Promise<EmbedBlockReason | null> }>()

function defaultPort(url: URL) {
  return url.port || (url.protocol === 'https:' ? '443' : '80')
}

function frameAncestorsAllows(sources: string[], appOrigin: string) {
  const app = new URL(appOrigin)
  return sources.some((rawSource) => {
    const source = rawSource.toLowerCase().replace(/\/$/, '')
    if (source === '*') return true
    // 'self' and 'none' refer to the provider, never to this app.
    if (source.startsWith("'")) return false
    if (source === app.protocol) return true
    const match = source.match(/^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*\.)?([^:/]+)(?::(\d+|\*))?$/)
    if (!match) return false
    const [, scheme, wildcard, host, port] = match
    if (scheme && `${scheme}:` !== app.protocol) return false
    if (port && port !== '*' && port !== defaultPort(app)) return false
    return wildcard ? app.hostname.endsWith(`.${host}`) : app.hostname === host
  })
}

/**
 * Why a provider explicitly refuses to be framed by this app, from its
 * response headers. Only explicit policies count; anything else is null.
 */
export function embedBlockReasonFromHeaders(headers: Headers, appOrigin: string): EmbedBlockReason | null {
  // CSP frame-ancestors supersedes X-Frame-Options in modern browsers.
  let sawFrameAncestors = false
  for (const policy of (headers.get('content-security-policy') ?? '').split(',')) {
    const directive = policy
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .find(([name]) => name?.toLowerCase() === 'frame-ancestors')
    if (!directive) continue
    sawFrameAncestors = true
    if (!frameAncestorsAllows(directive.slice(1), appOrigin)) return 'frame-ancestors'
  }
  if (sawFrameAncestors) return null

  const frameOptions = headers.get('x-frame-options')?.trim().toUpperCase()
  // ALLOW-FROM is obsolete and ignored by current browsers.
  if (frameOptions === 'DENY' || frameOptions === 'SAMEORIGIN') return 'x-frame-options'
  return null
}

/**
 * Checks whether the resolved player explicitly refuses to be embedded by this
 * app. It only reads the provider's own policy so the client can fall back
 * cleanly; it never alters or works around that policy.
 */
export function probeEmbedPolicy(url: string, appOrigin: string): Promise<EmbedBlockReason | null> {
  const cacheKey = `${appOrigin}|${url}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.result

  const result = (async () => {
    try {
      const response = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      await response.body?.cancel()
      return embedBlockReasonFromHeaders(response.headers, appOrigin)
    } catch {
      return null
    }
  })()

  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, result })
  return result
}
