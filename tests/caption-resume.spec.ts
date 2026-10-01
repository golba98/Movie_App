import { expect, test } from '@playwright/test'
import { mockApi, watchServer } from './support/mock-api'
import { mockCaptionPlayer } from './support/caption-player'
import { mockVsembedShow, openShowResumingAt, providerCommands, sendProviderEvent } from './support/player'

const backupSource = {
  id: 'backup-source', mediaType: 'tv' as const, tmdbId: 10, seasonNumber: null, episodeNumber: null,
  label: 'Soap2Day Stream (Dynamic)', sourceUrl: 'https://backup.test/tv/10/the-expanse',
  mimeType: 'video/mp4' as const, rightsBasis: 'licensed' as const, isDynamic: true,
}

test.beforeEach(async ({ page }) => { await mockApi(page) })

test('resume renders the cue at the real 780-second media position after refresh', async ({ page }) => {
  await mockCaptionPlayer(page, { trackDelay: 350 })
  await openShowResumingAt(page, 1, 15, { position: 780.4, duration: 1000 })
  const player = page.locator('#streaming-player')
  await player.getByRole('button', { name: 'Play episode' }).click()
  const frame = page.frameLocator('iframe')
  await expect.poll(() => frame.locator('video').evaluate((video: HTMLVideoElement) => ({
    time: video.currentTime, duration: video.duration, seeking: video.seeking, ready: video.readyState,
  }))).toMatchObject({ time: 780, duration: 1000, seeking: false })
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('dialogue B')
  expect(await page.frame({ url: /vsembed/ })!.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(780, 0)
  await expect.poll(() => providerCommands(page)).toEqual([{ player: true, action: 'seek780' }])
  await frame.getByRole('button', { name: 'Seek to dialogue C' }).click()
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('dialogue C')
  await frame.getByRole('button', { name: 'Seek to intro' }).click()
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('intro')
  // Restore the original point through a real seek, then close without relying on unload.
  await page.frame({ url: /vsembed/ })!.locator('video').evaluate((video: HTMLVideoElement) => { video.currentTime = 780 })
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('dialogue B')
  await page.waitForTimeout(100)
  await page.reload()
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('dialogue B')
})

test('a new browser context restores persisted progress and source with synchronized captions', async ({ page, browser }) => {
  await mockCaptionPlayer(page)
  await openShowResumingAt(page, 1, 15, { position: 780, duration: 1000 })
  await page.getByRole('button', { name: 'Play episode' }).click()
  await expect(page.frameLocator('iframe').getByRole('status', { name: 'Active caption' })).toHaveText('dialogue B')
  const storageState = await page.context().storageState()
  await page.close()
  const context = await browser.newContext({ storageState })
  try {
    const fresh = await context.newPage()
    await mockApi(fresh)
    await mockCaptionPlayer(fresh)
    await fresh.goto('/tv/10')
    await fresh.getByRole('button', { name: 'Play episode' }).click()
    await expect(fresh.frameLocator('iframe').getByRole('status', { name: 'Active caption' })).toHaveText('dialogue B')
  } finally { await context.close() }
})

test('ignored resume commands preserve history, stop after two attempts, and allow a viewer seek', async ({ page }) => {
  await mockVsembedShow(page)
  await openShowResumingAt(page, 1, 15, { position: 780, duration: 1000 })
  await page.clock.install()
  await page.getByRole('button', { name: 'Play episode' }).click()
  await expect(page.locator('iframe')).toHaveClass(/opacity-100/)
  await sendProviderEvent(page, 'playing', 0)
  await expect.poll(() => providerCommands(page)).toEqual([{ player: true, action: 'seek780' }])
  await page.clock.runFor(10_100)
  await expect(page.getByRole('alert')).toContainText('Your saved position is safe')
  expect(await providerCommands(page)).toHaveLength(2)
  expect(watchServer.entries.get('tv:10:1:15')?.position).toBe(780)
  await sendProviderEvent(page, 'playing', 2)
  await page.clock.runFor(10_000)
  expect(await providerCommands(page)).toHaveLength(2)
  expect(watchServer.entries.get('tv:10:1:15')?.position).toBe(780)
  await sendProviderEvent(page, 'seeked', 30)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('movies with null episode fields resume their actual caption timeline', async ({ page }) => {
  await mockCaptionPlayer(page, { movie: true })
  watchServer.entries.set('movie:1', { watched: false, position: 780, duration: 1000, watchSeconds: 600, updatedAt: Date.now() })
  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Watch Movie' }).click()
  await expect(page.frameLocator('iframe').getByRole('status', { name: 'Active caption' })).toHaveText('dialogue B')
})

test('new viewers start with intro captions and can turn captions off/on', async ({ page }) => {
  await mockCaptionPlayer(page)
  await page.goto('/tv/10')
  await page.getByRole('button', { name: 'Play episode' }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('intro')
  expect(await providerCommands(page)).toHaveLength(0)
  await frame.getByRole('button', { name: 'Toggle captions' }).click()
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('')
  await frame.getByRole('button', { name: 'Toggle captions' }).click()
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('intro')
})

test('switching a provider-owned caption track evaluates its cues at the resumed position', async ({ page }) => {
  await mockCaptionPlayer(page)
  await openShowResumingAt(page, 1, 15, { position: 780, duration: 1000 })
  await page.getByRole('button', { name: 'Play episode' }).click()
  const frame = page.frameLocator('iframe')
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('dialogue B')
  await frame.getByRole('button', { name: 'Switch English track' }).click()
  await expect(frame.getByRole('status', { name: 'Active caption' })).toHaveText('alternative dialogue B')
})

test('the saved source is restored and an unavailable saved provider falls back safely', async ({ page }) => {
  await mockVsembedShow(page, { additionalSources: [backupSource] })
  await openShowResumingAt(page, 1, 15, { position: 780, duration: 1000 })
  const player = page.locator('#streaming-player')
  await player.getByRole('button', { name: 'Source 2', exact: true }).click()
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.locator('iframe')).toHaveClass(/opacity-100/)
  await page.reload()
  await expect(player.getByRole('button', { name: 'Source 2', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.route('**/api/media-sources/extract**', (route) => {
    if (new URL(route.request().url()).searchParams.get('url')?.includes('backup.test')) {
      return route.fulfill({ status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Unavailable' } } })
    }
    return route.fallback()
  })
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.getByRole('button', { name: 'Source 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(player.locator('iframe')).toHaveAttribute('src', /startAt=780/)
  await expect(player.getByRole('status').filter({ hasText: 'Source 2 is unavailable' })).toBeVisible()
})

for (const [name, state] of [
  ['malformed', '{bad JSON'],
  ['unknown version', JSON.stringify({ version: 99, sourceId: 'backup-source' })],
  ['invalid duration', JSON.stringify({ version: 1, sourceId: 'backup-source', sourceFingerprint: 'abc', duration: '780', updatedAt: Date.now() })],
  ['stale', JSON.stringify({ version: 1, sourceId: 'backup-source', sourceFingerprint: 'abc', updatedAt: 0 })],
]) {
  test(`${name} viewing state falls back without breaking saved progress`, async ({ page }) => {
    await mockVsembedShow(page, { additionalSources: [backupSource] })
    await page.addInitScript((state) => {
      localStorage.setItem('fedora-movies:viewing-session:v1:viewer-test-id:tv:10:1:15', state)
    }, state)
    await openShowResumingAt(page, 1, 15, { position: 780, duration: 1000 })
    const player = page.locator('#streaming-player')
    await expect(player.getByRole('button', { name: 'Source 1', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await player.getByRole('button', { name: 'Play episode' }).click()
    await expect(player.locator('iframe')).toHaveAttribute('src', /startAt=780/)
  })
}

test('an actual video runtime mismatch reselects captions once without losing progress', async ({ page }) => {
  await mockVsembedShow(page)
  const extractionRequests: URL[] = []
  await page.route('**/api/media-sources/extract**', (route) => {
    const url = new URL(route.request().url())
    extractionRequests.push(url)
    const corrected = url.searchParams.has('duration')
    return route.fulfill({ json: { data: {
      extractedUrl: `https://vsembed.ru/embed/tv?tmdb=10&season=1&episode=15&sub_url=https%3A%2F%2Ffedora.test%2F${corrected ? 'combined' : 'segment'}.vtt`,
      subtitles: { id: corrected ? 'combined' : 'segment', language: 'en', provider: 'opensubtitles',
        releaseFingerprint: 'a'.repeat(64), lastCueSeconds: corrected ? 1416 : 597,
        runtimeSeconds: corrected ? 1473 : 660, confidence: 'heuristic' },
      subtitleContext: { releaseFingerprint: 'a'.repeat(64), runtimeSeconds: corrected ? 1473 : 660 },
    } } })
  })
  await openShowResumingAt(page, 1, 15, { position: 780, duration: 1473 })
  const iframe = page.locator('iframe')
  await page.getByRole('button', { name: 'Play episode' }).click()
  await expect(iframe).toHaveClass(/opacity-100/)
  const report = async (status: string, position: number) => {
    await page.frame({ url: /vsembed/ })!.evaluate(({ status, position }) => {
      parent.postMessage({ type: 'PLAYER_EVENT', data: { player_status: status, player_progress: position,
        player_duration: 1473, player_info: { tmdb: 10, mediaType: 'tv', season: 1, episode: 15 } } }, '*')
    }, { status, position })
  }
  await report('playing', 780)
  await expect.poll(() => providerCommands(page)).toHaveLength(1)
  await report('seeked', 780)
  await expect(iframe).toHaveAttribute('src', /combined\.vtt&startAt=780/)
  expect(extractionRequests).toHaveLength(2)
  expect(extractionRequests[1].searchParams.get('duration')).toBe('1473')
  expect(extractionRequests[1].searchParams.get('release')).toBe('a'.repeat(64))
  await expect(iframe).toHaveClass(/opacity-100/)
  await report('playing', 780)
  await report('seeked', 780)
  await report('playing', 781)
  expect(extractionRequests).toHaveLength(2)
  expect(watchServer.entries.get('tv:10:1:15')?.position).toBe(780)
})

test('a custom subtitle is re-extracted when the provider changes episode inside its frame', async ({ page }) => {
  await mockVsembedShow(page, { subtitle: true })
  await openShowResumingAt(page, 1, 15)
  const player = page.locator('#streaming-player')
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.locator('iframe')).toHaveClass(/opacity-100/)
  await sendProviderEvent(page, 'playing', 600)
  await sendProviderEvent(page, 'playing', 5, { season: 1, episode: 16 })
  await expect(player.getByRole('heading', { name: 'The Expanse — S1 E16' })).toBeVisible()
  await expect(player.locator('iframe')).toHaveAttribute('src', /season=1&episode=16&sub_url=/)
})
