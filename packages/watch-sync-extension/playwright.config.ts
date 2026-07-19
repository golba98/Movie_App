import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './test/integration',
  timeout: 60_000,
  reporter: [['list']],
  workers: 1,
  webServer: {
    command: 'node fixtures/server.mjs',
    url: 'http://127.0.0.1:4300',
    reuseExistingServer: !process.env.CI,
  },
})
