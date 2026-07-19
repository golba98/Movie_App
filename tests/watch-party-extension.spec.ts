import { expect, test } from '@playwright/test'

const roomId = 'room-extension-test-1234'
const memberId = 'account:host-extension-test'

const state = {
  roomId,
  roomCode: 'EXT12345',
  roomName: 'Extension companion room',
  media: {
    sourceId: 'owned-movie',
    mediaType: 'movie',
    tmdbId: 1,
    seasonNumber: null,
    episodeNumber: null,
    title: 'Owned demonstration movie',
    posterPath: null,
    backdropPath: null,
  },
  settings: {
    privacy: 'public',
    maxParticipants: 8,
    controlMode: 'host_only',
    allowLateJoin: true,
    allowMediaChange: false,
    readyUpEnabled: false,
    startWhenEveryoneReady: false,
    pauseForBuffering: false,
    locked: false,
    expiresAt: null,
  },
  playbackState: 'paused',
  positionMs: 0,
  playbackRate: 1,
  stateUpdatedAt: 1_700_000_000_000,
  revision: 0,
  hostId: memberId,
  participants: [{
    id: memberId,
    displayName: 'Host viewer',
    role: 'host',
    canControl: true,
    ready: false,
    buffering: false,
    connectionStatus: 'connected',
    syncStatus: 'synchronized',
    joinedAt: 1_700_000_000_000,
  }],
  activity: [],
  serverNow: 1_700_000_000_000,
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ room, member }) => {
    sessionStorage.setItem(`fedora:watch-party:${room}`, JSON.stringify({ accessToken: 'room-access-token', memberId: member }))
    const bridgeMessages: unknown[] = []
    ;(window as typeof window & { __bridgeMessages?: unknown[] }).__bridgeMessages = bridgeMessages
    window.addEventListener('message', (event) => bridgeMessages.push(event.data))

    class MockWebSocket extends EventTarget {
      static readonly OPEN = 1
      readyState = MockWebSocket.OPEN
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null

      constructor() {
        super()
        queueMicrotask(() => this.onopen?.(new Event('open')))
      }

      send(payload: string) {
        const event = JSON.parse(payload) as { type?: string; eventId?: string }
        if (event.type === 'room:sync-request') {
          queueMicrotask(() => this.onmessage?.(new MessageEvent('message', {
            data: JSON.stringify({ type: 'playback:sync', eventId: event.eventId, state: (window as typeof window & { __roomState?: unknown }).__roomState }),
          })))
        }
      }

      close() {
        this.readyState = 3
      }
    }
    ;(window as typeof window & { WebSocket: typeof WebSocket }).WebSocket = MockWebSocket as unknown as typeof WebSocket
  }, { room: roomId, member: memberId })
  await page.addInitScript((roomState) => {
    ;(window as typeof window & { __roomState?: unknown }).__roomState = roomState
  }, state)

  let tokenCount = 0
  await page.route(`**/api/watch-party/rooms/${roomId}/state`, (route) => route.fulfill({ json: { data: { state } } }))
  await page.route(`**/api/watch-party/rooms/${roomId}/media`, (route) => route.fulfill({ json: { data: { source: {
    id: 'owned-movie', sourceUrl: '/test-media/capture-test.mp4', mimeType: 'video/mp4', extractedUrl: null,
    playbackUrl: '/test-media/capture-test.mp4', playbackKind: 'video',
  } } } }))
  await page.route(`**/api/watch-party/rooms/${roomId}/extension-token`, async (route) => {
    tokenCount += 1
    const body = route.request().postDataJSON() as { nonce: string; clientSessionId: string; capabilityVersion: number }
    expect(route.request().headers().authorization).toBe('Bearer room-access-token')
    expect(body).toMatchObject({ capabilityVersion: 1 })
    await route.fulfill({ json: { data: { extensionToken: `signed-extension-token-${tokenCount}-${'x'.repeat(32)}`, expiresAt: Date.now() + 120_000, capabilityVersion: 1 } } })
  })
})

