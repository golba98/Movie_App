import AxeBuilder from '@axe-core/playwright'
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

const tvSeasonOne = {
  id: 101,
  season_number: 1,
  episodes: [
    {
      id: 1001,
      name: 'Dulcinea',
      overview: 'The crew of the Canterbury investigates a distress call.',
      episode_number: 1,
      season_number: 1,
      still_path: '/dulcinea.jpg',
      air_date: '2015-12-14',
    },
    {
      id: 1002,
      name: 'The Big Empty',
      overview: 'The crew struggles to survive in a damaged shuttle.',
      episode_number: 2,
      season_number: 1,
      still_path: null,
      air_date: '2015-12-15',
    },
  ],
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

const authorisedMediaSources = [
  {
    id: 'movie-1',
    mediaType: 'movie',
    tmdbId: 1,
    seasonNumber: null,
    episodeNumber: null,
    label: 'Test licensed movie',
    sourceUrl: '/test-media/capture-test.mp4',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
  },
  {
    id: 'tv-10-s1e1',
    mediaType: 'tv',
    tmdbId: 10,
    seasonNumber: 1,
    episodeNumber: 1,
    label: 'Test licensed episode one',
    sourceUrl: '/test-media/capture-test.mp4',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
  },
  {
    id: 'tv-10-s1e2',
    mediaType: 'tv',
    tmdbId: 10,
    seasonNumber: 1,
    episodeNumber: 2,
    label: 'Test licensed episode two',
    sourceUrl: '/test-media/capture-test.mp4?episode=2',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
  },
]

async function mockTmdb(page: Page) {
  let favourites: Record<string, unknown>[] = []
  let adminAuthenticated = false
  const accounts: Record<string, unknown>[] = []
  let adminMediaSources: Record<string, unknown>[] = []
  let adminSearchProviders: Record<string, unknown>[] = [
    {
      id: 'flixbaba-default',
      label: 'Flixbaba',
      baseUrl: 'https://flixbaba.mov',
      movieUrlPattern: '{baseUrl}/movie/{tmdbId}/{slug}/watch',
      tvUrlPattern: '{baseUrl}/tv/{tmdbId}/{slug}',
      active: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
  ]

  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/auth/session') {
      return route.fulfill({
        json: {
          data: {
            account: {
              id: 'viewer-test-id',
              username: 'test.viewer',
              displayName: 'Test Viewer',
              active: true,
              mustChangePassword: false,
              expiresAt: null,
              createdAt: 1_700_000_000_000,
              updatedAt: 1_700_000_000_000,
              lastLoginAt: 1_700_000_000_000,
            },
          },
        },
      })
    }
    return route.fulfill({ json: { data: { authenticated: false } } })
  })
  await page.route('**/api/favourites**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/favourites' && request.method() === 'GET') {
      return route.fulfill({ json: { data: { favourites } } })
    }
    if (url.pathname === '/api/favourites/import') {
      const body = request.postDataJSON() as { favourites: Record<string, unknown>[] }
      favourites = [...body.favourites, ...favourites]
      return route.fulfill({ json: { data: { imported: body.favourites.length } } })
    }
    const match = url.pathname.match(/^\/api\/favourites\/(movie|tv)\/(\d+)$/)
    if (match && request.method() === 'PUT') {
      const item = request.postDataJSON() as Record<string, unknown>
      favourites = [item, ...favourites.filter((entry) => !(entry.mediaType === match[1] && entry.id === Number(match[2])))]
      return route.fulfill({ json: { data: { favourite: item } } })
    }
    if (match && request.method() === 'DELETE') {
      favourites = favourites.filter((entry) => !(entry.mediaType === match[1] && entry.id === Number(match[2])))
      return route.fulfill({ json: { data: { removed: true } } })
    }
    return route.fulfill({ status: 404, json: { error: { message: 'Not found' } } })
  })
  await page.route('**/api/media-sources/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/media-sources/extract') {
      const url = new URL(route.request().url())
      const targetUrl = url.searchParams.get('url') ?? ''
      return route.fulfill({ json: { data: { extractedUrl: targetUrl } } })
    }
    const match = path.match(/^\/api\/media-sources\/(movie|tv)\/(\d+)$/)
    const sources = match
      ? authorisedMediaSources.filter((source) => source.mediaType === match[1] && source.tmdbId === Number(match[2]))
      : []
    return route.fulfill({ json: { data: { sources } } })
  })
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === '/api/admin/session') {
      return adminAuthenticated
        ? route.fulfill({ json: { data: { authenticated: true } } })
        : route.fulfill({ status: 401, json: { error: { message: 'Administrator sign-in is required.' } } })
    }
    if (path === '/api/admin/login') {
      adminAuthenticated = true
      return route.fulfill({ json: { data: { authenticated: true } } })
    }
    if (!adminAuthenticated) return route.fulfill({ status: 401, json: { error: { message: 'Sign in first.' } } })
    if (path === '/api/admin/media-sources' && request.method() === 'GET') {
      return route.fulfill({ json: { data: { sources: adminMediaSources } } })
    }
    if (path === '/api/admin/media-sources' && request.method() === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>
      const source = {
        id: `media-source-${adminMediaSources.length + 1}`,
        ...input,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      adminMediaSources = [source, ...adminMediaSources]
      return route.fulfill({ status: 201, json: { data: { source } } })
    }
    const mediaSourceMatch = path.match(/^\/api\/admin\/media-sources\/([^/]+)$/)
    if (mediaSourceMatch && request.method() === 'PATCH') {
      const changes = request.postDataJSON() as Record<string, unknown>
      const source = { ...adminMediaSources.find((item) => item.id === mediaSourceMatch[1]), ...changes, updatedAt: Date.now() }
      adminMediaSources = adminMediaSources.map((item) => item.id === mediaSourceMatch[1] ? source : item)
      return route.fulfill({ json: { data: { source } } })
    }
    if (mediaSourceMatch && request.method() === 'DELETE') {
      adminMediaSources = adminMediaSources.filter((item) => item.id !== mediaSourceMatch[1])
      return route.fulfill({ json: { data: { removed: true } } })
    }
    if (path === '/api/admin/audit') return route.fulfill({ json: { data: { events: [] } } })
    if (path === '/api/admin/accounts' && request.method() === 'GET') return route.fulfill({ json: { data: { accounts } } })
    if (path === '/api/admin/accounts' && request.method() === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>
      const account = {
        id: `account-${accounts.length + 1}`,
        username: input.username,
        displayName: input.displayName,
        active: true,
        mustChangePassword: true,
        expiresAt: input.expiresAt,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        lastLoginAt: null,
      }
      accounts.unshift(account)
      return route.fulfill({ status: 201, json: { data: { account } } })
    }
    if (path.endsWith('/reset-password')) return route.fulfill({ json: { data: { reset: true } } })
    if (path.endsWith('/revoke-sessions')) return route.fulfill({ json: { data: { revoked: 1 } } })
    if (request.method() === 'PATCH') return route.fulfill({ json: { data: { account: accounts[0] } } })
    if (path === '/api/admin/search-providers' && request.method() === 'GET') {
      return route.fulfill({ json: { data: { providers: adminSearchProviders } } })
    }
    if (path === '/api/admin/search-providers' && request.method() === 'POST') {
      const input = request.postDataJSON() as Record<string, unknown>
      const provider = {
        id: `search-provider-${adminSearchProviders.length + 1}`,
        ...input,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      adminSearchProviders = [provider, ...adminSearchProviders]
      return route.fulfill({ status: 201, json: { data: { provider } } })
    }
    const searchProviderMatch = path.match(/^\/api\/admin\/search-providers\/([^/]+)$/)
    if (searchProviderMatch && request.method() === 'PATCH') {
      const changes = request.postDataJSON() as Record<string, unknown>
      const provider = { ...adminSearchProviders.find((item) => item.id === searchProviderMatch[1]), ...changes, updatedAt: Date.now() }
      adminSearchProviders = adminSearchProviders.map((item) => item.id === searchProviderMatch[1] ? provider : item)
      return route.fulfill({ json: { data: { provider } } })
    }
    if (searchProviderMatch && request.method() === 'DELETE') {
      adminSearchProviders = adminSearchProviders.filter((item) => item.id !== searchProviderMatch[1])
      return route.fulfill({ json: { data: { removed: true } } })
    }
    return route.fulfill({ json: { data: {} } })
  })
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
  await page.route('**/test-media/capture-test.mp4*', async (route) => {
    await route.abort('aborted')
  })
  await page.route('**/api/tmdb/**', async (route) => {
    const url = new URL(route.request().url())
    const path = url.pathname.replace('/api/tmdb', '')
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
    if (path === '/tv/10/season/1') return route.fulfill({ json: tvSeasonOne })
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

test('admin can sign in and create a viewer without retaining the password', async ({ page }) => {
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administrator' })).toBeVisible()
  const adminPassword = page.getByLabel('Administrator password', { exact: true })
  await adminPassword.fill('test-admin-password')
  await expect(adminPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Show Administrator password' }).click()
  await expect(adminPassword).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide Administrator password' }).click()
  await expect(adminPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Open admin' }).click()
  await expect(page.getByRole('heading', { name: 'Control the library' })).toBeVisible()
  await expect(page.getByLabel('Search viewer accounts')).toHaveCSS('padding-left', '44px')

  await page.getByLabel('TMDB ID').fill('1')
  await page.getByLabel('Display label').fill('Owned capture demonstration')
  await page.getByLabel('Direct media URL').fill('/test-media/capture-test.mp4')
  await page.getByRole('button', { name: 'Add authorised source' }).click()
  await expect(page.getByRole('heading', { name: 'Owned capture demonstration' })).toBeVisible()
  await expect(page.getByText(/Added Owned capture demonstration/)).toBeVisible()

  await page.getByLabel('Username').fill('new.viewer')
  await page.getByLabel('Display name').fill('New Viewer')
  const temporaryPassword = page.getByLabel('Temporary password', { exact: true })
  await temporaryPassword.fill('temporary-password-123')
  await page.getByRole('button', { name: 'Show Temporary password' }).click()
  await expect(temporaryPassword).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide Temporary password' }).click()
  await expect(temporaryPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByRole('heading', { name: 'new.viewer' })).toBeVisible()
  await expect(page.getByText(/Created new.viewer/)).toBeVisible()
  await expect(page.getByLabel('Temporary password', { exact: true })).toHaveValue('')

  await page.getByRole('button', { name: /Reset password/ }).click()
  await expect(page.getByRole('dialog', { name: 'Reset new.viewer' })).toBeVisible()
  const resetPassword = page.getByLabel('New temporary password', { exact: true })
  await resetPassword.fill('replacement-password-456')
  await page.getByRole('button', { name: 'Show New temporary password' }).click()
  await expect(resetPassword).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide New temporary password' }).click()
  await expect(resetPassword).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByText(/Reset new.viewer's password/)).toBeVisible()
})

test('home and administrator sign-in have no serious accessibility violations', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeVisible()
  const homeResults = await new AxeBuilder({ page }).analyze()
  expect(homeResults.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])

  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'Administrator' })).toBeVisible()
  const adminResults = await new AxeBuilder({ page }).analyze()
  expect(adminResults.violations.filter((violation) => ['serious', 'critical'].includes(violation.impact ?? ''))).toEqual([])
})

