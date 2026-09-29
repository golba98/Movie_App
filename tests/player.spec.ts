import { expect, test } from '@playwright/test'
import { mockApi } from './support/mock-api'
import {
  fallbackSources,
  mockDynamicShow,
  mockTwoSourcePlayer,
  mockVsembedShow,
  openShowResumingAt,
  providerCommands,
  sendProviderEvent,
  watchFor,
} from './support/player'

test.beforeEach(async ({ page }) => {
  await mockApi(page)
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
  await expect(iframe).toHaveAttribute('allowfullscreen', '')
  // Providers refuse to run inside sandboxed frames, so the player must not add one.
  await expect(iframe).not.toHaveAttribute('sandbox')
  await expect(iframe).toHaveAttribute('referrerpolicy', 'origin')
  await expect(iframe).toHaveAttribute('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen')
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

test('player automatically falls back to the next available source if the first fails', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  
  const source1 = {
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
  }
  
  const source2 = {
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
  }

  const embedUrl = 'https://player.example.test/embed/movie/1'

  await page.route('**/api/media-sources/movie/1', async (route) => {
    await route.fulfill({ json: { data: { sources: [source1, source2] } } })
  })

  const extractionRequests: string[] = []
  await page.route('**/api/media-sources/extract**', async (route) => {
    const urlParam = new URL(route.request().url()).searchParams.get('url') ?? ''
    extractionRequests.push(urlParam)
    if (urlParam.includes('serverone')) {
      return route.fulfill({ json: { data: { extractedUrl: null } } })
    }
    return route.fulfill({ json: { data: { extractedUrl: embedUrl } } })
  })

  await page.route('https://player.example.test/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test player</title>' })
  })

  await page.goto('/movie/1')
  await expect(page.getByText('Start playback here, or use Theater mode for a larger view.')).toBeVisible()

  await page.getByRole('button', { name: 'Play movie' }).click()

  const iframe = page.locator('#streaming-player iframe')
  await expect(iframe).toHaveAttribute('src', embedUrl)
  
  const activeSourceButton = page.locator('#streaming-player button', { hasText: 'Server Two' })
  await expect(activeSourceButton).toHaveAttribute('aria-pressed', 'true')

  expect(extractionRequests).toEqual([
    'https://serverone.test/movie/1',
    'https://servertwo.test/movie/1'
  ])
})
test('a provider that refuses embedding fails only its own source and offers the other one', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const embedUrl = await mockTwoSourcePlayer(page, (route) => route.fulfill({
    json: { data: { extractedUrl: 'https://blocked-player.test/embed/movie/1', embedBlocked: 'x-frame-options' } },
  }))

  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Play movie' }).click()

  const iframe = page.locator('#streaming-player iframe')
  await expect(iframe).toHaveAttribute('src', embedUrl)
  await expect(page.locator('#streaming-player button', { hasText: 'Server Two' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#streaming-player').getByRole('alert')).toHaveCount(0)

  // Explicitly choosing an unavailable source also returns to the working source.
  await page.locator('#streaming-player button', { hasText: 'Server One' }).click()
  await page.getByRole('button', { name: 'Play movie' }).click()
  await expect(iframe).toHaveAttribute('src', embedUrl)
  await expect(page.locator('#streaming-player').getByRole('status').filter({ hasText: 'is unavailable. Trying' })).toContainText('Server One (Dynamic) is unavailable. Trying Server Two (Dynamic).')
  await expect(page.locator('#streaming-player').getByRole('alert')).toHaveCount(0)
})

test('an extractor error on one source does not break the other source', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const embedUrl = await mockTwoSourcePlayer(page, (route) => route.fulfill({
    status: 500,
    json: { error: { code: 'INTERNAL', message: 'Extractor exploded' } },
  }))

  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Play movie' }).click()

  const iframe = page.locator('#streaming-player iframe')
  await expect(iframe).toHaveAttribute('src', embedUrl)
  await expect(iframe).not.toHaveAttribute('sandbox')
  await expect(page.locator('#streaming-player button', { hasText: 'Server Two' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('#streaming-player').getByRole('alert')).toHaveCount(0)
})
test('a stuck embedded player can be reloaded without leaving the page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const embedUrl = 'https://player.example.test/embed/movie/1'
  let playerLoads = 0
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
    playerLoads += 1
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Test player</title>' })
  })

  await page.goto('/movie/1')
  await expect(page.getByRole('button', { name: 'Reload player' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Play movie' }).click()
  const player = page.locator('#streaming-player')
  await expect(player.getByRole('status')).toHaveCount(0)
  expect(playerLoads).toBe(1)

  await player.getByRole('button', { name: 'Reload player' }).click()
  await expect.poll(() => playerLoads).toBe(2)
  await expect(player.locator('iframe')).toHaveCount(1)
  await expect(player.getByRole('status')).toHaveCount(0)

  await player.getByRole('button', { name: 'Theater mode' }).click()
  await player.getByRole('button', { name: 'Reload player' }).click()
  await expect.poll(() => playerLoads).toBe(3)
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeVisible()
  await expect(player.getByRole('status')).toHaveCount(0)
})

test('@mobile all unavailable sources stop retrying and Retry requests fresh resolution', async ({ page }) => {
  await page.route('**/api/media-sources/movie/1', (route) => route.fulfill({ json: { data: { sources: fallbackSources } } }))
  const requests: URL[] = []
  let retrySucceeds = false
  await page.route('**/api/media-sources/extract**', async (route) => {
    requests.push(new URL(route.request().url()))
    if (retrySucceeds) return route.fulfill({ json: { data: { extractedUrl: 'https://player.test/embed', playbackKind: 'embed' } } })
    return route.fulfill({ status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'Unavailable' } } })
  })
  await page.route('https://player.test/embed', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Working player</title>' }))
  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Play movie' }).click()
  const player = page.locator('#streaming-player')
  await expect(player.getByRole('heading', { name: 'Player unavailable' })).toBeVisible()
  expect(requests).toHaveLength(2)
  await expect(player.locator('iframe')).toHaveCount(0)
  await expect(player.getByRole('alert')).toContainText('This provider is unavailable')
  retrySucceeds = true
  await player.getByRole('button', { name: 'Retry player' }).click()
  await expect(player.locator('iframe')).toHaveAttribute('src', 'https://player.test/embed')
  expect(requests).toHaveLength(3)
  expect(requests[2].searchParams.get('refresh')).toBe('1')
})

test('@mobile a resolved direct stream uses native video and survives Theater mode', async ({ page }) => {
  await page.route('**/api/media-sources/movie/1', (route) => route.fulfill({ json: { data: { sources: [fallbackSources[0]] } } }))
  const stream = 'https://cdn.test/demo.mp4'
  await page.route('**/api/media-sources/extract**', (route) => route.fulfill({ json: { data: { extractedUrl: stream, playbackKind: 'video' } } }))
  await page.route(stream, (route) => route.fulfill({ path: 'public/test-media/capture-test.mp4', contentType: 'video/mp4' }))
  await page.goto('/movie/1')
  await page.getByRole('button', { name: 'Play movie' }).click()
  const player = page.locator('#streaming-player')
  const video = player.locator('video')
  await expect(video).toHaveAttribute('src', stream)
  await expect(video).toHaveAttribute('playsinline', '')
  await expect(player.locator('iframe')).toHaveCount(0)
  await video.evaluate((element) => {
    const state = window as typeof window & { __resolvedVideo?: Element; __resolvedPauseCalls?: number }
    state.__resolvedVideo = element
    state.__resolvedPauseCalls = 0
    const target = element as HTMLVideoElement
    const pause = target.pause.bind(target)
    target.pause = () => {
      state.__resolvedPauseCalls = (state.__resolvedPauseCalls ?? 0) + 1
      pause()
    }
  })
  await player.getByRole('button', { name: 'Theater mode' }).click()
  expect(await video.evaluate((element) => element === (window as typeof window & { __resolvedVideo?: Element }).__resolvedVideo)).toBe(true)
  await player.getByRole('button', { name: 'Exit theater mode' }).click()
  await player.getByRole('button', { name: 'Stop player' }).click()
  await expect(video).toHaveCount(0)
  expect(await page.evaluate(() => (window as typeof window & { __resolvedPauseCalls?: number }).__resolvedPauseCalls)).toBe(1)
  await expect(player.getByRole('button', { name: 'Play movie' })).toBeVisible()
})

test('@mobile HLS resolution loads the playlist through the native video player', async ({ page }) => {
  await page.route('**/api/media-sources/movie/1', (route) => route.fulfill({ json: { data: { sources: [fallbackSources[0]] } } }))
  const stream = 'https://cdn.test/master.m3u8'
  await page.route('**/api/media-sources/extract**', (route) => route.fulfill({ json: { data: { extractedUrl: stream, playbackKind: 'hls' } } }))
  const playlists: string[] = []
  let releasePlaylist: (() => void) | undefined
  const pending = new Promise<void>((resolve) => { releasePlaylist = resolve })
  await page.route(stream, async (route) => {
    playlists.push(route.request().url())
    await pending
    await route.abort()
  })
  try {
    await page.goto('/movie/1')
    await page.getByRole('button', { name: 'Play movie' }).click()
    const player = page.locator('#streaming-player')
    await expect(player.locator('video')).toHaveCount(1)
    await expect(player.locator('iframe')).toHaveCount(0)
    await expect.poll(() => playlists.length).toBeGreaterThan(0)
    await player.getByRole('button', { name: 'Stop player' }).click()
    await expect(player.locator('video')).toHaveCount(0)
  } finally {
    releasePlaylist?.()
  }
})

test('the episode list opens scrolled to and highlighting the episode being resumed', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await mockDynamicShow(page)
  await openShowResumingAt(page, 1, 15)

  const player = page.locator('#streaming-player')
  await expect(player.getByRole('heading', { name: 'The Expanse — S1 E15' })).toBeVisible()
  const current = player.getByRole('button', { name: /Episode title 15\b/ })
  await expect(current).toHaveAttribute('aria-pressed', 'true')
  await expect(player.getByRole('button', { name: /Episode title 1\b/ })).toHaveAttribute('aria-pressed', 'false')

  // Only the list scrolls: the current episode sits inside its visible area.
  const list = page.getByTestId('episode-list')
  await expect.poll(async () => {
    const [listBox, itemBox] = await Promise.all([list.boundingBox(), current.boundingBox()])
    return Boolean(listBox && itemBox && itemBox.y >= listBox.y && itemBox.y + itemBox.height <= listBox.y + listBox.height)
  }).toBe(true)
  expect(await page.getByRole('heading', { name: 'The Expanse', exact: true }).evaluate((heading) => heading.closest('[data-lenis-prevent]')?.scrollTop)).toBe(0)
})

test('a finished episode offers the next one, which starts without another click', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const reported = await mockDynamicShow(page)
  await openShowResumingAt(page, 1, 15)

  const player = page.locator('#streaming-player')
  const watchNext = player.getByRole('button', { name: /^Watch next/ })
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.locator('iframe')).toHaveClass(/opacity-100/)
  await expect(player.getByRole('button', { name: 'Next episode' })).toBeVisible()
  await expect(watchNext).toHaveCount(0)

  // The provider reports the credits; the episode is now finished.
  reported.time = 950
  await player.getByRole('button', { name: 'Reload player' }).click()
  await expect(watchNext).toHaveText('Watch next · S1 E16 — Episode title 16')

  await watchNext.click()
  await expect(player.getByRole('heading', { name: 'The Expanse — S1 E16' })).toBeVisible()
  await expect(player.getByRole('button', { name: /Episode title 16\b/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(player.locator('iframe')).toHaveAttribute('src', 'https://player.example.test/embed/tv/10/1/16')
  await expect(player.getByText('Ready when you are')).toHaveCount(0)
  await expect(watchNext).toHaveCount(0)
})

test('the next episode continues into the next season, can be dismissed, and ends with the show', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const reported = await mockDynamicShow(page)
  reported.time = 950
  await openShowResumingAt(page, 1, 20)

  const player = page.locator('#streaming-player')
  const watchNext = player.getByRole('button', { name: /^Watch next/ })
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(watchNext).toHaveText('Watch next · S2 E1')
  await player.getByRole('button', { name: 'Dismiss next episode' }).click()
  await expect(watchNext).toHaveCount(0)

  // A rewatch of a finished episode doesn't prompt, but can still move on.
  await player.getByRole('button', { name: /Episode title 19\b/ }).click()
  await player.getByRole('button', { name: /Episode title 20\b/ }).click()
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.locator('iframe')).toHaveClass(/opacity-100/)
  await expect(watchNext).toHaveCount(0)

  await player.getByRole('button', { name: 'Next episode' }).click()
  await expect(player.getByRole('heading', { name: 'The Expanse — S2 E1' })).toBeVisible()
  await expect(player.locator('iframe')).toHaveAttribute('src', 'https://player.example.test/embed/tv/10/2/1')

  await player.getByRole('button', { name: 'Season 2' }).click()
  await player.getByRole('button', { name: 'Season 6' }).click()
  await player.getByRole('button', { name: /Episode title 20\b/ }).click()
  await expect(player.getByRole('heading', { name: 'The Expanse — S6 E20' })).toBeVisible()
  await expect(player.getByRole('button', { name: 'Next episode' })).toHaveCount(0)
})

