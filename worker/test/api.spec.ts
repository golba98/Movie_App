import { env } from 'cloudflare:workers'
import { SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { PASSWORD_ITERATIONS } from '../crypto'
import worker from '../index'
import { extractDirectPlayerUrl } from '../media-sources'

const origin = 'https://fedora.test'

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {},
) {
  const headers = new Headers()
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
