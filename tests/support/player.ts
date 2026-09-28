import type { Page, Route } from '@playwright/test'
import { movie, detailsExtras } from './fixtures'

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