test('the next episode prompt works in theater mode and keeps the theater open', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const reported = await mockDynamicShow(page)
  reported.time = 950
  await openShowResumingAt(page, 1, 15)

  await page.getByRole('button', { name: 'Resume S1 E15' }).click()
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeVisible()
  const watchNext = page.getByRole('button', { name: /^Watch next/ })
  await expect(watchNext).toBeVisible()
  await expect(watchNext).toBeInViewport()

  await watchNext.click()
  const player = page.locator('#streaming-player')
  await expect(player.locator('iframe')).toHaveAttribute('src', 'https://player.example.test/embed/tv/10/1/16')
  await expect(player.locator('iframe')).toHaveClass(/opacity-100/)
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeVisible()
  await expect(watchNext).toHaveCount(0)
})

test('Source 1 progress messages mark the final episode of a season watched and offer the next season', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  const reported = await mockDynamicShow(page)
  reported.format = 'vsembed'
  reported.time = 950
  await openShowResumingAt(page, 1, 20)

  const player = page.locator('#streaming-player')
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.getByRole('button', { name: /^Watch next/ })).toHaveText('Watch next · S2 E1')
  const lastEpisode = player.locator('[data-episode="20"]')
  await expect(lastEpisode.getByRole('button', { name: 'Mark as unwatched' })).toBeVisible()
})