test('detects a companion that announced before the room mounted via website:hello ping', async ({ page }) => {
  await page.addInitScript(() => {
    const identity = { nonce: 'early-nonce-identifier-1234', clientSessionId: 'early-session-identifier-1234' }
    const announce = () => {
      window.postMessage({
        source: 'fedora-movies-watch-sync-extension',
        type: 'extension:hello',
        protocolVersion: 1,
        ...identity,
      }, window.location.origin)
    }
    announce()
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as { source?: string; type?: string; protocolVersion?: number } | null
      if (data && data.source === 'fedora-movies-watch-party' && data.type === 'website:hello' && data.protocolVersion === 1) announce()
    })
  })

  await page.goto(`/watch-party/${roomId}`)
  await expect(page.getByText('Companion extension detected and ready to connect.')).toBeVisible()

  await page.getByRole('button', { name: 'Connect browser extension' }).click()
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __bridgeMessages?: { type?: string; nonce?: string; extensionToken?: string }[] }).__bridgeMessages?.some((message) => message.type === 'website:connect' && message.nonce === 'early-nonce-identifier-1234' && Boolean(message.extensionToken)))).toBe(true)
})

test('uses a strict room bridge and unmounts duplicate playback in companion mode', async ({ page }) => {
  await page.goto(`/watch-party/${roomId}`)
  await expect(page.locator('video')).toHaveCount(1)

  await page.evaluate(() => {
    window.dispatchEvent(new MessageEvent('message', {
      source: window,
      origin: 'https://attacker.test',
      data: {
        source: 'fedora-movies-watch-sync-extension',
        type: 'extension:hello',
        protocolVersion: 1,
        nonce: 'attacker-nonce-1234',
        clientSessionId: 'attacker-session-1234',
      },
    }))
  })
  await expect(page.getByText('Companion extension detected and ready to connect.')).toHaveCount(0)

  const nonce = 'trusted-nonce-identifier-1234'
  const clientSessionId = 'trusted-session-identifier-1234'
  await page.evaluate(({ nonceValue, sessionValue }) => {
    window.postMessage({
      source: 'fedora-movies-watch-sync-extension',
      type: 'extension:hello',
      protocolVersion: 1,
      nonce: nonceValue,
      clientSessionId: sessionValue,
    }, window.location.origin)
  }, { nonceValue: nonce, sessionValue: clientSessionId })
  await expect(page.getByText('Companion extension detected and ready to connect.')).toBeVisible()
  await page.getByRole('button', { name: 'Connect browser extension' }).click()

  await expect.poll(() => page.evaluate(() => (window as typeof window & { __bridgeMessages?: { type?: string; extensionToken?: string }[] }).__bridgeMessages?.some((message) => message.type === 'website:connect' && Boolean(message.extensionToken)))).toBe(true)
  await page.evaluate((sessionValue) => {
    window.postMessage({
      source: 'fedora-movies-watch-sync-extension',
      type: 'extension:status',
      protocolVersion: 1,
      clientSessionId: sessionValue,
      status: 'connected',
      message: 'Companion connected.',
    }, window.location.origin)
  }, clientSessionId)
  await expect(page.getByRole('heading', { name: 'Companion playback is active' })).toBeVisible()
  await expect(page.locator('video, iframe')).toHaveCount(0)

  await page.evaluate(({ nonceValue, sessionValue }) => {
    window.postMessage({
      source: 'fedora-movies-watch-sync-extension',
      type: 'extension:token-request',
      protocolVersion: 1,
      nonce: `${nonceValue}-refresh`,
      clientSessionId: sessionValue,
    }, window.location.origin)
  }, { nonceValue: nonce, sessionValue: clientSessionId })
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __bridgeMessages?: { type?: string; extensionToken?: string }[] }).__bridgeMessages?.some((message) => message.type === 'website:token' && Boolean(message.extensionToken)))).toBe(true)

  await page.getByRole('button', { name: 'Use in-app player' }).click()
  await expect(page.locator('video')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => (window as typeof window & { __bridgeMessages?: { type?: string }[] }).__bridgeMessages?.some((message) => message.type === 'website:disconnect'))).toBe(true)
})
