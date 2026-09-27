import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  timeout: 45_000,
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
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'android-chromium',
      grep: /@mobile|@layout/,
      use: { ...devices['Pixel 5'] },
    },
    {
      name: 'iphone-chromium',
      grep: /@mobile|@layout/,
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
    {
      name: 'ipad-chromium',
      grep: /@mobile|@layout/,
      use: { ...devices['iPad Pro 11'], browserName: 'chromium' },
    },
    {
      name: 'iphone-landscape-chromium',
      grep: /@layout/,
      use: { ...devices['iPhone 13 landscape'], browserName: 'chromium' },
    },
    {
      name: 'ipad-landscape-chromium',
      grep: /@layout/,
      use: { ...devices['iPad Pro 11 landscape'], browserName: 'chromium' },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
})
