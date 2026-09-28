import { hashPassword } from './auth/crypto'

const TESTER_USERNAME = 'tester'
const TESTER_PASSWORD = 'tester-password-123'

let seeded = false

/**
 * Creates a `tester` account the first time the Worker handles a request.
 * NOTE: this runs outside unit tests in every environment, production included;
 * see the follow-up in the cleanup report before relying on it.
 */
export async function ensureTesterAccount(db: D1Database) {
  if (seeded) return
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
