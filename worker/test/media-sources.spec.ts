import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { embedBlockReasonFromHeaders } from '../catalog/embed-policy'
import { classifyPlaybackKind, extractDirectPlayerUrl } from '../catalog/stream-resolver'
import { activeViewerCookies, createMediaSource, origin, request } from './helpers'

describe('authorised media-source catalog', () => {
  it('requires authentication and returns only active viewer-safe source metadata', async () => {
    expect((await request('/api/admin/media-sources')).status).toBe(401)
    expect((await request('/api/media-sources/movie/1')).status).toBe(401)

    const { admin, viewer } = await activeViewerCookies()
    const created = await createMediaSource(admin)
    expect(created.status).toBe(201)
    const createdPayload = (await created.json()) as {
      data: { source: { id: string; sourceUrl: string; rightsNote: string } }
    }
    expect(createdPayload.data.source).toEqual(expect.objectContaining({
      sourceUrl: 'https://media.example.test/dune.mp4?token=sensitive',
      rightsNote: 'Internal demonstration master.',
    }))

    const viewerList = await request('/api/media-sources/movie/1', { cookie: viewer })
    expect(viewerList.status).toBe(200)
    const viewerPayload = (await viewerList.json()) as {
      data: { sources: Record<string, unknown>[] }
    }
    expect(viewerPayload.data.sources).toEqual([
      expect.objectContaining({
        mediaType: 'movie',
        tmdbId: 1,
        sourceUrl: 'https://media.example.test/dune.mp4?token=sensitive',
        rightsBasis: 'owned',
      }),
    ])
    expect(viewerPayload.data.sources[0]).not.toHaveProperty('rightsNote')
    expect(viewerPayload.data.sources[0]).not.toHaveProperty('active')

    const audit = await request('/api/admin/audit', { cookie: admin })
    const auditPayload = (await audit.json()) as {
      data: { events: { action: string; metadata: unknown }[] }
    }
    expect(auditPayload.data.events.map((event) => event.action)).toContain('media_source.create')
    expect(JSON.stringify(auditPayload)).not.toContain('sensitive')
  })

  it('validates rights and direct URLs, enforces one source per title, and supports disable and delete', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const invalid = await createMediaSource(admin, {
      sourceUrl: 'http://insecure.example.test/movie.mp4',
      rightsBasis: 'unknown',
    })
    expect(invalid.status).toBe(400)
    const invalidPayload = (await invalid.json()) as {
      error: { fieldErrors: Record<string, string> }
    }
    expect(invalidPayload.error.fieldErrors).toHaveProperty('sourceUrl')
    expect(invalidPayload.error.fieldErrors).toHaveProperty('rightsBasis')

    const invalidEpisode = await createMediaSource(admin, {
      mediaType: 'tv',
      seasonNumber: 0,
      episodeNumber: null,
    })
    expect(invalidEpisode.status).toBe(400)

    const created = await createMediaSource(admin, { sourceUrl: '/test-media/capture-test.mp4' })
    expect(created.status).toBe(201)
    const createdPayload = (await created.json()) as { data: { source: { id: string } } }
    expect((await createMediaSource(admin)).status).toBe(409)

    const disabled = await request(`/api/admin/media-sources/${createdPayload.data.source.id}`, {
      method: 'PATCH',
      cookie: admin,
      origin,
      body: { active: false },
    })
    expect(disabled.status).toBe(200)
    const viewerList = await request('/api/media-sources/movie/1', { cookie: viewer })
    expect(await viewerList.json()).toEqual({ data: { sources: [] } })

    const removed = await request(`/api/admin/media-sources/${createdPayload.data.source.id}`, {
      method: 'DELETE',
      cookie: admin,
      origin,
    })
    expect(removed.status).toBe(200)
    const adminList = await request('/api/admin/media-sources', { cookie: admin })
    expect(await adminList.json()).toEqual({ data: { sources: [] } })
  })

  it('returns catalog metadata without fetching or proxying the media URL', async () => {
    const { admin, viewer } = await activeViewerCookies()
    await createMediaSource(admin)
    const outbound = vi.fn()
    vi.stubGlobal('fetch', outbound)
    try {
      const response = await worker.fetch(
        new Request(`${origin}/api/media-sources/movie/1`, {
          headers: { Cookie: viewer },
        }) as unknown as Parameters<typeof worker.fetch>[0],
        env,
      )
      expect(response.status).toBe(200)
      expect(outbound).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('resolves provider pages through their configured embed patterns', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const created = await request('/api/admin/search-providers', {
      method: 'POST',
      cookie: admin,
      origin,
      body: {
        label: 'Embed provider',
        baseUrl: 'https://embed-provider.example.test',
        movieEmbedPattern: 'https://embeds.example.test/movie/{tmdbId}',
        tvEmbedPattern: 'https://embeds.example.test/tv/{tmdbId}/{season}/{episode}',
      },
    })
    expect(created.status).toBe(201)

    const invalid = await request('/api/admin/search-providers', {
      method: 'POST',
      cookie: admin,
      origin,
      body: { label: 'Plain HTTP', baseUrl: 'https://plain.example.test', movieEmbedPattern: 'http://embeds.example.test/{tmdbId}' },
    })
    expect(invalid.status).toBe(400)

    // Only the embed-policy probe may reach the network; the provider page is never scraped.
    const outbound = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => new Response('', { status: 200 }))
    vi.stubGlobal('fetch', outbound)
    try {
      const extract = async (url: string) => {
        const response = await request(`/api/media-sources/extract?url=${encodeURIComponent(url)}`, { cookie: viewer })
        return ((await response.json()) as { data: { extractedUrl: string | null } }).data.extractedUrl
      }
      expect(await extract('https://embed-provider.example.test/movie/27205/inception/watch'))
        .toBe('https://embeds.example.test/movie/27205')
      expect(await extract('https://embed-provider.example.test/tv/1399/game-of-thrones/season/2?e=5'))
        .toBe('https://embeds.example.test/tv/1399/2/5')
      const fetched = outbound.mock.calls.map(([input]) => String(input))
      expect(fetched.some((url) => url.includes('embed-provider.example.test'))).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('runs independent dynamic player resolutions concurrently', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const outbound = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      return new Response('<iframe src="https://player.example.test/embed"></iframe>', { status: 200 })
    })
    vi.stubGlobal('fetch', outbound)
    try {
      const [first, second] = await Promise.all([
        extractDirectPlayerUrl('https://resolver.example.test/first', new AbortController().signal),
        extractDirectPlayerUrl('https://resolver.example.test/second', new AbortController().signal),
      ])
      expect(maxInFlight).toBe(2)
      expect([first, second]).toEqual([
        'https://player.example.test/embed',
        'https://player.example.test/embed',
      ])
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('shares and caches concurrent player resolutions for the same source', async () => {
    const { viewer } = await activeViewerCookies()
    const sourceUrl = 'https://resolver.example.test/cacheable-title'
    const outbound = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(async () => {
      await Promise.resolve()
      return new Response('<iframe src="https://player.example.test/cacheable"></iframe>', { status: 200 })
    })
    const callsTo = (url: string) => outbound.mock.calls.filter(([input]) => String(input) === url).length
    vi.stubGlobal('fetch', outbound)
    try {
      const path = `/api/media-sources/extract?url=${encodeURIComponent(sourceUrl)}`
      const expected = { data: { extractedUrl: 'https://player.example.test/cacheable', embedBlocked: null, playbackKind: 'embed' } }
      const [first, second] = await Promise.all([
        request(path, { cookie: viewer }),
        request(path, { cookie: viewer }),
      ])
      expect(await first.json()).toEqual(expected)
      expect(await second.json()).toEqual(expected)
      expect(callsTo(sourceUrl)).toBe(1)
      expect(callsTo('https://player.example.test/cacheable')).toBe(1)

      const third = await request(path, { cookie: viewer })
      expect(await third.json()).toEqual(expected)
      expect(callsTo(sourceUrl)).toBe(1)
      expect(callsTo('https://player.example.test/cacheable')).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports providers that explicitly refuse to be embedded', async () => {
    const { viewer } = await activeViewerCookies()
    const sourceUrl = 'https://resolver.example.test/refusing-title'
    const outbound = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === sourceUrl) {
        return new Response('<iframe src="https://refusing-player.example.test/embed"></iframe>', { status: 200 })
      }
      return new Response('<!doctype html>', { status: 200, headers: { 'X-Frame-Options': 'DENY' } })
    })
    vi.stubGlobal('fetch', outbound)
    try {
      const response = await request(`/api/media-sources/extract?url=${encodeURIComponent(sourceUrl)}`, { cookie: viewer })
      expect(await response.json()).toEqual({
        data: { extractedUrl: 'https://refusing-player.example.test/embed', embedBlocked: 'x-frame-options', playbackKind: 'embed' },
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('classifies explicit anti-framing headers without treating other responses as refusals', () => {
    const app = 'https://fedora.test'
    const check = (headers: HeadersInit) => embedBlockReasonFromHeaders(new Headers(headers), app)
    expect(check({ 'X-Frame-Options': 'DENY' })).toBe('x-frame-options')
    expect(check({ 'X-Frame-Options': 'sameorigin' })).toBe('x-frame-options')
    expect(check({ 'X-Frame-Options': 'ALLOW-FROM https://fedora.test' })).toBeNull()
    expect(check({ 'Content-Security-Policy': "default-src 'self'; frame-ancestors 'none'" })).toBe('frame-ancestors')
    expect(check({ 'Content-Security-Policy': "frame-ancestors 'self'" })).toBe('frame-ancestors')
    expect(check({ 'Content-Security-Policy': 'frame-ancestors https://other.test' })).toBe('frame-ancestors')
    expect(check({ 'Content-Security-Policy': 'frame-ancestors https://fedora.test' })).toBeNull()
    expect(check({ 'Content-Security-Policy': 'frame-ancestors *.test' })).toBeNull()
    expect(check({ 'Content-Security-Policy': 'frame-ancestors https:' })).toBeNull()
    expect(check({ 'Content-Security-Policy': 'frame-ancestors *' })).toBeNull()
    // frame-ancestors supersedes X-Frame-Options when both are present.
    expect(check({ 'Content-Security-Policy': 'frame-ancestors *', 'X-Frame-Options': 'DENY' })).toBeNull()
    expect(check({ 'Content-Security-Policy': "default-src 'self'" })).toBeNull()
    expect(check({})).toBeNull()
  })

  it('classifies resolved URLs by how they can be played', () => {
    expect(classifyPlaybackKind('https://cdn.example.test/movie/master.m3u8')).toBe('hls')
    expect(classifyPlaybackKind('https://cdn.example.test/movie/stream.m3u8?token=abc')).toBe('hls')
    expect(classifyPlaybackKind('https://cdn.example.test/movie/file.mp4')).toBe('video')
    expect(classifyPlaybackKind('https://cdn.example.test/movie/file.webm#t=10')).toBe('video')
    expect(classifyPlaybackKind('https://vidsrc.to/embed/movie/27205')).toBe('embed')
  })

  it('prefers a directly playable stream over an iframe embed', async () => {
    const outbound = vi.fn(async () =>
      new Response(
        '<iframe src="https://player.example.test/embed"></iframe>' +
          '<source src="https://cdn.example.test/hls/master.m3u8" type="application/x-mpegURL">',
        { status: 200 },
      ),
    )
    vi.stubGlobal('fetch', outbound)
    try {
      const resolved = await extractDirectPlayerUrl('https://resolver.example.test/direct-stream', new AbortController().signal)
      expect(resolved).toBe('https://cdn.example.test/hls/master.m3u8')
      expect(classifyPlaybackKind(resolved!)).toBe('hls')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
