import { expect, type Locator, type Page } from '@playwright/test'
import { movie, paginated } from './fixtures'

export async function expectInside(inner: Locator, outer: Locator) {
  const [innerBox, outerBox] = await Promise.all([inner.boundingBox(), outer.boundingBox()])
  expect(innerBox).not.toBeNull()
  expect(outerBox).not.toBeNull()
  expect(innerBox!.x).toBeGreaterThanOrEqual(outerBox!.x - 0.5)
  expect(innerBox!.y).toBeGreaterThanOrEqual(outerBox!.y - 0.5)
  expect(innerBox!.x + innerBox!.width).toBeLessThanOrEqual(outerBox!.x + outerBox!.width + 0.5)
  expect(innerBox!.y + innerBox!.height).toBeLessThanOrEqual(outerBox!.y + outerBox!.height + 0.5)
}

export async function homeWithFullTrendingRow(page: Page) {
  const many = Array.from({ length: 14 }, (_, index) => ({ ...movie, id: 500 + index, title: `Trending ${index + 1}` }))
  await page.route('**/api/tmdb/trending/movie/week*', async (route) => {
    await route.fulfill({ json: paginated(many) })
  })
  await page.goto('/')
  const row = page.getByRole('region', { name: 'Trending movies' })
  await expect(row.getByRole('link', { name: 'View details for Trending 14' })).toBeAttached()
  // The horizontal scroller is the element wrapping each card's snap container.
  const scroller = row.locator('article').first().locator('xpath=../..')
  return { row, scroller }
}

export const pageScrollY = (page: Page) => page.evaluate(() => window.scrollY)

// Smooth scrolling keeps gliding briefly; wait until the page position stops changing.
export async function settledScrollY(page: Page) {
  let previous = -1
  let current = await pageScrollY(page)
  while (current !== previous) {
    previous = current
    await page.waitForTimeout(250)
    current = await pageScrollY(page)
  }
  return current
}
