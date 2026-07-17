import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'android-chromium',
      grep: /@mobile/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone-chromium',
      grep: /@mobile/,
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'ipad-chromium',
      grep: /@mobile/,
      use: { ...devices['iPad Pro 11'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
})