test('@mobile Source 1 resumes an unfinished episode at its saved position', async ({ page }) => {
  await mockVsembedShow(page)
  await openShowResumingAt(page, 1, 15, { position: 400, duration: 1000 })

  const player = page.locator('#streaming-player')
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.locator('iframe')).toHaveAttribute('src', 'https://vsembed.ru/embed/tv?tmdb=10&season=1&episode=15&startAt=400')
})

// Source 1 falls over to another stream host mid-episode and that host starts
// at 0:00; the app sends it back to where the viewer was.
test('@mobile a provider restart mid-episode is sent back to where the viewer was and never overwrites progress', async ({ page }) => {
  await mockVsembedShow(page)
  await openShowResumingAt(page, 1, 15)

  const player = page.locator('#streaming-player')
  const iframe = player.locator('iframe')
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(iframe).toHaveClass(/opacity-100/)
  await sendProviderEvent(page, 'playing', 600)
  await sendProviderEvent(page, 'playing', 3)
  await expect.poll(() => providerCommands(page)).toContainEqual({ player: true, action: 'seek600' })

  // Playing again starts where the viewer was, not where the restart left off.
  await player.getByRole('button', { name: 'Stop player' }).click()
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(iframe).toHaveAttribute('src', /[?&]startAt=600$/)
})