test('viewer login enforces the first-password-change flow', async ({ page }) => {
  let changed = false
  await page.route('**/api/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    const account = {
      id: 'first-login-id',
      username: 'first.viewer',
      displayName: 'First Viewer',
      active: true,
      mustChangePassword: !changed,
      expiresAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      lastLoginAt: null,
    }
    if (path === '/api/auth/session') {
      return route.fulfill({ status: 401, json: { error: { message: 'Sign in to continue.' } } })
    }
    if (path === '/api/auth/login') return route.fulfill({ json: { data: { account } } })
    if (path === '/api/auth/change-password') {
      changed = true
      return route.fulfill({ json: { data: { account: { ...account, mustChangePassword: false } } } })
    }
    return route.fulfill({ json: { data: {} } })
  })

  await page.goto('/login?next=%2Fmovies')
  await page.getByLabel('Username').fill('first.viewer')
  const password = page.getByLabel('Password', { exact: true })
  await password.fill('temporary-password-123')
  await page.getByRole('button', { name: 'Show Password' }).click()
  await expect(password).toHaveAttribute('type', 'text')
  await page.getByRole('button', { name: 'Hide Password' }).click()
  await expect(password).toHaveAttribute('type', 'password')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Choose your own password' })).toBeVisible()
  const firstLoginPassword = page.getByLabel('Temporary password', { exact: true })
  await firstLoginPassword.fill('temporary-password-123')
  await page.getByRole('button', { name: 'Show Temporary password' }).click()
  await expect(firstLoginPassword).toHaveAttribute('type', 'text')
  await page.getByLabel('New password', { exact: true }).fill('new-secure-password-456')
  await page.getByLabel('Confirm new password', { exact: true }).fill('new-secure-password-456')
  await page.getByRole('button', { name: 'Save password and continue' }).click()
  await expect(page).toHaveURL(/\/movies$/)
})

