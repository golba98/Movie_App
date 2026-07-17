import {
  assertThrottleAllowed,
  clearAuthFailures,
  createAdminSession,
  expiredCookie,
  hashPassword,
  publicAccount,
  recordAuthFailure,
  requireAdmin,
  revokeRequestSession,
  sessionCookie,
  validatePassword,
} from './auth'
import { sha256, timingSafeStringEqual } from './crypto'
import { ApiError, json, readJson, requestIp } from './http'

function cleanUsername(value: unknown) {
  if (typeof value !== 'string') return null
  const username = value.trim()
  return /^[A-Za-z0-9._-]{3,32}$/.test(username) ? username : null
}

function cleanDisplayName(value: unknown) {
  if (typeof value !== 'string') return null
  const displayName = value.trim()
  return displayName.length >= 1 && displayName.length <= 80 ? displayName : null
}

function cleanExpiry(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const timestamp = typeof value === 'number' ? value : Date.parse(String(value))
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', {
      expiresAt: 'Expiry must be a future date or left empty.',
    })
  }
  return timestamp
}

export async function auditAdminEvent(
  request: Request,
  env: Env,
  action: string,
  targetAccountId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const ipHash = await sha256(requestIp(request))
  await env.DB
    .prepare(
      `INSERT INTO admin_audit_log (action, target_account_id, metadata, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(action, targetAccountId, JSON.stringify(metadata), ipHash, Date.now())
    .run()
}

export async function adminLogin(request: Request, env: Env) {
  if (!env.ADMIN_PASSWORD) {
    throw new ApiError(
      503,
      'ADMIN_NOT_CONFIGURED',
      'Administrator access is not configured. Add the ADMIN_PASSWORD Cloudflare secret.',
    )
  }
  const body = await readJson<{ password?: unknown }>(request)
  const password = typeof body.password === 'string' ? body.password : ''
  const throttleKey = await assertThrottleAllowed(request, env.DB, 'admin')
  if (!(await timingSafeStringEqual(password, env.ADMIN_PASSWORD))) {
    await recordAuthFailure(env.DB, throttleKey)
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'The administrator password is incorrect.')
  }
  await clearAuthFailures(env.DB, throttleKey)
  await env.DB.prepare("DELETE FROM sessions WHERE subject_type = 'admin' AND expires_at <= ?").bind(Date.now()).run()
  const session = await createAdminSession(env.DB)
  await auditAdminEvent(request, env, 'admin.login', null)
  return json({ authenticated: true }, 200, {
    'Set-Cookie': sessionCookie(request, 'admin', session.token, session.maxAge),
  })
}

export async function adminSession(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  return json({ authenticated: true })
}

export async function adminLogout(request: Request, env: Env) {
  await revokeRequestSession(request, env.DB, 'admin')
  return json({ authenticated: false }, 200, {
    'Set-Cookie': expiredCookie(request, 'admin'),
  })
}

export async function listAccounts(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const url = new URL(request.url)
  const search = url.searchParams.get('search')?.trim().toLowerCase() ?? ''
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 100, 1), 200)
  const rows = search
    ? await env.DB
        .prepare(
          `SELECT * FROM accounts
           WHERE username_normalized LIKE ? OR lower(display_name) LIKE ?
           ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(`%${search}%`, `%${search}%`, limit)
        .all<Parameters<typeof publicAccount>[0]>()
    : await env.DB
        .prepare('SELECT * FROM accounts ORDER BY created_at DESC LIMIT ?')
        .bind(limit)
        .all<Parameters<typeof publicAccount>[0]>()
  return json({ accounts: rows.results.map(publicAccount) })
}

export async function createAccount(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const body = await readJson<{
    username?: unknown
    displayName?: unknown
    temporaryPassword?: unknown
    expiresAt?: unknown
  }>(request)
  const username = cleanUsername(body.username)
  const displayName = cleanDisplayName(body.displayName)
  const fieldErrors: Record<string, string> = {}
  if (!username) fieldErrors.username = 'Use 3–32 letters, numbers, dots, dashes, or underscores.'
  if (!displayName) fieldErrors.displayName = 'Enter a display name up to 80 characters.'
  if (Object.keys(fieldErrors).length) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', fieldErrors)
  }
  const temporaryPassword = validatePassword(body.temporaryPassword, 'temporaryPassword')
  const expiresAt = cleanExpiry(body.expiresAt)
  const password = await hashPassword(temporaryPassword)
  const now = Date.now()
  const id = crypto.randomUUID()
  try {
    await env.DB
      .prepare(
        `INSERT INTO accounts
          (id, username, username_normalized, display_name, password_hash, password_salt,
           password_iterations, is_active, must_change_password, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      )
      .bind(
        id,
        username,
        username!.toLowerCase(),
        displayName,
        password.hash,
        password.salt,
        password.iterations,
        expiresAt,
        now,
        now,
      )
      .run()
  } catch (error) {
    if (String(error).toLowerCase().includes('unique')) {
      throw new ApiError(409, 'USERNAME_TAKEN', 'That username is already in use.', {
        username: 'Choose a different username.',
      })
    }
    throw error
  }
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first<Parameters<typeof publicAccount>[0]>()
  await auditAdminEvent(request, env, 'account.create', id, { username, expiresAt })
  return json({ account: publicAccount(account!) }, 201)
}

export async function updateAccount(request: Request, env: Env, accountId: string) {
  await requireAdmin(request, env.DB)
  const current = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(accountId).first<Parameters<typeof publicAccount>[0]>()
  if (!current) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.')
  const body = await readJson<{ displayName?: unknown; active?: unknown; expiresAt?: unknown }>(request)
  const displayName = body.displayName === undefined ? current.display_name : cleanDisplayName(body.displayName)
  if (!displayName) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Check the highlighted fields.', {
      displayName: 'Enter a display name up to 80 characters.',
    })
  }
  if (body.active !== undefined && typeof body.active !== 'boolean') {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Active must be true or false.')
  }
  const active = body.active === undefined ? current.is_active === 1 : body.active
  const expiresAt = body.expiresAt === undefined ? current.expires_at : cleanExpiry(body.expiresAt)
  await env.DB
    .prepare('UPDATE accounts SET display_name = ?, is_active = ?, expires_at = ?, updated_at = ? WHERE id = ?')
    .bind(displayName, active ? 1 : 0, expiresAt, Date.now(), accountId)
    .run()
  if (!active || (expiresAt !== null && expiresAt <= Date.now())) {
    await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(accountId).run()
  }
  await auditAdminEvent(request, env, 'account.update', accountId, { displayName, active, expiresAt })
  const account = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(accountId).first<Parameters<typeof publicAccount>[0]>()
  return json({ account: publicAccount(account!) })
}

export async function resetAccountPassword(request: Request, env: Env, accountId: string) {
  await requireAdmin(request, env.DB)
  const body = await readJson<{ temporaryPassword?: unknown }>(request)
  const temporaryPassword = validatePassword(body.temporaryPassword, 'temporaryPassword')
  const password = await hashPassword(temporaryPassword)
  const result = await env.DB
    .prepare(
      `UPDATE accounts SET password_hash = ?, password_salt = ?, password_iterations = ?,
       must_change_password = 1, updated_at = ? WHERE id = ?`,
    )
    .bind(password.hash, password.salt, password.iterations, Date.now(), accountId)
    .run()
  if (!result.meta.changes) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.')
  await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(accountId).run()
  await auditAdminEvent(request, env, 'account.reset_password', accountId)
  return json({ reset: true })
}

export async function revokeAccountSessions(request: Request, env: Env, accountId: string) {
  await requireAdmin(request, env.DB)
  const account = await env.DB.prepare('SELECT id FROM accounts WHERE id = ?').bind(accountId).first()
  if (!account) throw new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.')
  const result = await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(accountId).run()
  await auditAdminEvent(request, env, 'account.revoke_sessions', accountId, { revoked: result.meta.changes })
  return json({ revoked: result.meta.changes })
}

export async function listAudit(request: Request, env: Env) {
  await requireAdmin(request, env.DB)
  const rows = await env.DB
    .prepare(
      `SELECT l.id, l.action, l.target_account_id, l.metadata, l.created_at,
              a.username AS target_username
       FROM admin_audit_log l
       LEFT JOIN accounts a ON a.id = l.target_account_id
       ORDER BY l.created_at DESC LIMIT 100`,
    )
    .all<{
      id: number
      action: string
      target_account_id: string | null
      target_username: string | null
      metadata: string
      created_at: number
    }>()
  return json({
    events: rows.results.map((row) => ({
      id: row.id,
      action: row.action,
      targetAccountId: row.target_account_id,
      targetUsername: row.target_username,
      metadata: JSON.parse(row.metadata) as unknown,
      createdAt: row.created_at,
    })),
  })
}
