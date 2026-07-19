import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'
import { defineConfig } from 'vitest/config'

const migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './worker/index.ts',
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          ADMIN_PASSWORD: 'unit-test-admin-password',
          TMDB_ACCESS_TOKEN: 'unit-test-tmdb-token',
          WATCH_PARTY_SIGNING_SECRET: 'unit-test-watch-party-signing-secret',
          WATCH_PARTY_ENABLED: 'true',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: {
    setupFiles: ['./worker/test/setup.ts'],
    include: ['worker/test/**/*.spec.ts'],
  },
})
