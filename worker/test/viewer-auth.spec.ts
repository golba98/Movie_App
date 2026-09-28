import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { PASSWORD_ITERATIONS } from '../auth/crypto'
import { activeViewerCookies, adminCookie, cookieFrom, createAccount, origin, request } from './helpers'

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

  it('deleting an account signs the viewer out, removes their data, and frees the username', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const accounts = (await (await request('/api/admin/accounts', { cookie: admin })).json()) as {
      data: { accounts: { id: string; username: string }[] }
    }
    const accountId = accounts.data.accounts[0].id
    const saved = await request('/api/favourites/movie/1', {
      method: 'PUT',
      cookie: viewer,
      origin,
      body: {
        id: 1,
        mediaType: 'movie',
        title: 'Dune: Part Two',
        overview: '',
        posterPath: null,
        backdropPath: null,
        voteAverage: 8.3,
        date: null,
        year: null,
        addedAt: 1_700_000_000_000,
      },
    })
    expect(saved.status).toBe(200)

    expect((await request(`/api/admin/accounts/${accountId}`, { method: 'DELETE', origin })).status).toBe(401)
    expect(
      (await request(`/api/admin/accounts/${accountId}`, { method: 'DELETE', cookie: admin, origin: 'https://attacker.test' })).status,
    ).toBe(403)

    const deleted = await request(`/api/admin/accounts/${accountId}`, { method: 'DELETE', cookie: admin, origin })
    expect(deleted.status).toBe(200)
    expect((await request('/api/auth/session', { cookie: viewer })).status).toBe(401)
    const remaining = await env.DB
      .prepare('SELECT (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM favourites) AS favourites, (SELECT COUNT(*) FROM sessions WHERE account_id IS NOT NULL) AS sessions')
      .first<{ accounts: number; favourites: number; sessions: number }>()
    expect(remaining).toEqual({ accounts: 0, favourites: 0, sessions: 0 })

    expect((await request(`/api/admin/accounts/${accountId}`, { method: 'DELETE', cookie: admin, origin })).status).toBe(404)

    const audit = (await (await request('/api/admin/audit', { cookie: admin })).json()) as {
      data: { events: { action: string; targetUsername: string | null }[] }
    }
    expect(audit.data.events).toContainEqual(expect.objectContaining({ action: 'account.delete', targetUsername: 'viewer.one' }))

    await createAccount(admin)
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
