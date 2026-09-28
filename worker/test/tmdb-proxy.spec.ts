import { env } from 'cloudflare:workers'
import { describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { adminCookie, cookieFrom, createAccount, origin, request } from './helpers'

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
