import {
  assertThrottleAllowed,
  clearAuthFailures,
  createUserSession,
  expiredCookie,
  hashPassword,
  publicAccount,
  recordAuthFailure,
  requireUser,
  revokeRequestSession,
  sessionCookie,
  validatePassword,
  verifyPassword,
  type AccountRow,
} from './auth'
import { ApiError, json, readJson } from './http'

const DUMMY_SALT = 'AAAAAAAAAAAAAAAAAAAAAA'
const DUMMY_HASH = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export async function viewerLogin(request: Request, env: Env) {
  const body = await readJson<{ username?: unknown; password?: unknown }>(request)
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const throttleKey = await assertThrottleAllowed(request, env.DB, `user:${username}`)
  const account = await env.DB
    .prepare('SELECT * FROM accounts WHERE username_normalized = ?')
    .bind(username)
    .first<AccountRow>()
  const valid = await verifyPassword(
    password,
    account?.password_hash ?? DUMMY_HASH,
    account?.password_salt ?? DUMMY_SALT,
    account?.password_iterations ?? 600_000,
  )
  const now = Date.now()
  if (!account || !valid || account.is_active !== 1 || (account.expires_at !== null && account.expires_at <= now)) {
    await recordAuthFailure(env.DB, throttleKey)
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'The username or password is incorrect.')
  }
  await clearAuthFailures(env.DB, throttleKey)
  await env.DB
    .prepare('UPDATE accounts SET last_login_at = ?, updated_at = ? WHERE id = ?')
    .bind(now, now, account.id)
    .run()
  const session = await createUserSession(env.DB, account.id)
  return json(
    { account: publicAccount({ ...account, last_login_at: now, updated_at: now }) },
    200,
    { 'Set-Cookie': sessionCookie(request, 'user', session.token, session.maxAge) },
  )
}

export async function viewerSession(request: Request, env: Env) {
  const session = await requireUser(request, env.DB, { allowPasswordChange: true })
  return json({ account: publicAccount(session.account) })
}

export async function viewerLogout(request: Request, env: Env) {
  await revokeRequestSession(request, env.DB, 'user')
  return json({ authenticated: false }, 200, { 'Set-Cookie': expiredCookie(request, 'user') })
}

export async function changePassword(request: Request, env: Env) {
  const session = await requireUser(request, env.DB, { allowPasswordChange: true })
  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request)
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = validatePassword(body.newPassword, 'newPassword')
  if (
    !(await verifyPassword(
      currentPassword,
      session.account.password_hash,
      session.account.password_salt,
      session.account.password_iterations,
    ))
  ) {
    throw new ApiError(400, 'INVALID_CURRENT_PASSWORD', 'The current password is incorrect.', {
      currentPassword: 'The current password is incorrect.',
    })
  }
  if (currentPassword === newPassword) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Choose a different password.', {
      newPassword: 'Your new password must be different.',
    })
  }
  const password = await hashPassword(newPassword)
  const now = Date.now()
  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE accounts SET password_hash = ?, password_salt = ?, password_iterations = ?,
         must_change_password = 0, updated_at = ? WHERE id = ?`,
      )
      .bind(password.hash, password.salt, password.iterations, now, session.account.id),
    env.DB
      .prepare('DELETE FROM sessions WHERE account_id = ? AND token_hash <> ?')
      .bind(session.account.id, session.tokenHash),
  ])
  const account = { ...session.account, must_change_password: 0, updated_at: now }
  return json({ account: publicAccount(account) })
}