test('@mobile a viewer seeking back in the provider player is not undone', async ({ page }) => {
  await mockVsembedShow(page)
  await openShowResumingAt(page, 1, 15)

  const player = page.locator('#streaming-player')
  const iframe = player.locator('iframe')
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(iframe).toHaveClass(/opacity-100/)
  await sendProviderEvent(page, 'playing', 600)
  // The browser reports the new time just before the seek completes.
  await sendProviderEvent(page, 'playing', 30)
  await sendProviderEvent(page, 'seeked', 30)
  await page.waitForTimeout(2_500)
  expect(await providerCommands(page)).toEqual([])

  await player.getByRole('button', { name: 'Stop player' }).click()
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(iframe).toHaveAttribute('src', /[?&]startAt=30$/)
})

test('@mobile an episode picked inside the provider player is neither recorded nor treated as a restart', async ({ page }) => {
  await mockVsembedShow(page)
  await openShowResumingAt(page, 1, 15)

  const player = page.locator('#streaming-player')
  const iframe = player.locator('iframe')
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(iframe).toHaveClass(/opacity-100/)
  await sendProviderEvent(page, 'playing', 600)
  await sendProviderEvent(page, 'playing', 5, { season: 1, episode: 16 })
  await page.waitForTimeout(2_500)
  expect(await providerCommands(page)).toEqual([])

  await player.getByRole('button', { name: 'Stop player' }).click()
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(iframe).toHaveAttribute('src', /[?&]startAt=600$/)
})

