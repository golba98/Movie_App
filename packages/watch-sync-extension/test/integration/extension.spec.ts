import { expect, test, chromium, type BrowserContext, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const extensionPath = fileURLToPath(new URL('../../dist-test', import.meta.url))

async function profile(): Promise<{ context: BrowserContext; page: Page; popup: Page }> {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })
  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const page = await context.newPage()
  await page.goto('http://127.0.0.1:4300')
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extensionId}/src/popup/index.html`)
  await page.bringToFront()
  await popup.reload()
  return { context, page, popup }
}

async function enableBothOrigins(popup: Page) {
  await expect(popup.getByText('Top page', { exact: true })).toBeVisible()
  const origins = popup.locator('input[name="origin"]')
  await expect(origins).toHaveCount(2)
  for (let index = 0; index < await origins.count(); index += 1) await origins.nth(index).check()
  await popup.getByRole('button', { name: 'Enable sync on this tab' }).click()
  await popup.getByRole('button', { name: 'Rescan' }).click()
  await expect(popup.getByText(/score \d+/)).toBeVisible({ timeout: 10_000 })
}

test('two persistent Chromium profiles detect, preserve, replace, and revoke frame controllers', async () => {
  const first = await profile()
  const second = await profile()
  try {
    await enableBothOrigins(first.popup)
    await enableBothOrigins(second.popup)

    const firstFingerprint = await first.popup.locator('input[name="candidate"]:checked').locator('xpath=..').locator('small').textContent()
    await first.page.frameLocator('#player-frame').getByRole('button', { name: 'Replace main video' }).click()
    await first.popup.getByRole('button', { name: 'Rescan' }).click()
    await expect(first.popup.getByText(/score \d+/)).toBeVisible()
    expect(await first.popup.locator('input[name="candidate"]:checked').locator('xpath=..').locator('small').textContent()).toBe(firstFingerprint)

    await first.page.getByRole('button', { name: 'Navigate player iframe' }).click()
    await first.page.frameLocator('#player-frame').getByRole('button', { name: 'Toggle tiny preview' }).click()
    await first.popup.getByRole('button', { name: 'Rescan' }).click()
    await expect(first.popup.locator('input[name="candidate"]')).toHaveCount(2)

    await first.popup.getByLabel('Embedded frame').check()
    await first.popup.getByRole('button', { name: 'Revoke selected access' }).click()
    await expect(first.popup.getByText('No eligible native videos detected.')).toBeVisible({ timeout: 10_000 })
    await expect(second.popup.getByText(/score \d+/)).toBeVisible()
  } finally {
    await first.context.close()
    await second.context.close()
  }
})
