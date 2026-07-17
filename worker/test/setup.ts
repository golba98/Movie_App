import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeEach } from 'vitest'

beforeEach(async () => {
  const testEnv = env as Env & { TEST_MIGRATIONS: D1Migration[] }
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
  await testEnv.DB.batch([
    testEnv.DB.prepare('DELETE FROM media_sources'),
    testEnv.DB.prepare('DELETE FROM favourites'),
    testEnv.DB.prepare('DELETE FROM sessions'),
    testEnv.DB.prepare('DELETE FROM admin_audit_log'),
    testEnv.DB.prepare('DELETE FROM accounts'),
    testEnv.DB.prepare('DELETE FROM auth_attempts'),
  ])
})
