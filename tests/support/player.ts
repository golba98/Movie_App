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

type EmbedUrl = (season: string | undefined, episode: string | null) => string

const exampleEmbedUrl: EmbedUrl = (season, episode) => `https://player.example.test/embed/tv/10/${season}/${episode}`

/**
 * Serves The Expanse (6 seasons of 20 episodes) through one dynamic provider
 * whose embed reports `reported.time` of a 1000-second episode when it loads,
 * in the message shape `reported.format` uses.
 */
export async function mockDynamicShow(page: Page, embedUrl: EmbedUrl = exampleEmbedUrl) {
  const reported: { time: number; format: 'timeupdate' | 'vsembed' } = { time: 100, format: 'timeupdate' }
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
      runtime: 17,
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
    await route.fulfill({ json: { data: { extractedUrl: embedUrl(season, episode) } } })
  })
  await page.route('https://player.example.test/**', async (route) => {
    // vsembed (Source 1) posts an object with its own field names.
    const message = reported.format === 'vsembed'
      ? JSON.stringify({ type: 'PLAYER_EVENT', data: { player_status: 'playing', player_progress: reported.time, player_duration: 1000 } })
      : JSON.stringify(JSON.stringify({ type: 'PLAYER_EVENT', data: { event: 'timeupdate', currentTime: reported.time, duration: 1000 } }))
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<!doctype html><title>Test player</title><script>parent.postMessage(${message}, '*')</script>`,
    })
  })
  return reported
}

const VSEMBED_FRAME = /^https:\/\/vsembed\.ru\//

/**
 * Serves The Expanse through Source 1's embed host, vsembed. The stub player
 * records every message the app sends it in `window.__commands`; tests post
 * the provider's own events from inside it with `sendProviderEvent`.
 */
export async function mockVsembedShow(page: Page) {
  await mockDynamicShow(page, (season, episode) => `https://vsembed.ru/embed/tv?tmdb=10&season=${season}&episode=${episode}`)
  await page.route('https://vsembed.ru/**', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><title>Source 1 player</title><script>
      window.__commands = []
      addEventListener('message', (event) => { if (event.source === parent) window.__commands.push(event.data) })
    </script>`,
  }))
}

function vsembedFrame(page: Page) {
  const frame = page.frame({ url: VSEMBED_FRAME })
  if (!frame) throw new Error('The Source 1 player frame is not loaded.')
  return frame
}

/** Posts a vsembed PLAYER_EVENT for a 1000-second episode, as its player does. */
export async function sendProviderEvent(
  page: Page,
  status: 'playing' | 'paused' | 'seeked',
  progress: number,
  episode: { season: number; episode: number } = { season: 1, episode: 15 },
) {
  await vsembedFrame(page).evaluate(({ status, progress, episode }) => {
    parent.postMessage({
      type: 'PLAYER_EVENT',
      data: {
        player_info: { tmdb: '10', mediaType: 'tv', ...episode },
        player_status: status,
        player_progress: progress,
        player_duration: 1000,
      },
    }, '*')
  }, { status, progress, episode })
}

/** The messages the app has sent the Source 1 player. */
export function providerCommands(page: Page) {
  return vsembedFrame(page).evaluate(() => (window as typeof window & { __commands: unknown[] }).__commands)
}

/** Records an unfinished episode in the account's history and opens the show there. */
export async function openShowResumingAt(
  page: Page,
  seasonNumber: number,
  episodeNumber: number,
  saved: { position?: number; duration?: number; watchSeconds?: number } | null = null,
) {
  const now = Date.now()
  watchServer.entries.set(`tv:10:${seasonNumber}:${episodeNumber}`, { watched: false, watchSeconds: 600, updatedAt: now, ...saved })
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
