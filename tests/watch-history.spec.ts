import { expect, test } from '@playwright/test'
import { mockApi, watchServer } from './support/mock-api'
import { watchFor, setPageVisibility, useSilentDynamicMovie } from './support/player'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
})

test('starting playback neither marks a title watched nor lists it, and manual marks sync to the account', async ({ page }) => {
  await page.goto('/tv/10')
  await page.getByRole('button', { name: 'Watch Show' }).click()
  await page.getByRole('button', { name: 'Exit theater mode' }).click()

  const player = page.locator('#streaming-player')
  await expect(player.getByText('0 / 2 watched')).toBeVisible()
  await player.getByRole('button', { name: 'Play video' }).click()
  await expect(player.getByText('0 / 2 watched')).toBeVisible()

  // Manual marking still works, moves the resume point past the episode, and
  // reaches the account straight away so other devices see it.
  const episodeCard = player.locator('div').filter({ has: page.getByRole('button', { name: 'Dulcinea' }) }).last()
  const synced = page.waitForRequest((request) => request.url().endsWith('/api/watch-history') && request.method() === 'POST')
  await episodeCard.getByRole('button', { name: 'Mark as watched' }).click()
  expect((await synced).postDataJSON().entries).toContainEqual(expect.objectContaining({ key: 'tv:10:1:1', watched: true }))
  await expect(player.getByText('1 / 2 watched')).toBeVisible()
  await expect(episodeCard.getByRole('button', { name: 'Mark as unwatched' })).toBeVisible()

  await page.goto('/tv/10')
  await expect(page.getByRole('button', { name: 'Watch S1 E2' })).toBeVisible()

  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Watch Movie' }).click()
  await page.getByRole('button', { name: 'Exit theater mode' }).click()
  await player.getByRole('button', { name: 'Play video' }).click()

  await page.goto('/')
  const continueRow = page.locator('#continue-watching')
  await expect(continueRow.locator('article', { hasText: 'The Expanse' }).getByText('S1 E1')).toBeVisible()
  await expect(continueRow.locator('article', { hasText: 'Dune: Part Two' })).toHaveCount(0)
  expect(watchServer.entries.has('movie:1')).toBe(false)

  await page.goto('/movie/1')
  await expect(page.getByRole('button', { name: 'Resume' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Mark as watched' }).click()
  await expect(page.getByRole('button', { name: 'Watched' })).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/')
  await expect(page.locator('article', { hasText: 'Dune: Part Two' }).first().getByText('Watched')).toBeVisible()
  await expect.poll(() => watchServer.entries.get('movie:1')?.watched).toBe(true)
})

test('history from the old format is kept as in progress and can be removed from Continue Watching', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.removeItem('fedora-movies:watched-history:v2')
    localStorage.setItem('fedora-movies:watched-history:v1', JSON.stringify({
      'movie:1': { watched: true, updatedAt: 1 },
      'tv:10:1:2': { watched: true, updatedAt: 2 },
    }))
  })
  await page.reload()

  const continueRow = page.locator('#continue-watching')
  const duneCard = continueRow.locator('article', { hasText: 'Dune: Part Two' })
  await expect(duneCard).toBeVisible()
  await expect(duneCard.getByText('Watched')).toHaveCount(0)
  await expect(continueRow.locator('article', { hasText: 'The Expanse' }).getByText('S1 E2')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('fedora-movies:watched-history:v1'))).toBeNull()

  await page.goto('/tv/10')
  await expect(page.getByRole('button', { name: 'Resume S1 E2' })).toBeVisible()

  await page.goto('/')
  await continueRow.getByRole('button', { name: 'Remove Dune: Part Two from Continue Watching' }).click()
  await expect(continueRow.locator('article', { hasText: 'Dune: Part Two' })).toHaveCount(0)
  await page.reload()
  await expect(continueRow.locator('article', { hasText: 'The Expanse' })).toBeVisible()
  await expect(continueRow.locator('article', { hasText: 'Dune: Part Two' })).toHaveCount(0)
})

