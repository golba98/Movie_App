import { expect, type Page, type Route } from '@playwright/test'
import { movie, detailsExtras } from './fixtures'
import { watchServer } from './mock-api'

export const fallbackSources = [
  {
    id: 'server-one',
    mediaType: 'movie',
    tmdbId: 1,
    seasonNumber: null,
    episodeNumber: null,
    label: 'Server One (Dynamic)',
    sourceUrl: 'https://serverone.test/movie/1',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
    isDynamic: true,
  },
  {
    id: 'server-two',
    mediaType: 'movie',
    tmdbId: 1,
    seasonNumber: null,
    episodeNumber: null,
    label: 'Server Two (Dynamic)',
    sourceUrl: 'https://servertwo.test/movie/1',
    mimeType: 'video/mp4',
    rightsBasis: 'licensed',
    isDynamic: true,
  },
]

export async function mockTwoSourcePlayer(page: Page, failFirstSource: (route: Route) => Promise<void>) {
  const embedUrl = 'https://player.example.test/embed/movie/1'
  await page.route('**/api/media-sources/movie/1', async (route) => {
    await route.fulfill({ json: { data: { sources: fallbackSources } } })
  })
  await page.route('**/api/media-sources/extract**', async (route) => {
    const urlParam = new URL(route.request().url()).searchParams.get('url') ?? ''
    if (urlParam.includes('serverone')) return failFirstSource(route)
    return route.fulfill({ json: { data: { extractedUrl: embedUrl, embedBlocked: null } } })
  })
  await page.route('https://player.example.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test player</title>' })
  })
  return embedUrl
}

export async function watchFor(page: Page, ms: number) {
  for (let elapsed = 0; elapsed < ms; elapsed += 15_000) await page.clock.fastForward(Math.min(15_000, ms - elapsed))
}

export async function setPageVisibility(page: Page, state: 'visible' | 'hidden') {
  await page.evaluate((value) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => value === 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, state)
}

export async function useSilentDynamicMovie(page: Page, runtimeMinutes: number) {
  const embedUrl = 'https://player.example.test/embed/movie/1'
  await page.route('**/api/media-sources/movie/1', (route) => route.fulfill({
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
  }))
  await page.route('**/api/media-sources/extract**', (route) => route.fulfill({ json: { data: { extractedUrl: embedUrl } } }))
  // Like most providers, this player never reports its position.
  await page.route('https://player.example.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Silent player</title>' }))
  await page.route(
    (url) => url.pathname === '/api/tmdb/movie/1',
    (route) => route.fulfill({ json: { ...movie, runtime: runtimeMinutes, ...detailsExtras } }),
  )
}

const SHOW_SEASON_EPISODES = 20

/**
 * Serves The Expanse (6 seasons of 20 episodes) through one dynamic provider
 * whose embed reports `reported.time` of a 1000-second episode when it loads.
 */
export async function mockDynamicShow(page: Page) {
  const reported = { time: 100 }
  await page.route('**/api/tmdb/tv/10/season/*', async (route) => {
    const seasonNumber = Number(new URL(route.request().url()).pathname.split('/').pop())
    const episodes = Array.from({ length: SHOW_SEASON_EPISODES }, (_, index) => ({
      id: seasonNumber * 1000 + index,
      name: `Episode title ${index + 1}`,
      overview: 'An episode of the long running season.',
      episode_number: index + 1,
      season_number: seasonNumber,
      still_path: null,
      air_date: '2015-12-14',
    }))
    await route.fulfill({ json: { id: 100 + seasonNumber, season_number: seasonNumber, episodes } })
  })
  await page.route('**/api/media-sources/tv/10', async (route) => {
    await route.fulfill({
      json: {
        data: {
          sources: [{
            id: 'flixbaba-default',
            mediaType: 'tv',
            tmdbId: 10,
            seasonNumber: null,
            episodeNumber: null,
            label: 'Flixbaba Stream (Dynamic)',
            sourceUrl: 'https://flixbaba.mov/tv/10/the-expanse',
            mimeType: 'video/mp4',
            rightsBasis: 'licensed',
            isDynamic: true,
          }],
        },
      },
    })
  })
  await page.route('**/api/media-sources/extract**', async (route) => {
    const wrapper = new URL(new URL(route.request().url()).searchParams.get('url') ?? '')
    const [season, episode] = [wrapper.pathname.split('/').pop(), wrapper.searchParams.get('e')]
    await route.fulfill({ json: { data: { extractedUrl: `https://player.example.test/embed/tv/10/${season}/${episode}` } } })
  })
  await page.route('https://player.example.test/**', async (route) => {
    const message = JSON.stringify({ type: 'PLAYER_EVENT', data: { event: 'timeupdate', currentTime: reported.time, duration: 1000 } })
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><title>Test player</title><script>parent.postMessage(${message}, '*')</script>`,
    })
  })
  return reported
}

/** Records an unfinished episode in the account's history and opens the show there. */
export async function openShowResumingAt(page: Page, seasonNumber: number, episodeNumber: number) {
  const now = Date.now()
  watchServer.entries.set(`tv:10:${seasonNumber}:${episodeNumber}`, { watched: false, watchSeconds: 600, updatedAt: now })
  watchServer.titles.set('tv:10', {
    mediaType: 'tv',
    id: 10,
    seasonNumber,
    episodeNumber,
    item: { id: 10, mediaType: 'tv', title: 'The Expanse', overview: '', posterPath: '/expanse.jpg', backdropPath: null, voteAverage: 8.1, date: null, year: null },
    updatedAt: now,
  })
  await page.goto('/')
  await expect(page.locator('#continue-watching').locator('article', { hasText: 'The Expanse' })).toBeVisible()
  await page.goto('/tv/10')
}
