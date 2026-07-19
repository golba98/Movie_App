import { env } from 'cloudflare:workers'
import { runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { PASSWORD_ITERATIONS } from '../crypto'
import worker from '../index'
import { classifyPlaybackKind, extractDirectPlayerUrl } from '../media-sources'
import { driftCorrection, expectedPlaybackPosition } from '../../src/types/watch-party'

const origin = 'https://fedora.test'

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; origin?: string; headers?: HeadersInit } = {},
) {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  if (options.cookie) headers.set('Cookie', options.cookie)
  if (options.origin) headers.set('Origin', options.origin)
  return SELF.fetch(`${origin}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
}

function cookieFrom(response: Response) {
  const value = response.headers.get('set-cookie')
  expect(value).toBeTruthy()
  return value!.split(';', 1)[0]
}

async function adminCookie() {
  const response = await request('/api/admin/login', {
    method: 'POST',
    body: { password: 'unit-test-admin-password' },
    origin,
  })
  expect(response.status).toBe(200)
  return cookieFrom(response)
}

async function createAccount(
  cookie: string,
  overrides: Record<string, unknown> = {},
) {
  const response = await request('/api/admin/accounts', {
    method: 'POST',
    cookie,
    origin,
    body: {
      username: 'viewer.one',
      displayName: 'Viewer One',
      temporaryPassword: 'temporary-password-123',
      expiresAt: null,
      ...overrides,
    },
  })
  expect(response.status).toBe(201)
  return (await response.json()) as { data: { account: { id: string; username: string } } }
}

async function activeViewerCookies() {
  const admin = await adminCookie()
  const viewer = await activeViewerCookie(admin, 'viewer.one', 'Viewer One')
  return { admin, viewer }
}

async function activeViewerCookie(admin: string, username: string, displayName: string) {
  await createAccount(admin, { username, displayName })
  const login = await request('/api/auth/login', {
    method: 'POST',
    origin,
    body: { username, password: 'temporary-password-123' },
  })
  const viewer = cookieFrom(login)
  const changed = await request('/api/auth/change-password', {
    method: 'POST',
    cookie: viewer,
    origin,
    body: {
      currentPassword: 'temporary-password-123',
      newPassword: 'my-new-secure-password-456',
    },
  })
  expect(changed.status).toBe(200)
  return viewer
}

async function createMediaSource(cookie: string, overrides: Record<string, unknown> = {}) {
  return request('/api/admin/media-sources', {
    method: 'POST',
    cookie,
    origin,
    body: {
      mediaType: 'movie',
      tmdbId: 1,
      seasonNumber: null,
      episodeNumber: null,
      label: 'Owned Dune demonstration file',
      sourceUrl: 'https://media.example.test/dune.mp4?token=sensitive',
      mimeType: 'video/mp4',
      rightsBasis: 'owned',
      rightsNote: 'Internal demonstration master.',
      active: true,
      ...overrides,
    },
  })
}

describe('administrator API', () => {
  it('protects the console, creates accounts, and records audit events', async () => {
    expect((await request('/api/admin/accounts')).status).toBe(401)
    expect(
      (
        await request('/api/admin/login', {
          method: 'POST',
          body: { password: 'wrong-password' },
          origin,
        })
      ).status,
    ).toBe(401)

    const cookie = await adminCookie()
    const created = await createAccount(cookie)
    expect(created.data.account.username).toBe('viewer.one')

    const duplicate = await request('/api/admin/accounts', {
      method: 'POST',
      cookie,
      origin,
      body: {
        username: 'VIEWER.ONE',
        displayName: 'Duplicate',
        temporaryPassword: 'another-password-123',
      },
    })
    expect(duplicate.status).toBe(409)

    const audit = await request('/api/admin/audit', { cookie })
    const payload = (await audit.json()) as { data: { events: { action: string }[] } }
    expect(payload.data.events.map((event) => event.action)).toContain('account.create')
  })

  it('rejects cross-origin mutations and validates account fields', async () => {
    const cookie = await adminCookie()
    const crossOrigin = await request('/api/admin/accounts', {
      method: 'POST',
      cookie,
      origin: 'https://attacker.test',
      body: {},
    })
    expect(crossOrigin.status).toBe(403)

    const invalid = await request('/api/admin/accounts', {
      method: 'POST',
      cookie,
      origin,
      body: { username: 'x', displayName: '', temporaryPassword: 'short' },
    })
    expect(invalid.status).toBe(400)
    const payload = (await invalid.json()) as { error: { fieldErrors: Record<string, string> } }
    expect(payload.error.fieldErrors).toHaveProperty('username')
    expect(payload.error.fieldErrors).toHaveProperty('displayName')
  })
})

describe('viewer authentication and account controls', () => {
  it('requires the first password change and syncs favourites after it', async () => {
    const admin = await adminCookie()
    await createAccount(admin)

    const login = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'VIEWER.ONE', password: 'temporary-password-123' },
    })
    expect(login.status).toBe(200)
    const viewer = cookieFrom(login)
    const loginPayload = (await login.json()) as { data: { account: { mustChangePassword: boolean } } }
    expect(loginPayload.data.account.mustChangePassword).toBe(true)
    expect((await request('/api/favourites', { cookie: viewer })).status).toBe(403)

    const changed = await request('/api/auth/change-password', {
      method: 'POST',
      cookie: viewer,
      origin,
      body: {
        currentPassword: 'temporary-password-123',
        newPassword: 'my-new-secure-password-456',
      },
    })
    expect(changed.status).toBe(200)

    const saved = await request('/api/favourites/movie/1', {
      method: 'PUT',
      cookie: viewer,
      origin,
      body: {
        id: 1,
        mediaType: 'movie',
        title: 'Dune: Part Two',
        overview: 'A story.',
        posterPath: '/dune.jpg',
        backdropPath: null,
        voteAverage: 8.3,
        date: '2024-02-27',
        year: '2024',
        addedAt: 1_700_000_000_000,
      },
    })
    expect(saved.status).toBe(200)
    const favourites = await request('/api/favourites', { cookie: viewer })
    const favouritesPayload = (await favourites.json()) as {
      data: { favourites: { title: string }[] }
    }
    expect(favouritesPayload.data.favourites).toEqual([
      expect.objectContaining({ title: 'Dune: Part Two' }),
    ])
  })

  it('disabling an account revokes its viewer sessions', async () => {
    const admin = await adminCookie()
    const created = await createAccount(admin)
    const login = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'viewer.one', password: 'temporary-password-123' },
    })
    const viewer = cookieFrom(login)

    const disabled = await request(`/api/admin/accounts/${created.data.account.id}`, {
      method: 'PATCH',
      cookie: admin,
      origin,
      body: { active: false },
    })
    expect(disabled.status).toBe(200)
    expect((await request('/api/auth/session', { cookie: viewer })).status).toBe(401)
  })

  it('password resets revoke sessions and restore the first-login requirement', async () => {
    const admin = await adminCookie()
    const created = await createAccount(admin)
    const login = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'viewer.one', password: 'temporary-password-123' },
    })
    const viewer = cookieFrom(login)

    const reset = await request(`/api/admin/accounts/${created.data.account.id}/reset-password`, {
      method: 'POST',
      cookie: admin,
      origin,
      body: { temporaryPassword: 'replacement-password-456' },
    })
    expect(reset.status).toBe(200)
    expect((await request('/api/auth/session', { cookie: viewer })).status).toBe(401)
    expect(
      (
        await request('/api/auth/login', {
          method: 'POST',
          origin,
          body: { username: 'viewer.one', password: 'temporary-password-123' },
        })
      ).status,
    ).toBe(401)

    const replacementLogin = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'viewer.one', password: 'replacement-password-456' },
    })
    const payload = (await replacementLogin.json()) as {
      data: { account: { mustChangePassword: boolean } }
    }
    expect(replacementLogin.status).toBe(200)
    expect(payload.data.account.mustChangePassword).toBe(true)
  })

  it('throttles repeated viewer sign-in failures', async () => {
    const admin = await adminCookie()
    await createAccount(admin)
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failed = await request('/api/auth/login', {
        method: 'POST',
        origin,
        body: { username: 'viewer.one', password: 'incorrect-password-123' },
      })
      expect(failed.status).toBe(401)
    }
    const throttled = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'viewer.one', password: 'incorrect-password-123' },
    })
    expect(throttled.status).toBe(429)
  })

  it('stores only password and session hashes', async () => {
    const admin = await adminCookie()
    await createAccount(admin)
    const login = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'viewer.one', password: 'temporary-password-123' },
    })
    const rawCookie = cookieFrom(login).split('=', 2)[1]
    const account = await env.DB
      .prepare('SELECT password_hash, password_salt, password_iterations FROM accounts WHERE username_normalized = ?')
      .bind('viewer.one')
      .first<{ password_hash: string; password_salt: string; password_iterations: number }>()
    const session = await env.DB.prepare('SELECT token_hash FROM sessions WHERE subject_type = ?').bind('user').first<{ token_hash: string }>()

    expect(account?.password_hash).not.toContain('temporary-password-123')
    expect(account?.password_salt).toBeTruthy()
    expect(account?.password_iterations).toBe(PASSWORD_ITERATIONS)
    expect(PASSWORD_ITERATIONS).toBeLessThanOrEqual(100_000)
    expect(session?.token_hash).not.toBe(rawCookie)
  })
})

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
    const outbound = vi.fn(async () => {
      await Promise.resolve()
      return new Response('<iframe src="https://player.example.test/cacheable"></iframe>', { status: 200 })
    })
    vi.stubGlobal('fetch', outbound)
    try {
      const path = `/api/media-sources/extract?url=${encodeURIComponent(sourceUrl)}`
      const [first, second] = await Promise.all([
        request(path, { cookie: viewer }),
        request(path, { cookie: viewer }),
      ])
      expect(await first.json()).toEqual({ data: { extractedUrl: 'https://player.example.test/cacheable' } })
      expect(await second.json()).toEqual({ data: { extractedUrl: 'https://player.example.test/cacheable' } })
      expect(outbound).toHaveBeenCalledOnce()

      const third = await request(path, { cookie: viewer })
      expect(await third.json()).toEqual({ data: { extractedUrl: 'https://player.example.test/cacheable' } })
      expect(outbound).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
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

describe('TMDB proxy boundary', () => {
  it('requires a fully active viewer and rejects routes outside the allowlist', async () => {
    expect((await request('/api/tmdb/person/1')).status).toBe(401)
    const admin = await adminCookie()
    await createAccount(admin)
    const login = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'viewer.one', password: 'temporary-password-123' },
    })
    const viewer = cookieFrom(login)
    await request('/api/auth/change-password', {
      method: 'POST',
      cookie: viewer,
      origin,
      body: {
        currentPassword: 'temporary-password-123',
        newPassword: 'my-new-secure-password-456',
      },
    })
    expect((await request('/api/tmdb/person/1', { cookie: viewer })).status).toBe(404)
  })

  it('forwards only an authenticated allowlisted request with the server token', async () => {
    const admin = await adminCookie()
    await createAccount(admin)
    const login = await request('/api/auth/login', {
      method: 'POST',
      origin,
      body: { username: 'viewer.one', password: 'temporary-password-123' },
    })
    const viewer = cookieFrom(login)
    await request('/api/auth/change-password', {
      method: 'POST',
      cookie: viewer,
      origin,
      body: {
        currentPassword: 'temporary-password-123',
        newPassword: 'my-new-secure-password-456',
      },
    })

    const outbound = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.themoviedb.org/3/movie/popular?language=en-US&page=1')
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer unit-test-tmdb-token')
      return Response.json({ page: 1, results: [] })
    })
    vi.stubGlobal('fetch', outbound)
    try {
      const proxied = await worker.fetch(
        new Request(`${origin}/api/tmdb/movie/popular?language=en-US&page=1&blocked=value`, {
          headers: { Cookie: viewer },
        }) as unknown as Parameters<typeof worker.fetch>[0],
        env,
      )
      expect(proxied.status).toBe(200)
      expect(await proxied.json()).toEqual({ page: 1, results: [] })
      expect(outbound).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('watch party API', () => {
  it('hides every watch party route when WATCH_PARTY_ENABLED is not set', async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/watch-party/lookup?code=ABCD1234`, {
        headers: { Origin: origin },
      }) as unknown as Parameters<typeof worker.fetch>[0],
      { ...env, WATCH_PARTY_ENABLED: undefined as unknown as string },
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'API route not found.' } })
  })

  async function roomSource(admin: string, tmdbId = 91) {
    const response = await createMediaSource(admin, { tmdbId })
    expect(response.status).toBe(201)
    return ((await response.json()) as { data: { source: { id: string } } }).data.source
  }

  async function createRoom(viewer: string, sourceId: string, overrides: Record<string, unknown> = {}) {
    return request('/api/watch-party/rooms', {
      method: 'POST',
      cookie: viewer,
      origin,
      body: {
        roomName: 'Friday feature',
        sourceId,
        mediaTitle: 'Owned Dune demonstration file',
        posterPath: '/dune.jpg',
        backdropPath: null,
        privacy: 'public',
        maxParticipants: 8,
        controlMode: 'host_only',
        allowLateJoin: true,
        allowMediaChange: false,
        readyUpEnabled: false,
        startWhenEveryoneReady: false,
        pauseForBuffering: false,
        expiresInHours: 24,
        ...overrides,
      },
    })
  }

  async function readyRoom(overrides: Record<string, unknown> = {}) {
    const { admin, viewer } = await activeViewerCookies()
    const source = await roomSource(admin, Math.floor(100 + Math.random() * 1_000_000))
    const response = await createRoom(viewer, source.id, overrides)
    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      data: { state: { roomId: string; roomCode: string; revision: number }; accessToken: string; memberId: string }
    }
    return payload.data
  }

  async function mintExtensionToken(roomId: string, accessToken: string, nonce: string, clientSessionId: string) {
    return request(`/api/watch-party/rooms/${roomId}/extension-token`, {
      method: 'POST',
      origin,
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { nonce, clientSessionId, capabilityVersion: 1 },
    })
  }

  async function openSocket(path: string, socketOrigin?: string) {
    const response = await request(path, {
      headers: { Upgrade: 'websocket', ...(socketOrigin ? { Origin: socketOrigin } : {}) },
    })
    const webSocket = response.webSocket
    if (webSocket) webSocket.accept()
    return { response, webSocket }
  }

  function nextSocketMessage(webSocket: WebSocket, predicate: (message: Record<string, unknown>) => boolean) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2_000)
      const listener = (event: MessageEvent) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>
          if (!predicate(message)) return
          clearTimeout(timeout)
          webSocket.removeEventListener('message', listener)
          resolve(message)
        } catch {
          // Wait for the next structured event.
        }
      }
      webSocket.addEventListener('message', listener)
    })
  }

  async function authenticatedExtension(room: Awaited<ReturnType<typeof readyRoom>>, clientSessionId = crypto.randomUUID()) {
    const nonce = crypto.randomUUID()
    const tokenResponse = await mintExtensionToken(room.state.roomId, room.accessToken, nonce, clientSessionId)
    expect(tokenResponse.status).toBe(200)
    const token = ((await tokenResponse.json()) as { data: { extensionToken: string } }).data.extensionToken
    const opened = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'a'.repeat(32)}`)
    expect(opened.response.status).toBe(101)
    expect(opened.webSocket).toBeTruthy()
    const joined = nextSocketMessage(opened.webSocket!, (message) => message.type === 'room:joined')
    opened.webSocket!.send(JSON.stringify({ type: 'extension:authenticate', token, nonce, clientSessionId, capabilityVersion: 1 }))
    await joined
    return { webSocket: opened.webSocket!, token, nonce, clientSessionId }
  }

  it('creates an authenticated public room and lets a guest join with its code', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const source = await roomSource(admin)
    const created = await createRoom(viewer, source.id)
    expect(created.status).toBe(201)
    const data = (await created.json()) as { data: { state: { roomId: string; roomCode: string; participants: { role: string }[] } } }
    expect(data.data.state.participants).toEqual([expect.objectContaining({ role: 'host' })])

    const lookup = await request(`/api/watch-party/lookup?code=${data.data.state.roomCode}`)
    expect(lookup.status).toBe(200)
    const joined = await request(`/api/watch-party/rooms/${data.data.state.roomId}/join`, {
      method: 'POST',
      origin,
      body: { displayName: 'Guest viewer' },
    })
    expect(joined.status).toBe(200)
    const joinedData = (await joined.json()) as { data: { state: { participants: { displayName: string }[] }; accessToken: string } }
    expect(joinedData.data.state.participants).toContainEqual(expect.objectContaining({ displayName: 'Guest viewer' }))
    expect(joinedData.data.accessToken).toBeTruthy()
  })

  it('enforces private passwords, expiry, and server-side direct-source restrictions', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const source = await roomSource(admin, 92)
    const created = await createRoom(viewer, source.id, { privacy: 'private', password: 'a-safe-room-password' })
    expect(created.status).toBe(201)
    const roomId = ((await created.json()) as { data: { state: { roomId: string } } }).data.state.roomId

    expect((await request(`/api/watch-party/rooms/${roomId}/join`, {
      method: 'POST', origin, body: { displayName: 'Guest viewer', password: 'wrong-password' },
    })).status).toBe(403)
    expect((await request(`/api/watch-party/rooms/${roomId}/join`, {
      method: 'POST', origin, body: { displayName: 'Guest viewer', password: 'a-safe-room-password' },
    })).status).toBe(200)

    await env.DB.prepare('UPDATE watch_rooms SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, roomId).run()
    expect((await request(`/api/watch-party/rooms/${roomId}`)).status).toBe(404)

    const dynamic = await createMediaSource(admin, {
      tmdbId: 93,
      sourceUrl: 'https://flixbaba.example.test/movie/93',
    })
    const dynamicSource = ((await dynamic.json()) as { data: { source: { id: string } } }).data.source
    expect((await createRoom(viewer, dynamicSource.id)).status).toBe(400)
  })

  it('uses timestamp-derived positions and bounded drift correction', () => {
    expect(expectedPlaybackPosition({ playbackState: 'playing', positionMs: 10_000, playbackRate: 1.25, stateUpdatedAt: 1_000 }, 3_000)).toBe(12_500)
    expect(expectedPlaybackPosition({ playbackState: 'paused', positionMs: 10_000, playbackRate: 1.25, stateUpdatedAt: 1_000 }, 3_000)).toBe(10_000)
    expect(driftCorrection(250)).toEqual({ kind: 'none', rate: 1 })
    expect(driftCorrection(700)).toEqual({ kind: 'rate', rate: 1.014 })
    expect(driftCorrection(-700)).toEqual({ kind: 'rate', rate: 0.986 })
    expect(driftCorrection(1_600)).toEqual({ kind: 'seek', rate: 1 })
  })

  it('mints a 120-second participant-scoped extension token without URL credentials', async () => {
    const room = await readyRoom()
    const nonce = crypto.randomUUID()
    const clientSessionId = crypto.randomUUID()
    expect((await mintExtensionToken(room.state.roomId, 'invalid-token', nonce, clientSessionId)).status).toBe(401)
    const minted = await mintExtensionToken(room.state.roomId, room.accessToken, nonce, clientSessionId)
    expect(minted.status).toBe(200)
    const payload = (await minted.json()) as { data: { extensionToken: string; expiresAt: number; capabilityVersion: number } }
    expect(payload.data.capabilityVersion).toBe(1)
    expect(payload.data.expiresAt - Date.now()).toBeGreaterThan(115_000)
    expect(payload.data.expiresAt - Date.now()).toBeLessThanOrEqual(120_000)
    const decoded = JSON.parse(atob(payload.data.extensionToken.split('.')[0].replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(payload.data.extensionToken.split('.')[0].length / 4) * 4, '='))) as Record<string, unknown>
    expect(decoded).toMatchObject({ purpose: 'browser-extension', roomId: room.state.roomId, memberId: room.memberId, nonce, clientSessionId, capabilityVersion: 1 })
    expect(decoded.tokenId).toBeTruthy()
    expect((await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket?access=${room.accessToken}`, `chrome-extension://${'a'.repeat(32)}`)).response.status).toBe(400)
  })

  it('keeps manual room-code extension joining local-only', async () => {
    const room = await readyRoom()
    const body = {
      roomCode: room.state.roomCode,
      displayName: 'Local extension viewer',
      nonce: crypto.randomUUID(),
      clientSessionId: crypto.randomUUID(),
      capabilityVersion: 1,
    }
    expect((await request('/api/watch-party/extension/dev-connect', {
      method: 'POST',
      origin: `chrome-extension://${'f'.repeat(32)}`,
      body,
    })).status).toBe(404)
    const local = await SELF.fetch('http://127.0.0.1/api/watch-party/extension/dev-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${'f'.repeat(32)}` },
      body: JSON.stringify(body),
    })
    expect(local.status).toBe(200)
    const payload = (await local.json()) as { data: { extensionToken: string; memberId: string } }
    expect(payload.data.extensionToken).toBeTruthy()
    expect(payload.data.memberId).toContain('guest:')
  })

  it('rejects invalid extension origins and requires authentication as the first message', async () => {
    const room = await readyRoom()
    expect((await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, 'https://attacker.test')).response.status).toBe(403)
    const opened = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'b'.repeat(32)}`)
    expect(opened.response.status).toBe(101)
    const error = nextSocketMessage(opened.webSocket!, (message) => message.type === 'error')
    opened.webSocket!.send(JSON.stringify({ type: 'room:sync-request', eventId: crypto.randomUUID(), baseRevision: 0 }))
    expect(await error).toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('rejects an expired extension token even when the socket itself is newly opened', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-18T05:00:00Z'))
      const room = await readyRoom()
      const nonce = crypto.randomUUID()
      const clientSessionId = crypto.randomUUID()
      const tokenResponse = await mintExtensionToken(room.state.roomId, room.accessToken, nonce, clientSessionId)
      const token = ((await tokenResponse.json()) as { data: { extensionToken: string } }).data.extensionToken
      vi.setSystemTime(new Date('2026-07-18T05:02:01Z'))
      const opened = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'e'.repeat(32)}`)
      const error = nextSocketMessage(opened.webSocket!, (message) => message.type === 'error')
      opened.webSocket!.send(JSON.stringify({ type: 'extension:authenticate', token, nonce, clientSessionId, capabilityVersion: 1 }))
      expect(await error).toMatchObject({ code: 'AUTH_INVALID' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects token replay and expires pending authentication through the room alarm', async () => {
    const room = await readyRoom()
    const first = await authenticatedExtension(room)
    const replay = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'c'.repeat(32)}`)
    const replayError = nextSocketMessage(replay.webSocket!, (message) => message.type === 'error')
    replay.webSocket!.send(JSON.stringify({ type: 'extension:authenticate', token: first.token, nonce: first.nonce, clientSessionId: first.clientSessionId, capabilityVersion: 1 }))
    expect(await replayError).toMatchObject({ code: 'TOKEN_REPLAYED' })

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 11_000)
    const pending = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'d'.repeat(32)}`)
    const close = new Promise<CloseEvent>((resolve) => pending.webSocket!.addEventListener('close', resolve, { once: true }))
    vi.setSystemTime(Date.now() + 11_000)
    await runDurableObjectAlarm(env.WATCH_PARTY_ROOM.getByName(room.state.roomId))
    await vi.runAllTimersAsync()
    expect((await close).code).toBe(4401)
    vi.useRealTimers()
  })

  it('replaces only the older extension session and keeps the website socket connected', async () => {
    const room = await readyRoom()
    const website = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/socket?access=${encodeURIComponent(room.accessToken)}`, origin)
    expect(website.response.status).toBe(101)
    let websiteClosed = false
    website.webSocket!.addEventListener('close', () => { websiteClosed = true })
    const clientSessionId = crypto.randomUUID()
    const first = await authenticatedExtension(room, clientSessionId)
    const firstClosed = new Promise<CloseEvent>((resolve) => first.webSocket.addEventListener('close', resolve, { once: true }))
    const second = await authenticatedExtension(room, clientSessionId)
    expect((await firstClosed).code).toBe(4001)
    expect(second.webSocket.readyState).toBe(WebSocket.OPEN)
    expect(websiteClosed).toBe(false)
    expect(website.webSocket!.readyState).toBe(WebSocket.OPEN)
  })

  it('stores extension snapshots only in attachments without changing authority or revision', async () => {
    const room = await readyRoom()
    const extension = await authenticatedExtension(room)
    extension.webSocket.send(JSON.stringify({
      type: 'playback:client-snapshot',
      eventId: crypto.randomUUID(),
      baseRevision: room.state.revision,
      positionMs: 55_000,
      playbackState: 'playing',
      playbackRate: 1,
      buffering: false,
      readyState: 4,
      driftMs: 900,
    }))
    await Promise.resolve()
    const summary = await env.WATCH_PARTY_ROOM.getByName(room.state.roomId).summary()
    expect(summary?.revision).toBe(room.state.revision)
    expect(summary?.positionMs).toBe(0)
  })

  it('preserves stale-control and host authority checks while echoing sync event IDs', async () => {
    const room = await readyRoom()
    const website = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/socket?access=${encodeURIComponent(room.accessToken)}`, origin)
    const syncId = crypto.randomUUID()
    const sync = nextSocketMessage(website.webSocket!, (message) => message.type === 'playback:sync')
    website.webSocket!.send(JSON.stringify({ type: 'room:sync-request', eventId: syncId, baseRevision: 0 }))
    expect(await sync).toMatchObject({ eventId: syncId })
    const stale = nextSocketMessage(website.webSocket!, (message) => message.type === 'error')
    website.webSocket!.send(JSON.stringify({ type: 'playback:play-request', eventId: crypto.randomUUID(), baseRevision: 99 }))
    expect(await stale).toMatchObject({ code: 'STALE_REVISION', revision: 0 })
    const accepted = nextSocketMessage(website.webSocket!, (message) => message.type === 'playback:state')
    website.webSocket!.send(JSON.stringify({ type: 'playback:play-request', eventId: crypto.randomUUID(), baseRevision: 0 }))
    const message = await accepted
    expect(message.command).toMatchObject({ reason: 'play' })
    expect((message.command as { executeAtServerMs: number }).executeAtServerMs).toBeGreaterThan(Date.now())
  })

  it('keeps host-only playback authority unchanged for extension-capable rooms', async () => {
    const room = await readyRoom({ controlMode: 'host_only' })
    const joined = await request(`/api/watch-party/rooms/${room.state.roomId}/join`, {
      method: 'POST',
      origin,
      body: { displayName: 'Participant viewer' },
    })
    const guest = (await joined.json()) as { data: { accessToken: string; state: { revision: number } } }
    const guestSocket = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/socket?access=${encodeURIComponent(guest.data.accessToken)}`, origin)
    const forbidden = nextSocketMessage(guestSocket.webSocket!, (message) => message.type === 'error')
    guestSocket.webSocket!.send(JSON.stringify({ type: 'playback:play-request', eventId: crypto.randomUUID(), baseRevision: guest.data.state.revision }))
    expect(await forbidden).toMatchObject({ code: 'CONTROL_FORBIDDEN' })
  })
})