test('@mobile leaving theater mode keeps the provider player running inline', async ({ page }) => {
  await mockDynamicShow(page)
  await openShowResumingAt(page, 1, 15)

  await page.getByRole('button', { name: 'Resume S1 E15' }).click()
  const player = page.locator('#streaming-player')
  const iframe = player.locator('iframe')
  await expect(iframe).toHaveClass(/opacity-100/)
  await iframe.evaluate((element) => {
    (window as typeof window & { __theaterFrame?: Element }).__theaterFrame = element
  })

  await page.getByRole('button', { name: 'Exit theater mode' }).click()
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toHaveCount(0)
  await expect(player.getByText('Ready when you are')).toHaveCount(0)
  expect(await iframe.evaluate((element) => element === (window as typeof window & { __theaterFrame?: Element }).__theaterFrame)).toBe(true)
  await expect(player.getByRole('button', { name: 'Stop player' })).toBeVisible()
})

test('@mobile the Watch next prompt sits on the right, clear of the subtitles and the player buttons', async ({ page }) => {
  const reported = await mockDynamicShow(page)
  reported.time = 950
  await openShowResumingAt(page, 1, 15)

  const player = page.locator('#streaming-player')
  const shell = page.getByTestId('player-shell')
  const prompt = player.getByRole('button', { name: /^Watch next/ }).locator('..')
  // Right-aligned and in the upper half, above the provider's subtitles and controls.
  const expectClearOfSubtitles = async () => {
    const [promptBox, shellBox] = await Promise.all([prompt.boundingBox(), shell.boundingBox()])
    expect(promptBox).not.toBeNull()
    expect(shellBox).not.toBeNull()
    expect(shellBox!.x + shellBox!.width - (promptBox!.x + promptBox!.width)).toBeLessThanOrEqual(24)
    expect(promptBox!.y + promptBox!.height - shellBox!.y).toBeLessThanOrEqual(shellBox!.height / 2)
  }

  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(prompt).toBeVisible()
  await expectClearOfSubtitles()

  await player.getByRole('button', { name: 'Theater mode' }).click()
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeVisible()
  await expectClearOfSubtitles()
  const promptBox = (await prompt.boundingBox())!
  for (const name of ['Exit theater mode', 'Reload player']) {
    const box = (await page.getByRole('button', { name }).boundingBox())!
    const overlaps = promptBox.x < box.x + box.width && box.x < promptBox.x + promptBox.width
      && promptBox.y < box.y + box.height && box.y < promptBox.y + promptBox.height
    expect(overlaps, `Watch next overlaps ${name}`).toBe(false)
  }
})

test('going Back while theater mode is open leaves the page scrollable', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'View details for Dune: Part Two' }).first().click()
  await page.getByRole('button', { name: 'Watch Movie' }).click()
  await expect(page.getByRole('button', { name: 'Exit theater mode' })).toBeVisible()

  await page.goBack()
  await expect(page.getByRole('button', { name: 'Close details' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('')
  await page.mouse.move(640, 360)
  await page.mouse.wheel(0, 600)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
})

// Watch time also counts paused time and replays, so a player that reports its
// own position must not be finished by watch time before it reports.
test('an episode whose player has reported before is not finished by watch time alone', async ({ page }) => {
  await mockVsembedShow(page)
  await page.clock.install()
  await openShowResumingAt(page, 1, 15, { position: 100, duration: 1000, watchSeconds: 950 })

  const player = page.locator('#streaming-player')
  await player.getByRole('button', { name: 'Play episode' }).click()
  await expect(player.locator('iframe')).toHaveClass(/opacity-100/)
  // Source 1 is still showing its own Play button, so it hasn't reported yet.
  await watchFor(page, 15_000)
  await page.waitForTimeout(500)

  await expect(player.locator('[data-episode="15"]').getByRole('button', { name: 'Mark as watched' })).toBeVisible()
  await expect(player.getByRole('button', { name: /^Watch next/ })).toHaveCount(0)
})
