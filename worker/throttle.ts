import { sha256 } from './auth/crypto'
import { ApiError, requestIp } from './http'

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

// Tables that share the throttle schema (throttle_key, failure_count, window_started_at, updated_at).
type ThrottleTable = 'auth_attempts' | 'watch_room_join_attempts'

/**
 * Per-IP failure counting for password checks: five failures within fifteen
 * minutes block further attempts until the window passes.
 */
export function createThrottle(table: ThrottleTable, blockedMessage: string) {
  async function assertAllowed(request: Request, db: D1Database, scope: string) {
    const throttleKey = await sha256(`${scope}:${requestIp(request)}`)
    const attempt = await db
      .prepare(`SELECT failure_count, window_started_at FROM ${table} WHERE throttle_key = ?`)
      .bind(throttleKey)
      .first<{ failure_count: number; window_started_at: number }>()
    if (attempt && Date.now() - attempt.window_started_at < WINDOW_MS && attempt.failure_count >= MAX_FAILURES) {
      throw new ApiError(429, 'TOO_MANY_ATTEMPTS', blockedMessage)
    }
    return throttleKey
  }

  async function recordFailure(db: D1Database, throttleKey: string) {
    const now = Date.now()
    await db
      .prepare(
        `INSERT INTO ${table} (throttle_key, failure_count, window_started_at, updated_at)
         VALUES (?, 1, ?, ?)
         ON CONFLICT(throttle_key) DO UPDATE SET
           failure_count = CASE WHEN ? - window_started_at >= ? THEN 1 ELSE failure_count + 1 END,
           window_started_at = CASE WHEN ? - window_started_at >= ? THEN ? ELSE window_started_at END,
           updated_at = ?`,
      )
      .bind(throttleKey, now, now, now, WINDOW_MS, now, WINDOW_MS, now, now)
      .run()
  }

  async function clearFailures(db: D1Database, throttleKey: string) {
    await db.prepare(`DELETE FROM ${table} WHERE throttle_key = ?`).bind(throttleKey).run()
  }

  return { assertAllowed, recordFailure, clearFailures }
}
