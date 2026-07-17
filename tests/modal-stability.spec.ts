import { expect, test, type Page } from '@playwright/test'

// Guards the movie-details modal against the flicker / layout-shift / stale-content
// regressions: the shell must never paint empty, its geometry must stay fixed while
// details load, and selecting a new title must not flash the previous one.

const dune = {
  id: 1,
  title: 'Dune: Part Two',
  overview: 'Paul Atreides unites with Chani and the Fremen while seeking justice for his family.',
  poster_path: '/dune-poster.jpg',
  backdrop_path: '/dune-backdrop.jpg',
  vote_average: 8.3,
  release_date: '2024-02-27',
}

const arrival = {
  id: 2,
  title: 'Arrival',
  overview: 'A linguist works with the military to communicate with visitors from another world.',
  poster_path: '/arrival-poster.jpg',
  backdrop_path: '/arrival-backdrop.jpg',
  vote_average: 7.6,
  release_date: '2016-11-10',
}

const extras = (similar: object[]) => ({
  genres: [{ id: 878, name: 'Science Fiction' }],
  credits: { cast: [], crew: [{ id: 201, name: 'Denis Villeneuve', job: 'Director', department: 'Directing' }] },
  videos: { results: [] },
  similar: { page: 1, results: similar, total_pages: 1, total_results: similar.length },
  'watch/providers': { results: {} },
})

const paginated = (results: object[]) => ({ page: 1, results, total_pages: 1, total_results: results.length })

async function mock(page: Page, detailsDelayMs = 400) {
  await page.route('**/api/auth/**', (route) =>
    route.fulfill({
      json: {
        data: {
          account: {
            id: 'viewer-test-id', username: 'test.viewer', displayName: 'Test Viewer', active: true,
            mustChangePassword: false, expiresAt: null, createdAt: 1, updatedAt: 1, lastLoginAt: 1,
          },
        },
      },
    }),
  )
  await page.route('**/api/favourites**', (route) => route.fulfill({ json: { data: { favourites: [] } } }))
  await page.route('**/api/media-sources/**', (route) => route.fulfill({ json: { data: { sources: [] } } }))
  await page.route('https://image.tmdb.org/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    }),
  )
  await page.route('**/api/tmdb/**', async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/tmdb', '')
    if (path === '/trending/movie/week') return route.fulfill({ json: paginated([dune, arrival]) })
    if (path === '/movie/popular') return route.fulfill({ json: paginated([dune, arrival]) })
    if (path === '/movie/top_rated') return route.fulfill({ json: paginated([]) })
    if (path === '/movie/upcoming') return route.fulfill({ json: paginated([]) })
    if (path === '/tv/popular') return route.fulfill({ json: paginated([]) })
    if (path === '/movie/1') {
      if (detailsDelayMs) await new Promise((r) => setTimeout(r, detailsDelayMs))
      return route.fulfill({ json: { ...dune, runtime: 166, ...extras([arrival]) } })
    }
    if (path === '/movie/2') {
      if (detailsDelayMs) await new Promise((r) => setTimeout(r, detailsDelayMs))
      return route.fulfill({ json: { ...arrival, runtime: 116, ...extras([dune]) } })
    }
    return route.fulfill({ status: 404, json: { status_message: 'Not found' } })
  })
}

// Records, once per animation frame, whether the modal shell is visibly painted
// while it holds neither skeleton, loaded content, nor an error state.
async function startFrameSampler(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __emptyFrames: number; __modalFrames: number; __stop?: () => void }
    w.__emptyFrames = 0
    w.__modalFrames = 0
    let running = true
    const tick = () => {
      if (!running) return
      const root = document.querySelector('div.fixed.inset-0.z-50') as HTMLElement | null
      if (root) {
        const panel = root.querySelector(':scope > div.max-w-5xl') as HTMLElement | null
        const opacity = panel ? Number(getComputedStyle(panel).opacity) : 0
        if (opacity > 0.05) {
          w.__modalFrames++
          const filled = root.querySelector('.animate-pulse, article, [role="alert"]')
          if (!filled) w.__emptyFrames++
        }
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    w.__stop = () => (running = false)
  })
}

