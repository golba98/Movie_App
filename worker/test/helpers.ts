import { SELF } from 'cloudflare:test'
import { expect } from 'vitest'

export const origin = 'https://fedora.test'

export async function request(
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

export function cookieFrom(response: Response) {
  const value = response.headers.get('set-cookie')
  expect(value).toBeTruthy()
  return value!.split(';', 1)[0]
}

export async function adminCookie() {
  const response = await request('/api/admin/login', {
    method: 'POST',
    body: { password: 'unit-test-admin-password' },
    origin,
  })
  expect(response.status).toBe(200)
  return cookieFrom(response)
}

export async function createAccount(
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

export async function activeViewerCookies() {
  const admin = await adminCookie()
  const viewer = await activeViewerCookie(admin, 'viewer.one', 'Viewer One')
  return { admin, viewer }
}

export async function activeViewerCookie(admin: string, username: string, displayName: string) {
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

export async function createMediaSource(cookie: string, overrides: Record<string, unknown> = {}) {
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
