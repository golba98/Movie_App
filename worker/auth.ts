import { hashPassword, randomToken, sha256, verifyPassword } from './crypto'
import { ApiError, parseCookies, requestIp } from './http'

export const USER_COOKIE = 'fedora_session'
export const ADMIN_COOKIE = 'fedora_admin'
const USER_SESSION_MS = 30 * 24 * 60 * 60 * 1000
const ADMIN_SESSION_MS = 8 * 60 * 60 * 1000
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000
const MAX_ATTEMPTS = 5

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

export interface UserSession {
  tokenHash: string
  account: AccountRow
}

export function publicAccount(account: AccountRow) {
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

function cookieName(request: Request, kind: 'user' | 'admin') {
  const secure = new URL(request.url).protocol === 'https:'
  const name = kind === 'user' ? USER_COOKIE : ADMIN_COOKIE
  return secure ? `__Host-${name}` : name
}

export function sessionCookie(request: Request, kind: 'user' | 'admin', token: string, maxAge: number) {
  const secure = new URL(request.url).protocol === 'https:'
  return `${cookieName(request, kind)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

export function expiredCookie(request: Request, kind: 'user' | 'admin') {
  return sessionCookie(request, kind, '', 0)
}

function sessionToken(request: Request, kind: 'user' | 'admin') {
  const cookies = parseCookies(request)
  const plain = kind === 'user' ? USER_COOKIE : ADMIN_COOKIE
  return cookies.get(cookieName(request, kind)) ?? cookies.get(plain) ?? cookies.get(`__Host-${plain}`)
}

async function createSession(db: D1Database, subjectType: 'user' | 'admin', accountId?: string) {
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
  await db
    .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(now, tokenHash)
    .run()
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
  await db
    .prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(now, tokenHash)
    .run()
  return tokenHash
}

export async function revokeRequestSession(request: Request, db: D1Database, kind: 'user' | 'admin') {
  const token = sessionToken(request, kind)
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
}

export async function assertThrottleAllowed(request: Request, db: D1Database, scope: string) {
  const throttleKey = await sha256(`${scope}:${requestIp(request)}`)
  const now = Date.now()
  const attempt = await db
    .prepare('SELECT failure_count, window_started_at FROM auth_attempts WHERE throttle_key = ?')
    .bind(throttleKey)
    .first<{ failure_count: number; window_started_at: number }>()
  if (attempt && now - attempt.window_started_at < ATTEMPT_WINDOW_MS && attempt.failure_count >= MAX_ATTEMPTS) {
    throw new ApiError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Try again in 15 minutes.')
  }
  return throttleKey
}

export async function recordAuthFailure(db: D1Database, throttleKey: string) {
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO auth_attempts (throttle_key, failure_count, window_started_at, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(throttle_key) DO UPDATE SET
         failure_count = CASE
           WHEN ? - window_started_at >= ? THEN 1
           ELSE failure_count + 1
         END,
         window_started_at = CASE
           WHEN ? - window_started_at >= ? THEN ?
           ELSE window_started_at
         END,
         updated_at = ?`,
    )
    .bind(
      throttleKey,
      now,
      now,
      now,
      ATTEMPT_WINDOW_MS,
      now,
      ATTEMPT_WINDOW_MS,
      now,
      now,
    )
    .run()
}

export async function clearAuthFailures(db: D1Database, throttleKey: string) {
  await db.prepare('DELETE FROM auth_attempts WHERE throttle_key = ?').bind(throttleKey).run()
}

export function validatePassword(password: unknown, field = 'password') {
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', {
      [field]: 'Use between 12 and 128 characters.',
    })
  }
  return password
}

export { hashPassword, verifyPassword }