async function stopFrameSampler(page: Page) {
  return page.evaluate(() => {
    const w = window as unknown as { __emptyFrames: number; __modalFrames: number; __stop?: () => void }
    w.__stop?.()
    return { empty: w.__emptyFrames, total: w.__modalFrames }
  })
}

test('opening a card never paints an empty modal and keeps a stationary close button', async ({ page }) => {
  await mock(page, 700)
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()

  await startFrameSampler(page)
  await page.getByRole('link', { name: 'View details for Dune: Part Two' }).first().click()

  // Skeleton must be present immediately, before the details resolve.
  const closeButton = page.getByRole('button', { name: 'Close details' })
  await expect(closeButton).toBeVisible()
  await expect(page.locator('div.fixed.inset-0.z-50 .animate-pulse').first()).toBeVisible()

  // Measure only once the entrance transform has settled (rendered width equals
  // layout width ⇒ scale is 1), so we isolate any shift caused by data loading
  // rather than by the entrance scale animation.
  const panel = page.locator('div.fixed.inset-0.z-50 > div.max-w-5xl')
  const settled = () =>
    panel.evaluate((el) => Math.abs(el.getBoundingClientRect().width - (el as HTMLElement).offsetWidth) < 0.5)
  await expect.poll(settled).toBe(true)
  const boxWhileLoading = await closeButton.boundingBox()

  // Then the loaded content arrives.
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
  await expect.poll(settled).toBe(true)
  const boxWhenLoaded = await closeButton.boundingBox()

  const frames = await stopFrameSampler(page)
  expect(frames.empty, 'no visible frame may show an empty modal shell').toBe(0)
  expect(frames.total, 'the modal should have been sampled while visible').toBeGreaterThan(0)

  // The close button must not move when data loads.
  expect(Math.abs((boxWhileLoading?.x ?? 0) - (boxWhenLoaded?.x ?? 0))).toBeLessThanOrEqual(1)
  expect(Math.abs((boxWhileLoading?.y ?? 0) - (boxWhenLoaded?.y ?? 0))).toBeLessThanOrEqual(1)
})

test('switching to a different title clears to a skeleton without an empty frame', async ({ page }) => {
  await mock(page, 400)
  await page.goto('/')
  await page.getByRole('link', { name: 'View details for Dune: Part Two' }).first().click()
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()

  // Navigate to another title via the in-modal "Similar movies" row. The details
  // component instance is reused across this navigation, so this is where the old
  // data was previously retained and where the shell could momentarily empty. The
  // home card and the in-modal "Similar" card share this label; the modal one
  // (rendered last, on top) is the target.
  const similarArrival = page.getByRole('link', { name: 'View details for Arrival' }).last()
  await similarArrival.scrollIntoViewIfNeeded()

  await startFrameSampler(page)
  await similarArrival.click()

  // The previous title must be cleared to a loading skeleton (not held on screen),
  // proving the request state resets rather than retaining Dune's data...
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeHidden()
  await expect(page.locator('div.fixed.inset-0.z-50 .animate-pulse').first()).toBeVisible()
  // ...and then the new title loads.
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Arrival' })).toBeVisible()

  const frames = await stopFrameSampler(page)
  expect(frames.empty, 'switching titles must not paint an empty shell').toBe(0)
})

test('closing and reopening does not briefly show the previous modal content', async ({ page }) => {
  await mock(page, 250)
  await page.goto('/')
  await page.getByRole('link', { name: 'View details for Dune: Part Two' }).first().click()
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()

  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeHidden()

  await startFrameSampler(page)
  await page.getByRole('link', { name: 'View details for Arrival' }).first().click()
  await expect(page.getByRole('article').getByRole('heading', { level: 1, name: 'Arrival' })).toBeVisible()
  const frames = await stopFrameSampler(page)
  expect(frames.empty, 'reopening must not paint an empty shell').toBe(0)
  // Background scroll stays locked while open, and is released after closing.
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')
})