test('plays only administrator-configured authorised media sources', async ({ page }) => {
  await page.goto('/movie/1')
  await expect(page.locator('#streaming-player')).toBeVisible()
  await page.getByRole('button', { name: 'Watch Movie' }).click()
  const player = page.locator('#streaming-player')
  await expect(player).toBeVisible()
  const movieVideo = player.getByLabel('Video player for Dune: Part Two')
  await expect(movieVideo).toHaveAttribute('src', '/test-media/capture-test.mp4')
  await expect(movieVideo).not.toHaveAttribute('controls', '')
  await expect(movieVideo).toHaveAttribute('playsinline', '')
  await expect(movieVideo).toHaveAttribute('preload', 'metadata')
  await expect(player.getByRole('button', { name: 'Play video' })).toBeVisible()
  await expect(player.getByLabel('Seek video')).toBeVisible()
  await expect(player.getByRole('button', { name: 'Mute video' })).toBeVisible()
  await expect(player.getByLabel('Video volume')).toBeVisible()
  await expect(player.locator('iframe, canvas')).toHaveCount(0)

  await movieVideo.evaluate((element) => {
    const state = window as typeof window & {
      __movieVideo?: Element
      __moviePauseCalls?: number
      __moviePlayCalls?: number
    }
    const video = element as HTMLVideoElement
    state.__movieVideo = video
    state.__moviePauseCalls = 0
    state.__moviePlayCalls = 0
    const nativePause = video.pause.bind(video)
    video.pause = () => {
      state.__moviePauseCalls = (state.__moviePauseCalls ?? 0) + 1
      nativePause()
    }
    video.play = () => {
      state.__moviePlayCalls = (state.__moviePlayCalls ?? 0) + 1
      video.dispatchEvent(new Event('play'))
      return Promise.resolve()
    }
  })
  await player.getByRole('button', { name: 'Play video' }).click()
  await expect(player.getByRole('button', { name: 'Pause video' })).toBeVisible()
  expect(await page.evaluate(() => (window as typeof window & { __moviePlayCalls?: number }).__moviePlayCalls)).toBe(1)
  await player.getByRole('button', { name: 'Pause video' }).click()
  await page.evaluate(() => {
    window.dispatchEvent(new Event('blur'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('focus'))
  })
  // Watch Movie opens theater mode directly, so leaving it exercises the same
  // invariant the enter path used to: the element must survive the toggle.
  await player.getByRole('button', { name: 'Exit theater mode' }).click()
  expect(await movieVideo.evaluate((element) => element === (window as typeof window & { __movieVideo?: Element }).__movieVideo)).toBe(true)
  expect(await page.evaluate(() => (window as typeof window & { __moviePauseCalls?: number }).__moviePauseCalls)).toBe(0)

  await page.goto('/tv/10')
  await page.getByRole('button', { name: 'Watch Show' }).click()
  await page.getByRole('button', { name: 'Exit theater mode' }).click()

  const tvPlayer = page.locator('#streaming-player')
  await expect(tvPlayer).toBeVisible()
  await expect(tvPlayer.getByRole('button', { name: /Dulcinea/ })).toBeVisible()
  await expect(tvPlayer.getByRole('button', { name: /The Big Empty/ })).toBeVisible()
  const tvVideo = tvPlayer.getByLabel('Video player for The Expanse')
  await tvVideo.evaluate((element) => {
    (window as typeof window & { __tvVideo?: Element }).__tvVideo = element
  })
  await tvPlayer.getByRole('button', { name: /The Big Empty/ }).click()
  await expect(tvVideo).toHaveAttribute('src', '/test-media/capture-test.mp4?episode=2')
  expect(await tvVideo.evaluate((element) => element === (window as typeof window & { __tvVideo?: Element }).__tvVideo)).toBe(true)
})

test('does not claim in-app playback when no authorised source exists', async ({ page }) => {
  await page.route('**/api/media-sources/movie/1', async (route) => {
    await route.fulfill({ json: { data: { sources: [] } } })
  })
  await page.goto('/movie/1')
  await expect(page.getByRole('button', { name: 'Watch Movie' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'View video player' })).toHaveCount(0)
  await expect(page.locator('#streaming-player')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'No authorised source is available' })).toHaveCount(0)
  await expect(page.getByText(/No owned or licensed video is configured/)).toBeVisible()
})