test('embedded player progress is saved and Continue Watching resumes playback', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const embedUrl = 'https://player.example.test/embed/movie/1'
  let reportedTime = 300
  await page.route('**/api/media-sources/movie/1', async (route) => {
    await route.fulfill({
      json: {
        data: {
          sources: [{
            id: 'flixbaba-default',
            mediaType: 'movie',
            tmdbId: 1,
            seasonNumber: null,
            episodeNumber: null,
            label: 'Flixbaba Stream (Dynamic)',
            sourceUrl: 'https://flixbaba.mov/movie/1/dune-part-two/watch',
            mimeType: 'video/mp4',
            rightsBasis: 'licensed',
            isDynamic: true,
          }],
        },
      },
    })
  })
  await page.route('**/api/media-sources/extract**', async (route) => {
    await route.fulfill({ json: { data: { extractedUrl: embedUrl } } })
  })
  await page.route('https://player.example.test/**', async (route) => {
    const message = JSON.stringify({ type: 'PLAYER_EVENT', data: { event: 'timeupdate', currentTime: reportedTime, duration: 1000 } })
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><title>Test player</title><script>parent.postMessage(${message}, '*')</script>`,
    })
  })

  await page.clock.install()
  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Play movie' }).click()
  await expect(page.locator('#streaming-player iframe')).toHaveAttribute('src', embedUrl)
  await expect(page.locator('#streaming-player iframe')).toHaveClass(/opacity-100/)
  await watchFor(page, 5 * 60_000 + 15_000)
  await expect(page.getByRole('button', { name: 'Resume from 5:00' })).toBeVisible()

  await page.goto('/')
  const continueRow = page.locator('#continue-watching')
  await expect(continueRow.getByRole('progressbar', { name: 'Dune: Part Two progress' })).toHaveAttribute('aria-valuenow', '30')

  reportedTime = 950
  await continueRow.getByRole('link', { name: 'Continue watching Dune: Part Two' }).first().click()
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeVisible()
  await expect(page.locator('#streaming-player iframe')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Watched' })).toHaveAttribute('aria-pressed', 'true')

  await page.goto('/')
  await expect(page.locator('#continue-watching')).toHaveCount(0)
})

// Advances a fake clock one watcher tick at a time, so each tick sees real elapsed time.
test('a title counts only after five minutes of visible playback and is watched once most of its runtime has played', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await useSilentDynamicMovie(page, 10)
  await page.clock.install()
  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Play movie' }).click()
  const iframe = page.locator('#streaming-player iframe')
  await expect(iframe).toHaveClass(/opacity-100/)

  // Time while the page is hidden is not watch time.
  await setPageVisibility(page, 'hidden')
  await watchFor(page, 10 * 60_000)
  await setPageVisibility(page, 'visible')
  await watchFor(page, 4 * 60_000)
  expect(watchServer.entries.has('movie:1')).toBe(false)
  expect(watchServer.syncs).toEqual([])

  await watchFor(page, 75_000)
  await expect.poll(() => watchServer.entries.get('movie:1')?.watchSeconds ?? 0).toBeGreaterThanOrEqual(300)
  expect(watchServer.entries.get('movie:1')?.watched).toBe(false)
  expect(watchServer.titles.get('movie:1')).toMatchObject({ item: expect.objectContaining({ title: 'Dune: Part Two' }) })
  expect(watchServer.titles.get('movie:1')).not.toHaveProperty('removed')

  await page.goto('/')
  await expect(page.locator('#continue-watching').locator('article', { hasText: 'Dune: Part Two' })).toBeVisible()

  // Watch time carries over: 90% of the 10-minute runtime is reached after four more minutes.
  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Play movie' }).click()
  await expect(iframe).toHaveClass(/opacity-100/)
  await watchFor(page, 3 * 60_000)
  await expect(page.getByRole('button', { name: 'Mark as watched' })).toBeVisible()
  await watchFor(page, 60_000)
  await expect(page.getByRole('button', { name: 'Watched', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => watchServer.entries.get('movie:1')?.watched).toBe(true)
})

test('history recorded on another device shows here and refreshes when the app regains focus', async ({ page }) => {
  await page.clock.install()
  const now = Date.now()
  watchServer.entries.set('tv:10:1:1', { watched: true, watchSeconds: 1_500, updatedAt: now })
  watchServer.titles.set('tv:10', {
    mediaType: 'tv',
    id: 10,
    seasonNumber: 1,
    episodeNumber: 1,
    item: { id: 10, mediaType: 'tv', title: 'The Expanse', overview: '', posterPath: '/expanse.jpg', backdropPath: null, voteAverage: 8.1, date: null, year: null },
    updatedAt: now,
  })

  await page.goto('/')
  await expect(page.locator('#continue-watching').locator('article', { hasText: 'The Expanse' })).toBeVisible()
  await page.goto('/tv/10')
  await expect(page.getByRole('button', { name: 'Watch S1 E2' })).toBeVisible()

  await page.goto('/movie/1')
  await expect(page.getByRole('button', { name: 'Mark as watched' })).toBeVisible()
  watchServer.entries.set('movie:1', { watched: true, watchSeconds: 9_000, updatedAt: Date.now() + 1 })
  await page.clock.fastForward(31_000)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(page.getByRole('button', { name: 'Watched' })).toHaveAttribute('aria-pressed', 'true')
})

test('watch history follows the account between devices', async ({ page }) => {
  const otherDeviceTime = Date.now() - 60_000
  const posted: { entries: Record<string, unknown>[]; titles: Record<string, unknown>[] }[] = []
  await page.route('**/api/watch-history', async (route) => {
    if (route.request().method() === 'POST') {
      posted.push(route.request().postDataJSON())
      return route.fulfill({ json: { data: { synced: 1 } } })
    }
    return route.fulfill({
      json: {
        data: {
          entries: { 'tv:10:1:1': { watched: true, updatedAt: otherDeviceTime } },
          titles: { 'tv:10': { mediaType: 'tv', id: 10, seasonNumber: 1, episodeNumber: 2, updatedAt: otherDeviceTime } },
        },
      },
    })
  })

  // Progress made on another device shows up here.
  await page.goto('/')
  const continueRow = page.locator('#continue-watching')
  await expect(continueRow.locator('article', { hasText: 'The Expanse' }).getByText('S1 E2')).toBeVisible()
  await page.goto('/tv/10')
  await expect(page.getByRole('button', { name: 'Resume S1 E2' })).toBeVisible()
  // Nothing changed on this device, so nothing is sent back.
  await page.waitForTimeout(2_500)
  expect(posted).toHaveLength(0)

  // Changes made here are sent to the server for the other devices.
  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Mark as watched' }).click()
  await expect.poll(() => posted.flatMap((body) => body.entries)).toContainEqual(
    expect.objectContaining({ key: 'movie:1', watched: true }),
  )

  await page.goto('/')
  await continueRow.getByRole('button', { name: 'Remove The Expanse from Continue Watching' }).click()
  await expect(continueRow).toHaveCount(0)
  await expect.poll(() => posted.flatMap((body) => body.titles)).toContainEqual(
    expect.objectContaining({ key: 'tv:10', mediaType: 'tv', id: 10, removed: true }),
  )
})

test('history saved on this device before sync is uploaded after sign-in', async ({ page }) => {
  const posted: { entries: Record<string, unknown>[] }[] = []
  await page.route('**/api/watch-history', async (route) => {
    if (route.request().method() === 'POST') {
      posted.push(route.request().postDataJSON())
      return route.fulfill({ json: { data: { synced: 1 } } })
    }
    return route.fulfill({ json: { data: { entries: {}, titles: {} } } })
  })
  await page.addInitScript(() => {
    if (localStorage.getItem('seeded')) return
    localStorage.setItem('seeded', '1')
    localStorage.setItem('fedora-movies:watched-history:v2', JSON.stringify({
      entries: { 'movie:1': { watched: true, updatedAt: 1_700_000_000_000 } },
      titles: {},
    }))
  })
  await page.goto('/')
  await expect.poll(() => posted.flatMap((body) => body.entries)).toContainEqual(
    expect.objectContaining({ key: 'movie:1', watched: true, updatedAt: 1_700_000_000_000 }),
  )
  // The cache now belongs to the signed-in account.
  expect(await page.evaluate(() => localStorage.getItem('fedora-movies:watched-history:v2'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('fedora-movies:watched-history:v2:viewer-test-id'))).toContain('movie:1')
})
