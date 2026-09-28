import type { Page } from '@playwright/test'
import { movie, movieTwo, tvShow, tvSeasonOne, paginated, detailsExtras, authorisedMediaSources } from './fixtures'

interface SyncedEntry {
  watched: boolean
  position?: number
  duration?: number
  watchSeconds?: number
  updatedAt: number
}

interface SyncedTitle {
  mediaType: 'movie' | 'tv'
  id: number
  seasonNumber: number | null
  episodeNumber: number | null
  item?: Record<string, unknown>
  removed?: boolean
  updatedAt: number
}

// Stands in for the account's history on the server, shared by every device.
// Reset in place for each test, so specs can import it and read it directly.
export const watchServer = {
  entries: new Map<string, SyncedEntry>(),
  titles: new Map<string, SyncedTitle>(),
  syncs: [] as { entries: ({ key: string } & SyncedEntry)[]; titles: ({ key: string } & SyncedTitle)[] }[],
}

/**
 * Mocks every API the app calls — auth, admin, favourites, media sources,
 * search providers, watch history and the TMDB proxy — plus TMDB images.
 */
export async function mockApi(page: Page) {
  let favourites: Record<string, unknown>[] = []
  watchServer.entries.clear()
  watchServer.titles.clear()
  watchServer.syncs.length = 0
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
      movieEmbedPattern: '',
      tvEmbedPattern: '',
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
  await page.route('**/api/watch-history', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      return route.fulfill({
        json: { data: { entries: Object.fromEntries(watchServer.entries), titles: Object.fromEntries(watchServer.titles) } },
      })
    }
    const body = request.postDataJSON() as {
      entries: ({ key: string } & SyncedEntry)[]
      titles: ({ key: string } & SyncedTitle)[]
    }
    watchServer.syncs.push(body)
    for (const { key, ...entry } of body.entries) {
      const current = watchServer.entries.get(key)
      if (!current || entry.updatedAt > current.updatedAt) watchServer.entries.set(key, entry)
    }
    for (const { key, ...title } of body.titles) {
      const current = watchServer.titles.get(key)
      if (!current || title.updatedAt > current.updatedAt) watchServer.titles.set(key, { ...title, item: title.item ?? current?.item })
    }
    return route.fulfill({ json: { data: { synced: body.entries.length + body.titles.length } } })
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
    const deleteMatch = path.match(/^\/api\/admin\/accounts\/([^/]+)$/)
    if (deleteMatch && request.method() === 'DELETE') {
      const index = accounts.findIndex((account) => account.id === deleteMatch[1])
      if (index === -1) return route.fulfill({ status: 404, json: { error: { message: 'Account not found.' } } })
      accounts.splice(index, 1)
      return route.fulfill({ json: { data: { deleted: true } } })
    }
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
