import type { ViewerAccount } from '../../src/types/account'
import { ApiError, parseCookies } from '../http'
import { createThrottle } from '../throttle'
import { randomToken, sha256 } from './crypto'

const USER_COOKIE = 'fedora_session'
const ADMIN_COOKIE = 'fedora_admin'
const USER_SESSION_MS = 30 * 24 * 60 * 60 * 1000
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000

type SessionKind = 'user' | 'admin'

export const signInThrottle = createThrottle('auth_attempts', 'Too many sign-in attempts. Try again in 15 minutes.')

export interface AccountRow {
  id: string
  username: string
  username_normalized: string
  display_name: string
  password_hash: string
  password_salt: string
  password_iterations: number
  is_active: number
  must_change_password: number
  expires_at: number | null
  created_at: number
  updated_at: number
  last_login_at: number | null
}

interface SessionAccountRow extends AccountRow {
  token_hash: string
  session_expires_at: number
}

interface UserSession {
  tokenHash: string
  account: AccountRow
}

export function publicAccount(account: AccountRow): ViewerAccount {
  return {
    id: account.id,
    username: account.username,
    displayName: account.display_name,
    active: account.is_active === 1,
    mustChangePassword: account.must_change_password === 1,
    expiresAt: account.expires_at,
    createdAt: account.created_at,
    updatedAt: account.updated_at,
    lastLoginAt: account.last_login_at,
  }
}

const isSecure = (request: Request) => new URL(request.url).protocol === 'https:'
const baseCookieName = (kind: SessionKind) => (kind === 'user' ? USER_COOKIE : ADMIN_COOKIE)

// Over HTTPS the __Host- prefix pins the cookie to this exact origin.
function cookieName(request: Request, kind: SessionKind) {
  return isSecure(request) ? `__Host-${baseCookieName(kind)}` : baseCookieName(kind)
}

export function sessionCookie(request: Request, kind: SessionKind, token: string, maxAge: number) {
  return `${cookieName(request, kind)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isSecure(request) ? '; Secure' : ''}`
}

export function expiredCookie(request: Request, kind: SessionKind) {
  return sessionCookie(request, kind, '', 0)
}

function sessionToken(request: Request, kind: SessionKind) {
  const cookies = parseCookies(request)
  const plain = baseCookieName(kind)
  return cookies.get(cookieName(request, kind)) ?? cookies.get(plain) ?? cookies.get(`__Host-${plain}`)
}

async function touchSession(db: D1Database, tokenHash: string, now: number) {
  await db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').bind(now, tokenHash).run()
}

async function createSession(db: D1Database, subjectType: SessionKind, accountId?: string) {
  const token = randomToken()
  const tokenHash = await sha256(token)
  const now = Date.now()
  const duration = subjectType === 'user' ? USER_SESSION_MS : ADMIN_SESSION_MS
  await db
    .prepare(
      `INSERT INTO sessions
        (token_hash, subject_type, account_id, created_at, expires_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(tokenHash, subjectType, accountId ?? null, now, now + duration, now)
    .run()
  return { token, tokenHash, maxAge: Math.floor(duration / 1000) }
}

export const createUserSession = (db: D1Database, accountId: string) =>
  createSession(db, 'user', accountId)

export const createAdminSession = (db: D1Database) => createSession(db, 'admin')

export async function requireUser(
  request: Request,
  db: D1Database,
  options: { allowPasswordChange?: boolean } = {},
) {
  const token = sessionToken(request, 'user')
  if (!token) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.')
  const tokenHash = await sha256(token)
  const now = Date.now()
  const row = await db
    .prepare(
      `SELECT a.*, s.token_hash, s.expires_at AS session_expires_at
       FROM sessions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.token_hash = ? AND s.subject_type = 'user' AND s.expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<SessionAccountRow>()

  if (!row || row.is_active !== 1 || (row.expires_at !== null && row.expires_at <= now)) {
    if (row) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run()
    throw new ApiError(401, 'AUTH_REQUIRED', 'Your session is no longer valid. Sign in again.')
  }
  if (row.must_change_password === 1 && !options.allowPasswordChange) {
    throw new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password to continue.')
  }
  await touchSession(db, tokenHash, now)
  return { tokenHash, account: row } satisfies UserSession
}

export async function requireAdmin(request: Request, db: D1Database) {
  const token = sessionToken(request, 'admin')
  if (!token) throw new ApiError(401, 'ADMIN_AUTH_REQUIRED', 'Administrator sign-in is required.')
  const tokenHash = await sha256(token)
  const now = Date.now()
  const session = await db
    .prepare(
      `SELECT token_hash FROM sessions
       WHERE token_hash = ? AND subject_type = 'admin' AND expires_at > ?`,
    )
    .bind(tokenHash, now)
    .first<{ token_hash: string }>()
  if (!session) throw new ApiError(401, 'ADMIN_AUTH_REQUIRED', 'Administrator sign-in is required.')
  await touchSession(db, tokenHash, now)
  return tokenHash
}

export async function revokeRequestSession(request: Request, db: D1Database, kind: SessionKind) {
  const token = sessionToken(request, kind)
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
}

export function validatePassword(password: unknown, field = 'password') {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', {
      [field]: 'Use between 12 and 128 characters.',
    })
  }
  return password
}
