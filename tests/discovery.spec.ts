import { expect, test } from '@playwright/test'
import { movie, detailsExtras } from './support/fixtures'
import { mockApi } from './support/mock-api'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('home loads all discovery rows and the accessible trailer modal', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Trending movies' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Popular movies' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Top-rated movies' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Upcoming movies' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Popular TV shows' })).toBeVisible()

  const trailerButton = page.getByRole('button', { name: 'Watch trailer' })
  await trailerButton.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('iframe')).toHaveAttribute('src', /official-key.*autoplay=0/)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
  await expect(trailerButton).toBeFocused()

  await trailerButton.click()
  await dialog.evaluate((element) => (element as HTMLDialogElement).click())
  await expect(dialog).toBeHidden()
})

test('search is debounced, URL-backed, filters people, and handles empty and errors', async ({ page }) => {
  await page.goto('/search?q=dune')
  const input = page.getByRole('searchbox', { name: 'Search movies and TV shows' })
  await expect(input).toHaveValue('dune')
  await expect(page.getByRole('heading', { name: 'Results for “dune”' })).toBeVisible()
  await expect(page.getByText('Dune: Part Two', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('The Expanse', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('A Person', { exact: true })).toHaveCount(0)

  await page.reload()
  await expect(input).toHaveValue('dune')
  await input.fill('slow')
  await input.fill('dune')
  await expect(page).toHaveURL(/\/search\?q=dune/)
  await expect(page.getByRole('heading', { name: 'Results for “dune”' })).toBeVisible()

  await input.fill('nothing')
  await expect(page.getByRole('heading', { name: 'No results found' })).toBeVisible()
  await input.fill('fail')
  await expect(page.getByRole('alert')).toContainText('TMDB could not complete the request')
})

test('movie and TV details show metadata, legal providers, and persistent favourites', async ({ page }) => {
  await page.goto('/movie/1')
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
  await expect(page.getByText('Director:')).toBeVisible()
  await expect(page.getByText('Denis Villeneuve')).toBeVisible()

  await page.getByRole('button', { name: 'Add to favourites' }).click()
  await page.goto('/favourites')
  await expect(page.getByText('Dune: Part Two', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Dune: Part Two', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Remove Dune: Part Two from favourites' }).click()
  await expect(page.getByRole('heading', { name: 'No favourites yet' })).toBeVisible()
  await page.evaluate(() => localStorage.setItem('cinescope:favourites:v1', '{not-valid-json'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'No favourites yet' })).toBeVisible()

  await page.goto('/tv/10')
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'The Expanse' })).toBeVisible()
  await expect(page.getByText('6 seasons')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Similar shows' })).toBeVisible()
})

test('omits the legal-provider section when South Africa has no providers', async ({ page }) => {
  await page.unroute('**/api/tmdb/**')
  await page.route('**/api/tmdb/movie/1', async (route) => {
    await route.fulfill({ json: { ...movie, runtime: 166, ...detailsExtras, 'watch/providers': { results: {} } } })
  })
  await page.goto('/movie/1')
  await expect(page.getByRole('heading', { name: 'Where it is legally available' })).toHaveCount(0)
  await expect(page.getByText('TMDB has no legal watch-provider information for South Africa right now.')).toHaveCount(0)
})

test('@mobile browse pagination, invalid routes, and responsive layouts remain functional', async ({ page }, testInfo) => {
  await page.goto('/movies')
  await expect(page.getByRole('heading', { level: 1, name: 'Popular movies' })).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('Blade Runner 2049', { exact: true })).toBeVisible()

  const mobileProject = testInfo.project.name !== 'chromium'
  const widths = mobileProject ? [page.viewportSize()?.width ?? 390] : [360, 375, 390, 430, 768, 1024]
  for (const width of widths) {
    if (!mobileProject) await page.setViewportSize({ width, height: width >= 768 ? 1024 : 800 })
    for (const path of ['/', '/search?q=dune', '/movie/1', '/tv/10', '/favourites']) {
      await page.goto(path)
      if (width < 768) await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
      else await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    await page.goto('/')
    const hero = page.getByRole('heading', { level: 1, name: 'Dune: Part Two' }).locator('..').locator('..').locator('..')
    const heroBox = await hero.boundingBox()
    if (width < 768) expect(heroBox?.height ?? 800).toBeLessThan(640)
    await page.getByRole('button', { name: 'Watch trailer' }).click()
    const modalBox = await page.getByRole('dialog').boundingBox()
    expect(modalBox?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((modalBox?.x ?? 0) + (modalBox?.width ?? width + 1)).toBeLessThanOrEqual(width)
    expect(modalBox?.height ?? 801).toBeLessThanOrEqual(800)
    await page.getByRole('button', { name: 'Close trailer' }).click()

    if (width < 768) {
      await page.goto('/movie/1')
      await page.getByRole('button', { name: 'Watch Movie' }).click()
      const playerBox = await page.locator('#streaming-player').boundingBox()
      expect(playerBox?.x ?? -1).toBeGreaterThanOrEqual(0)
      expect((playerBox?.x ?? 0) + (playerBox?.width ?? width + 1)).toBeLessThanOrEqual(width)
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }
  }

  await page.goto('/movie/not-a-number')
  await expect(page.getByRole('alert')).toContainText('invalid address')
  await page.goto('/route-that-does-not-exist')
  await expect(page.getByRole('heading', { name: 'This page wandered off' })).toBeVisible()
})
