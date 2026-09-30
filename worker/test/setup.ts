import { env } from 'cloudflare:workers'
import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { beforeEach } from 'vitest'

// Every test starts from the real migrations (including their seed rows) with empty user data.
beforeEach(async () => {
  const testEnv = env as Env & { TEST_MIGRATIONS: D1Migration[] }
  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS)
  await testEnv.DB.batch([
    testEnv.DB.prepare('DELETE FROM watch_room_join_attempts'),
    testEnv.DB.prepare('DELETE FROM watch_room_audit_events'),
    testEnv.DB.prepare('DELETE FROM watch_room_bans'),
    testEnv.DB.prepare('DELETE FROM watch_room_invitations'),
    testEnv.DB.prepare('DELETE FROM watch_rooms'),
    testEnv.DB.prepare('DELETE FROM media_sources'),
    testEnv.DB.prepare('DELETE FROM stream_resolution_cache'),
    testEnv.DB.prepare('DELETE FROM subtitle_cache'),
    testEnv.DB.prepare('DELETE FROM favourites'),
    testEnv.DB.prepare('DELETE FROM watch_entries'),
    testEnv.DB.prepare('DELETE FROM watch_titles'),
    testEnv.DB.prepare('DELETE FROM sessions'),
    testEnv.DB.prepare('DELETE FROM admin_audit_log'),
    testEnv.DB.prepare('DELETE FROM accounts'),
    testEnv.DB.prepare('DELETE FROM auth_attempts'),
  ])
})