test('capture compatibility start and stop never pauses or replaces the original video', async ({ page }) => {
  await page.goto('/capture-test')
  await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 16
    canvas.height = 9
    const stream = canvas.captureStream(30)
    const track = stream.getVideoTracks()[0]
    const nativeStop = track.stop.bind(track)
    Object.defineProperty(track, 'getSettings', {
      configurable: true,
      value: () => ({ displaySurface: 'browser', width: 1280, height: 720, frameRate: 30 }),
    })
    track.stop = () => {
      const state = window as typeof window & { __captureTrackStopCalls?: number }
      state.__captureTrackStopCalls = (state.__captureTrackStopCalls ?? 0) + 1
      nativeStop()
    }
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia: async () => stream },
    })
  })
  const original = page.getByLabel('Original capture compatibility test video')
  await expect(original).toHaveAttribute('controls', '')
  await expect(original).toHaveAttribute('playsinline', '')
  await expect(original).toHaveAttribute('preload', 'metadata')
  await original.evaluate((element) => {
    const state = window as typeof window & { __captureOriginal?: Element; __captureOriginalPauseCalls?: number }
    const video = element as HTMLVideoElement
    state.__captureOriginal = video
    state.__captureOriginalPauseCalls = 0
    const nativePause = video.pause.bind(video)
    video.pause = () => {
      state.__captureOriginalPauseCalls = (state.__captureOriginalPauseCalls ?? 0) + 1
      nativePause()
    }
  })

  await page.getByRole('button', { name: 'Test screen capture' }).click()
  await expect(page.getByRole('status')).toContainText('Surface: browser')
  expect(await original.evaluate((element) => element === (window as typeof window & { __captureOriginal?: Element }).__captureOriginal)).toBe(true)
  expect(await page.evaluate(() => (window as typeof window & { __captureOriginalPauseCalls?: number }).__captureOriginalPauseCalls)).toBe(0)

  await page.getByRole('button', { name: 'Stop capture' }).click()
  await expect(page.getByRole('status')).toContainText('Capture stopped')
  expect(await page.evaluate(() => (window as typeof window & { __captureTrackStopCalls?: number }).__captureTrackStopCalls)).toBe(1)
  expect(await page.evaluate(() => (window as typeof window & { __captureOriginalPauseCalls?: number }).__captureOriginalPauseCalls)).toBe(0)
})

