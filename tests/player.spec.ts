import { expect, test } from '@playwright/test'
import { mockApi } from './support/mock-api'
import { mockTwoSourcePlayer } from './support/player'

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
  await expect(activeSourceButton).toHaveClass(/bg-emerald-500/)

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
  await expect(page.locator('#streaming-player button', { hasText: 'Server Two' })).toHaveClass(/bg-emerald-500/)
  await expect(page.locator('#streaming-player').getByRole('alert')).toHaveCount(0)

  // Choosing the refused source explicitly shows that source's own error.
  await page.locator('#streaming-player button', { hasText: 'Server One' }).click()
  await page.getByRole('button', { name: 'Play movie' }).click()
  const alert = page.locator('#streaming-player').getByRole('alert')
  await expect(alert).toContainText("This provider doesn't allow its player to be embedded here")
  await expect(iframe).toHaveCount(0)

  await alert.getByRole('button', { name: 'Try Server Two (Dynamic)' }).click()
  await expect(iframe).toHaveAttribute('src', embedUrl)
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
  await expect(page.locator('#streaming-player button', { hasText: 'Server Two' })).toHaveClass(/bg-emerald-500/)
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
