import { expect, test } from '@playwright/test'
import { mockApi } from './support/mock-api'
import { expectInside, homeWithFullTrendingRow, pageScrollY, settledScrollY } from './support/layout'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('@layout player panels are never clipped and the header sits at the top', async ({ page }) => {
  await page.route('**/api/media-sources/movie/1', async (route) => {
    await route.fulfill({
      json: {
        data: {
          sources: ['flixbaba', 'soap2day'].map((provider) => ({
            id: provider,
            mediaType: 'movie',
            tmdbId: 1,
            seasonNumber: null,
            episodeNumber: null,
            label: `${provider} Stream (Dynamic)`,
            sourceUrl: `https://${provider}.example.test/movie/1`,
            mimeType: 'video/mp4',
            rightsBasis: 'licensed',
            isDynamic: true,
          })),
        },
      },
    })
  })
  await page.route('**/api/media-sources/extract**', async (route) => {
    await route.fulfill({ json: { data: { extractedUrl: null } } })
  })

  await page.goto('/')
  const signOut = page.getByRole('button', { name: 'Sign out' }).filter({ visible: true })
  await expect(signOut).toHaveCount(1)
  expect((await signOut.boundingBox())!.y).toBeLessThan(80)

  await page.goto('/movie/1')
  const shell = page.getByTestId('player-shell')
  await shell.scrollIntoViewIfNeeded()
  await expectInside(page.getByRole('heading', { name: 'Ready when you are' }), shell)
  await expectInside(page.getByRole('button', { name: 'Play movie' }), shell)

  await page.getByRole('button', { name: 'Play movie' }).click()
  await expect(page.getByRole('heading', { name: 'Player unavailable' })).toBeVisible()
  await shell.scrollIntoViewIfNeeded()
  for (const name of ['Retry player', 'Stop player']) {
    await expectInside(shell.getByRole('button', { name }), shell)
  }
})

test('@layout admin delete confirmation fits the screen and stays reachable', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administrator' })).toBeVisible()
  await page.getByLabel('Administrator password', { exact: true }).fill('test-admin-password')
  await page.getByRole('button', { name: 'Open admin' }).click()
  await page.getByLabel('Username').fill('layout.viewer')
  await page.getByLabel('Display name').fill('Layout Viewer')
  await page.getByLabel('Temporary password', { exact: true }).fill('temporary-password-123')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'layout.viewer' })).toBeVisible()

  await page.getByRole('button', { name: 'Delete account layout.viewer' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete layout.viewer?' })
  await expect(dialog).toBeVisible()
  const viewport = page.viewportSize()!
  const box = (await dialog.boundingBox())!
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5)

  await dialog.getByLabel('Type layout.viewer to confirm').fill('layout.viewer')
  for (const name of ['Cancel', 'Delete account']) {
    const button = dialog.getByRole('button', { name })
    await button.scrollIntoViewIfNeeded()
    await expectInside(button, dialog)
  }
  await dialog.getByRole('button', { name: 'Delete account' }).click()
  await expect(page.getByRole('heading', { name: 'layout.viewer' })).toHaveCount(0)
})
test('wheel scrolling over a poster row keeps scrolling the page instead of stalling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const { scroller } = await homeWithFullTrendingRow(page)
  const box = (await scroller.boundingBox())!
  // Park the cursor on the row, then scroll down with the wheel.
  await page.mouse.move(box.x + box.width / 2, Math.min(box.y + box.height / 2, 600))
  const before = await pageScrollY(page)
  for (let tick = 0; tick < 5; tick += 1) {
    await page.mouse.wheel(0, 120)
    await page.waitForTimeout(40)
  }
  await expect.poll(() => pageScrollY(page), { timeout: 4_000 }).toBeGreaterThan(before + 300)

  // Sideways gestures still belong to the row.
  await settledScrollY(page)
  await scroller.scrollIntoViewIfNeeded()
  const settledY = await settledScrollY(page)
  const rowBox = (await scroller.boundingBox())!
  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2)
  await page.mouse.wheel(400, 0)
  await expect.poll(() => scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0)
  expect(Math.abs((await pageScrollY(page)) - settledY)).toBeLessThan(2)
})

test('@layout a vertical swipe that starts on a poster row scrolls the page', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || !testInfo.project.use.hasTouch, 'Needs Chromium touch emulation')
  const { scroller } = await homeWithFullTrendingRow(page)
  await scroller.scrollIntoViewIfNeeded()
  const before = await settledScrollY(page)
  const box = (await scroller.boundingBox())!
  const x = Math.round(box.x + box.width / 2)
  const y = Math.round(Math.min(box.y + box.height / 2, page.viewportSize()!.height - 40))
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 12; step += 1) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 20 }] })
    await page.waitForTimeout(16)
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(() => pageScrollY(page)).toBeGreaterThan(before + 150)
})



// Backdrop blur behind always-visible bars and the details popup is re-filtered on every scroll
// frame and caused dropped frames while scrolling; these surfaces must stay unblurred.
test('@layout sticky bars and the details popup backdrop avoid per-frame blur', async ({ page }) => {
  await page.goto('/movie/1')
  await expect(page.getByRole('button', { name: 'Watch Movie' })).toBeVisible()
  const blurs = await page.evaluate(() => {
    const surfaces = [
      ...document.querySelectorAll('header, nav[aria-label="Mobile navigation"]'),
      ...document.querySelectorAll('.fixed.inset-0 > .absolute.inset-0'),
    ]
    return surfaces
      .filter((element) => (element as HTMLElement).offsetParent !== null || getComputedStyle(element).position === 'fixed')
      .map((element) => getComputedStyle(element).backdropFilter)
  })
  expect(blurs.length).toBeGreaterThan(1)
  expect(blurs.every((value) => value === 'none')).toBe(true)
})
