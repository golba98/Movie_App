import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import { embedRuleFor } from '../catalog/search-providers'
import { extractDirectPlayerUrl, resolvePlayerUrl } from '../catalog/stream-resolver'
import { activeViewerCookies, origin, request } from './helpers'

describe('provider playback configuration', () => {
  it('resolves the screenshot episode using the migrated Flixbaba player', async () => {
    const { viewer } = await activeViewerCookies()
    const outbound = vi.fn(async () => new Response('<title>Player</title>'))
    vi.stubGlobal('fetch', outbound)
    try {
      const source = 'https://www.flixbaba.best/tv/387/spongebob-squarepants/season/1?e=30'
      const response = await request(`/api/media-sources/extract?url=${encodeURIComponent(source)}`, { cookie: viewer })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: {
        extractedUrl: 'https://vsembed.ru/embed/tv?tmdb=387&season=1&episode=30',
        embedBlocked: null,
        playbackKind: 'embed',
      } })
      // The player page is probed once; the subtitle lookup finds nothing usable, so no subtitle is attached.
      expect(outbound).toHaveBeenCalledTimes(2)
      expect(outbound).toHaveBeenCalledWith('https://vsembed.ru/embed/tv?tmdb=387&season=1&episode=30', expect.objectContaining({ method: 'GET' }))
      expect(outbound).toHaveBeenCalledWith('https://data.vidsrc.sh/api.php?type=tv&tmdb=387&season=1&episode=30', expect.anything())
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('creates and edits embed patterns and invalidates resolved players', async () => {
    const { admin } = await activeViewerCookies()
    const payload = {
      label: 'Custom provider', baseUrl: 'https://provider.example.test/catalog',
      movieEmbedPattern: 'https://player.example.test/movie/{tmdbId}',
      tvEmbedPattern: 'https://player.example.test/tv/{tmdbId}/{season}/{episode}',
    }
    const created = await request('/api/admin/search-providers', { method: 'POST', cookie: admin, origin, body: payload })
    expect(created.status).toBe(201)
    const { data: { provider } } = await created.json() as { data: { provider: { id: string; movieEmbedPattern: string } } }
    expect(provider.movieEmbedPattern).toBe(payload.movieEmbedPattern)
    await env.DB.prepare('INSERT INTO stream_resolution_cache VALUES (?, ?, ?, ?)')
      .bind('https://provider.example.test/catalog/movie/1', 'https://old-player.test/1', Date.now() + 60_000, Date.now()).run()
    const updated = await request(`/api/admin/search-providers/${provider.id}`, {
      method: 'PATCH', cookie: admin, origin, body: { movieEmbedPattern: 'https://new-player.test/movie/{tmdbId}' },
    })
    expect(updated.status).toBe(200)
    expect(await embedRuleFor(env.DB, 'https://provider.example.test/catalog/movie/1')).toEqual({
      movie: 'https://new-player.test/movie/{tmdbId}', tv: payload.tvEmbedPattern,
    })
    expect(await embedRuleFor(env.DB, 'https://provider.example.test.evil.test/catalog/movie/1')).toBeNull()
    expect(await embedRuleFor(env.DB, 'https://provider.example.test/catalogue/movie/1')).toBeNull()
    expect(await env.DB.prepare('SELECT count(*) AS count FROM stream_resolution_cache').first('count')).toBe(0)
  })

  it('reports an inaccessible Soap2Day source without mapping it to another provider', async () => {
    const { viewer } = await activeViewerCookies()
    const outbound = vi.fn(async () => new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', outbound)
    try {
      const source = 'https://ww25.soap2day.day/tv/387/spongebob-squarepants/season/1?e=30'
      const response = await request(`/api/media-sources/extract?url=${encodeURIComponent(source)}`, { cookie: viewer })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: { code: 'PROVIDER_UNAVAILABLE' } })
      expect(outbound).toHaveBeenCalledTimes(1)
      expect(outbound).toHaveBeenCalledWith(source, expect.objectContaining({ method: 'GET' }))
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('preserves movie and episode identities in configured templates', async () => {
    const signal = new AbortController().signal
    const rule = { movie: 'https://player.test/movie/{tmdbId}', tv: 'https://player.test/tv/{tmdbId}/{season}/{episode}' }
    expect(await extractDirectPlayerUrl('https://provider.test/movie/27205/inception/watch', signal, rule)).toBe('https://player.test/movie/27205')
    expect(await extractDirectPlayerUrl('https://provider.test/tv/387/name/season/2/episode/9?e=1', signal, rule)).toBe('https://player.test/tv/387/2/1')
    expect(await extractDirectPlayerUrl('https://provider.test/tv/387/name/season/2/episode/9', signal, rule)).toBe('https://player.test/tv/387/2/9')
    await expect(extractDirectPlayerUrl('https://provider.test/tv/387/name/season/2?e=bad', signal, rule)).rejects.toMatchObject({ code: 'INVALID_EPISODE' })
  })

  it('resolves fresh players on retry and tolerates a missing cache table', async () => {
    const source = 'https://provider.test/movie/1'
    let number = 0
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<iframe src="https://player.test/${++number}"></iframe>`)))
    try {
      expect(await resolvePlayerUrl(env.DB, source)).toBe('https://player.test/1')
      expect(await resolvePlayerUrl(env.DB, source)).toBe('https://player.test/1')
      expect(await resolvePlayerUrl(env.DB, source, true)).toBe('https://player.test/2')
      await env.DB.prepare('ALTER TABLE stream_resolution_cache RENAME TO cache_backup').run()
      try {
        expect(await resolvePlayerUrl(env.DB, source)).toBe('https://player.test/3')
      } finally {
        await env.DB.prepare('ALTER TABLE cache_backup RENAME TO stream_resolution_cache').run()
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('returns playback kinds for direct streams without probing iframe policies', async () => {
    const { viewer } = await activeViewerCookies()
    const outbound = vi.fn(async () => new Response('<source src="https://cdn.test/master.m3u8?token=abc">'))
    vi.stubGlobal('fetch', outbound)
    try {
      const response = await request('/api/media-sources/extract?url=https%3A%2F%2Fprovider.test%2Fmovie%2F1', { cookie: viewer })
      expect(await response.json()).toEqual({ data: {
        extractedUrl: 'https://cdn.test/master.m3u8?token=abc', playbackKind: 'hls', embedBlocked: null,
      } })
      expect(outbound).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports aborted upstream requests as timeouts', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.stubGlobal('fetch', vi.fn(async () => { throw controller.signal.reason }))
    try {
      await expect(extractDirectPlayerUrl('https://provider.test/movie/1', controller.signal)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not mistake a rejected server probe for the browser player policy and rechecks on retry', async () => {
    const { viewer } = await activeViewerCookies()
    let playerStatus = 403
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      return String(input).includes('provider.test')
        ? new Response('<iframe src="https://unavailable-player.test/embed"></iframe>')
        : new Response('<title>Player</title>', { status: playerStatus, headers: { 'X-Frame-Options': 'DENY' } })
    }))
    try {
      const path = '/api/media-sources/extract?url=https%3A%2F%2Fprovider.test%2Fmovie%2F1'
      const initial = await request(path, { cookie: viewer })
      expect(initial.status).toBe(200)
      expect(await initial.json()).toMatchObject({ data: { extractedUrl: 'https://unavailable-player.test/embed', embedBlocked: null } })
      playerStatus = 200
      const response = await request(`${path}&refresh=1`, { cookie: viewer })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ data: { extractedUrl: 'https://unavailable-player.test/embed', embedBlocked: 'x-frame-options', playbackKind: 'embed' } })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
