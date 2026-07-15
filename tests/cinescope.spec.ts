import { expect, test, type Page } from '@playwright/test'

const movie = {
  id: 1,
  title: 'Dune: Part Two',
  overview: 'Paul Atreides unites with Chani and the Fremen while seeking justice for his family.',
  poster_path: '/dune-poster.jpg',
  backdrop_path: '/dune-backdrop.jpg',
  vote_average: 8.3,
  release_date: '2024-02-27',
}

const movieTwo = {
  id: 2,
  title: 'Arrival',
  overview: 'A linguist works with the military to communicate with visitors from another world.',
  poster_path: null,
  backdrop_path: '/arrival.jpg',
  vote_average: 7.6,
  release_date: '2016-11-10',
}

const tvShow = {
  id: 10,
  name: 'The Expanse',
  overview: 'Humanity has colonised the solar system and a mystery threatens the peace.',
  poster_path: '/expanse.jpg',
  backdrop_path: '/expanse-backdrop.jpg',
  vote_average: 8.1,
  first_air_date: '2015-12-14',
}

const paginated = (results: object[], page = 1, totalPages = 2) => ({
  page,
  results,
  total_pages: totalPages,
  total_results: results.length * totalPages,
})

const detailsExtras = {
  genres: [
    { id: 878, name: 'Science Fiction' },
    { id: 12, name: 'Adventure' },
  ],
  credits: {
    cast: [
      { id: 101, name: 'Zendaya', character: 'Chani', profile_path: '/zendaya.jpg', order: 0 },
      { id: 102, name: 'Timothée Chalamet', character: 'Paul Atreides', profile_path: null, order: 1 },
    ],
    crew: [{ id: 201, name: 'Denis Villeneuve', job: 'Director', department: 'Directing' }],
  },
  videos: {
    results: [
      { id: 'teaser', key: 'teaser-key', name: 'Teaser', site: 'YouTube', type: 'Teaser', official: true },
      { id: 'trailer', key: 'official-key', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true },
    ],
  },
  similar: paginated([movieTwo], 1, 1),
  'watch/providers': {
    results: {
      ZA: {
        link: 'https://www.themoviedb.org/movie/1/watch?locale=ZA',
        flatrate: [{ provider_id: 8, provider_name: 'Example Stream', logo_path: '/provider.jpg', display_priority: 1 }],
        rent: [{ provider_id: 3, provider_name: 'Example Rentals', logo_path: null, display_priority: 2 }],
      },
    },
  },
}

async function mockTmdb(page: Page) {
  await page.route('https://image.tmdb.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
    })
  })
  await page.route('https://www.youtube-nocookie.com/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Trailer</title>' })
  })
  await page.route('https://api.themoviedb.org/3/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/3', '')
    const currentPage = Number(url.searchParams.get('page') ?? '1')

    if (path === '/trending/movie/week') return route.fulfill({ json: paginated([movie, movieTwo]) })
    if (path === '/movie/popular') return route.fulfill({ json: paginated(currentPage === 1 ? [movie, movieTwo] : [{ ...movieTwo, id: 3, title: 'Blade Runner 2049' }], currentPage) })
    if (path === '/movie/top_rated') return route.fulfill({ json: paginated([movieTwo], 1, 1) })
    if (path === '/movie/upcoming') return route.fulfill({ json: paginated([{ ...movieTwo, id: 4, title: 'Future Worlds' }], 1, 1) })
    if (path === '/tv/popular') return route.fulfill({ json: paginated(currentPage === 1 ? [tvShow] : [{ ...tvShow, id: 11, name: 'Foundation' }], currentPage) })

    if (path === '/search/multi') {
      const query = url.searchParams.get('query') ?? ''
      if (query === 'fail') return route.fulfill({ status: 500, json: { status_message: 'Failure' } })
      if (query === 'nothing') return route.fulfill({ json: paginated([], 1, 1) })
      if (query === 'slow') await new Promise((resolve) => setTimeout(resolve, 500))
      const results = [
        { ...movie, media_type: 'movie' },
        { ...tvShow, media_type: 'tv' },
        { id: 999, name: 'A Person', media_type: 'person', profile_path: null },
      ]
      return route.fulfill({ json: paginated(results, currentPage, 2) })
    }

    if (path === '/movie/1') return route.fulfill({ json: { ...movie, runtime: 166, ...detailsExtras } })
    if (path === '/tv/10') return route.fulfill({ json: { ...tvShow, number_of_seasons: 6, ...detailsExtras, similar: paginated([{ ...tvShow, id: 11 }], 1, 1) } })
    return route.fulfill({ status: 404, json: { status_message: 'Not found' } })
  })
}

test.beforeEach(async ({ page }) => {
  await mockTmdb(page)
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
  await expect(page.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
  await expect(page.getByText('Director:')).toBeVisible()
  await expect(page.getByText('Denis Villeneuve')).toBeVisible()
  await expect(page.getByText('Example Stream')).toBeVisible()
  await expect(page.getByText(/supplied by JustWatch/)).toBeVisible()
  await expect(page.getByRole('link', { name: 'View legal options on TMDB' })).toHaveAttribute('href', /themoviedb\.org/)

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
  await expect(page.getByRole('heading', { level: 1, name: 'The Expanse' })).toBeVisible()
  await expect(page.getByText('6 seasons')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Similar shows' })).toBeVisible()
})

test('browse pagination, invalid routes, and mobile layouts remain functional', async ({ page }) => {
  await page.goto('/movies')
  await expect(page.getByRole('heading', { level: 1, name: 'Popular movies' })).toBeVisible()
  await page.getByRole('button', { name: 'Load more' }).click()
  await expect(page.getByText('Blade Runner 2049', { exact: true })).toBeVisible()

  for (const width of [360, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 800 })
    for (const path of ['/', '/search?q=dune', '/movie/1', '/tv/10', '/favourites']) {
      await page.goto(path)
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    }

    await page.goto('/')
    const hero = page.getByRole('heading', { level: 1, name: 'Dune: Part Two' }).locator('..').locator('..').locator('..')
    const heroBox = await hero.boundingBox()
    expect(heroBox?.height ?? 800).toBeLessThan(640)
    await page.getByRole('button', { name: 'Watch trailer' }).click()
    const modalBox = await page.getByRole('dialog').boundingBox()
    expect(modalBox?.x ?? -1).toBeGreaterThanOrEqual(0)
    expect((modalBox?.x ?? 0) + (modalBox?.width ?? width + 1)).toBeLessThanOrEqual(width)
    expect(modalBox?.height ?? 801).toBeLessThanOrEqual(800)
    await page.getByRole('button', { name: 'Close trailer' }).click()
  }

  await page.goto('/movie/not-a-number')
  await expect(page.getByRole('alert')).toContainText('invalid address')
  await page.goto('/route-that-does-not-exist')
  await expect(page.getByRole('heading', { name: 'This page wandered off' })).toBeVisible()
})