test('the watch button opens a full-viewport theater player and Escape only exits it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/movie/1')

  const video = page.getByLabel('Video player for Dune: Part Two')
  await expect(video).toBeVisible()

  const inlineBox = await video.boundingBox()
  expect(inlineBox?.width).toBeLessThan(1280)

  await video.evaluate((element) => {
    (window as typeof window & { __theaterVideo?: Element }).__theaterVideo = element
  })

  await page.getByRole('button', { name: 'Watch Movie' }).click()

  const theaterBox = await video.boundingBox()
  expect(theaterBox?.width).toBe(1280)
  expect(theaterBox?.height).toBe(720)

  // Same element instance: promoting via CSS must not restart playback.
  expect(
    await video.evaluate(
      (element) => element === (window as typeof window & { __theaterVideo?: Element }).__theaterVideo,
    ),
  ).toBe(true)

  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/movie\/1$/)
  const restoredBox = await video.boundingBox()
  expect(restoredBox?.width).toBeLessThan(1280)
})

test('dynamic players start inline, can expand to theater mode, and always leave the site recoverable', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const wrapperUrl = 'https://flixbaba.mov/movie/1/dune-part-two/watch'
  const embedUrl = 'https://player.example.test/embed/movie/1'
  const dynamicSource = {
    id: 'flixbaba-default',
    mediaType: 'movie',
    tmdbId: 1,
    seasonNumber: null,
    episodeNumber: null,
    label: 'Flixbaba Stream (Dynamic)',
    sourceUrl: wrapperUrl,
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
    isDynamic: true,
  }
  let extractionRequests = 0
  let wrapperRequests = 0
  let releaseFirstExtraction = () => {}
  let releaseEmbed = () => {}
  const firstExtractionPending = new Promise<void>((resolve) => {
    releaseFirstExtraction = resolve
  })
  const embedPending = new Promise<void>((resolve) => {
    releaseEmbed = resolve
  })

  await page.route('**/api/media-sources/movie/1', async (route) => {
    await route.fulfill({ json: { data: { sources: [dynamicSource] } } })
  })
  await page.route('**/api/media-sources/extract**', async (route) => {
    extractionRequests += 1
    if (extractionRequests === 1) {
      await firstExtractionPending
      return route.fulfill({ json: { data: { extractedUrl: null } } })
    }
    return route.fulfill({ json: { data: { extractedUrl: embedUrl } } })
  })
  await page.route('https://flixbaba.mov/**', async (route) => {
    wrapperRequests += 1
    await route.abort('blockedbyclient')
  })
  await page.route('https://player.example.test/**', async (route) => {
    await embedPending
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test player</title>' })
  })

  await page.goto('/movie/1')
  await expect(page.getByText('Start playback here, or use Theater mode for a larger view.')).toBeVisible()
  await expect(page.locator('#streaming-player iframe')).toHaveCount(0)
  expect(extractionRequests).toBe(0)
  expect(wrapperRequests).toBe(0)

  await page.getByRole('button', { name: 'Play movie' }).click()
  await expect(page.getByRole('status')).toContainText('Preparing player')
  await expect(page.locator('#streaming-player iframe')).toHaveCount(0)
  await expect.poll(() => extractionRequests).toBe(1)
  expect(wrapperRequests).toBe(0)

  releaseFirstExtraction()
  await expect(page.getByRole('alert')).toContainText('did not return a usable embedded player')
  await expect(page.locator('#streaming-player iframe')).toHaveCount(0)

  await page.getByRole('button', { name: 'Retry player' }).click()
  const iframe = page.locator('#streaming-player iframe')
  await expect(iframe).toHaveAttribute('src', embedUrl)
  await expect(iframe).not.toHaveAttribute('allowfullscreen', '')
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms')
  await expect(iframe).toHaveAttribute('allow', "autoplay; encrypted-media; picture-in-picture; fullscreen 'none'")
  await expect(page.getByRole('status')).toContainText('Loading player')
  expect(wrapperRequests).toBe(0)

  releaseEmbed()
  await expect(page.getByRole('status')).toHaveCount(0)

  const inlineBox = await iframe.boundingBox()
  expect(inlineBox?.width).toBeLessThan(1280)

  await page.getByRole('button', { name: 'Theater mode' }).click()
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeFocused()
  const theaterBox = await iframe.boundingBox()
  expect(theaterBox?.width).toBe(1280)
  expect(theaterBox?.height).toBe(720)

  await page.keyboard.press('Escape')
  await expect(iframe).toHaveCount(1)
  const restoredBox = await iframe.boundingBox()
  expect(restoredBox?.width).toBeLessThan(1280)
  await expect(page.getByRole('button', { name: 'Theater mode' })).toBeFocused()
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('hidden')

  await page.getByRole('button', { name: 'Stop player' }).click()
  await expect(iframe).toHaveCount(0)
  await expect(page.getByText('Start playback here, or use Theater mode for a larger view.')).toBeVisible()

  await page.getByRole('button', { name: 'Add to favourites' }).click()
  await expect(page.getByRole('button', { name: 'Remove favourite' })).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
})
