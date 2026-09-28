import { describe, expect, it } from 'vitest'
import { adminCookie, createAccount, origin, request } from './helpers'

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
