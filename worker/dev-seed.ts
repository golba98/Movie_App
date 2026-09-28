import { hashPassword } from './auth/crypto'

const TESTER_USERNAME = 'tester'
const TESTER_PASSWORD = 'tester-password-123'

let seeded = false

const isLocalRequest = (request: Request) => {
  const { hostname } = new URL(request.url)
  return hostname === '127.0.0.1' || hostname === 'localhost'
}

/**
 * Local development only: creates a `tester` account the first time the Worker
 * serves a request on localhost. Deployed Workers never create it.
 */
export async function ensureTesterAccount(request: Request, db: D1Database) {
  if (seeded || !isLocalRequest(request)) return
  seeded = true
  try {
    const existing = await db
      .prepare('SELECT id FROM accounts WHERE username_normalized = ?')
      .bind(TESTER_USERNAME)
      .first()
    if (existing) return
    const password = await hashPassword(TESTER_PASSWORD)
    const now = Date.now()
    await db
      .prepare(
        `INSERT INTO accounts
          (id, username, username_normalized, display_name, password_hash, password_salt,
           password_iterations, is_active, must_change_password, expires_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, null, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        TESTER_USERNAME,
        TESTER_USERNAME,
        'Local Tester',
        password.hash,
        password.salt,
        password.iterations,
        now,
        now,
      )
      .run()
    console.log(`Local tester account created: username=${TESTER_USERNAME}, password=${TESTER_PASSWORD}`)
  } catch (error) {
    console.error('Failed to ensure tester account:', error)
  }
}
