import { env } from 'cloudflare:workers'
import { runDurableObjectAlarm, SELF } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import worker from '../index'
import { driftCorrection, expectedPlaybackPosition } from '../../src/features/watch-party/sync'
import { activeViewerCookies, createMediaSource, origin, request } from './helpers'

describe('watch party API', () => {
  it('hides every watch party route when WATCH_PARTY_ENABLED is not set', async () => {
    const response = await worker.fetch(
      new Request(`${origin}/api/watch-party/lookup?code=ABCD1234`, {
        headers: { Origin: origin },
      }) as unknown as Parameters<typeof worker.fetch>[0],
      { ...env, WATCH_PARTY_ENABLED: undefined as unknown as string },
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'API route not found.' } })
  })

  async function roomSource(admin: string, tmdbId = 91) {
    const response = await createMediaSource(admin, { tmdbId })
    expect(response.status).toBe(201)
    return ((await response.json()) as { data: { source: { id: string } } }).data.source
  }

  async function createRoom(viewer: string, sourceId: string, overrides: Record<string, unknown> = {}) {
    return request('/api/watch-party/rooms', {
      method: 'POST',
      cookie: viewer,
      origin,
      body: {
        roomName: 'Friday feature',
        sourceId,
        mediaTitle: 'Owned Dune demonstration file',
        posterPath: '/dune.jpg',
        backdropPath: null,
        privacy: 'public',
        maxParticipants: 8,
        controlMode: 'host_only',
        allowLateJoin: true,
        allowMediaChange: false,
        readyUpEnabled: false,
        startWhenEveryoneReady: false,
        pauseForBuffering: false,
        expiresInHours: 24,
        ...overrides,
      },
    })
  }

  async function readyRoom(overrides: Record<string, unknown> = {}) {
    const { admin, viewer } = await activeViewerCookies()
    const source = await roomSource(admin, Math.floor(100 + Math.random() * 1_000_000))
    const response = await createRoom(viewer, source.id, overrides)
    expect(response.status).toBe(201)
    const payload = (await response.json()) as {
      data: { state: { roomId: string; roomCode: string; revision: number }; accessToken: string; memberId: string }
    }
    return payload.data
  }

  async function mintExtensionToken(roomId: string, accessToken: string, nonce: string, clientSessionId: string) {
    return request(`/api/watch-party/rooms/${roomId}/extension-token`, {
      method: 'POST',
      origin,
      headers: { Authorization: `Bearer ${accessToken}` },
      body: { nonce, clientSessionId, capabilityVersion: 1 },
    })
  }

  async function openSocket(path: string, socketOrigin?: string) {
    const response = await request(path, {
      headers: { Upgrade: 'websocket', ...(socketOrigin ? { Origin: socketOrigin } : {}) },
    })
    const webSocket = response.webSocket
    if (webSocket) webSocket.accept()
    return { response, webSocket }
  }

  function nextSocketMessage(webSocket: WebSocket, predicate: (message: Record<string, unknown>) => boolean) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for WebSocket message')), 2_000)
      const listener = (event: MessageEvent) => {
        try {
          const message = JSON.parse(String(event.data)) as Record<string, unknown>
          if (!predicate(message)) return
          clearTimeout(timeout)
          webSocket.removeEventListener('message', listener)
          resolve(message)
        } catch {
          // Wait for the next structured event.
        }
      }
      webSocket.addEventListener('message', listener)
    })
  }

  async function authenticatedExtension(room: Awaited<ReturnType<typeof readyRoom>>, clientSessionId = crypto.randomUUID()) {
    const nonce = crypto.randomUUID()
    const tokenResponse = await mintExtensionToken(room.state.roomId, room.accessToken, nonce, clientSessionId)
    expect(tokenResponse.status).toBe(200)
    const token = ((await tokenResponse.json()) as { data: { extensionToken: string } }).data.extensionToken
    const opened = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'a'.repeat(32)}`)
    expect(opened.response.status).toBe(101)
    expect(opened.webSocket).toBeTruthy()
    const joined = nextSocketMessage(opened.webSocket!, (message) => message.type === 'room:joined')
    opened.webSocket!.send(JSON.stringify({ type: 'extension:authenticate', token, nonce, clientSessionId, capabilityVersion: 1 }))
    await joined
    return { webSocket: opened.webSocket!, token, nonce, clientSessionId }
  }

  it('creates an authenticated public room and lets a guest join with its code', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const source = await roomSource(admin)
    const created = await createRoom(viewer, source.id)
    expect(created.status).toBe(201)
    const data = (await created.json()) as { data: { state: { roomId: string; roomCode: string; participants: { role: string }[] } } }
    expect(data.data.state.participants).toEqual([expect.objectContaining({ role: 'host' })])

    const lookup = await request(`/api/watch-party/lookup?code=${data.data.state.roomCode}`)
    expect(lookup.status).toBe(200)
    const joined = await request(`/api/watch-party/rooms/${data.data.state.roomId}/join`, {
      method: 'POST',
      origin,
      body: { displayName: 'Guest viewer' },
    })
    expect(joined.status).toBe(200)
    const joinedData = (await joined.json()) as { data: { state: { participants: { displayName: string }[] }; accessToken: string } }
    expect(joinedData.data.state.participants).toContainEqual(expect.objectContaining({ displayName: 'Guest viewer' }))
    expect(joinedData.data.accessToken).toBeTruthy()
  })

  it('enforces private passwords, expiry, and server-side direct-source restrictions', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const source = await roomSource(admin, 92)
    const created = await createRoom(viewer, source.id, { privacy: 'private', password: 'a-safe-room-password' })
    expect(created.status).toBe(201)
    const roomId = ((await created.json()) as { data: { state: { roomId: string } } }).data.state.roomId

    expect((await request(`/api/watch-party/rooms/${roomId}/join`, {
      method: 'POST', origin, body: { displayName: 'Guest viewer', password: 'wrong-password' },
    })).status).toBe(403)
    expect((await request(`/api/watch-party/rooms/${roomId}/join`, {
      method: 'POST', origin, body: { displayName: 'Guest viewer', password: 'a-safe-room-password' },
    })).status).toBe(200)

    await env.DB.prepare('UPDATE watch_rooms SET expires_at = ? WHERE id = ?').bind(Date.now() - 1, roomId).run()
    expect((await request(`/api/watch-party/rooms/${roomId}`)).status).toBe(404)
  })

  it('uses timestamp-derived positions and bounded drift correction', () => {
    expect(expectedPlaybackPosition({ playbackState: 'playing', positionMs: 10_000, playbackRate: 1.25, stateUpdatedAt: 1_000 }, 3_000)).toBe(12_500)
    expect(expectedPlaybackPosition({ playbackState: 'paused', positionMs: 10_000, playbackRate: 1.25, stateUpdatedAt: 1_000 }, 3_000)).toBe(10_000)
    expect(driftCorrection(250)).toEqual({ kind: 'none', rate: 1 })
    expect(driftCorrection(700)).toEqual({ kind: 'rate', rate: 1.014 })
    expect(driftCorrection(-700)).toEqual({ kind: 'rate', rate: 0.986 })
    expect(driftCorrection(1_600)).toEqual({ kind: 'seek', rate: 1 })
  })

  it('mints a 120-second participant-scoped extension token without URL credentials', async () => {
    const room = await readyRoom()
    const nonce = crypto.randomUUID()
    const clientSessionId = crypto.randomUUID()
    expect((await mintExtensionToken(room.state.roomId, 'invalid-token', nonce, clientSessionId)).status).toBe(401)
    const minted = await mintExtensionToken(room.state.roomId, room.accessToken, nonce, clientSessionId)
    expect(minted.status).toBe(200)
    const payload = (await minted.json()) as { data: { extensionToken: string; expiresAt: number; capabilityVersion: number } }
    expect(payload.data.capabilityVersion).toBe(1)
    expect(payload.data.expiresAt - Date.now()).toBeGreaterThan(115_000)
    expect(payload.data.expiresAt - Date.now()).toBeLessThanOrEqual(120_000)
    const decoded = JSON.parse(atob(payload.data.extensionToken.split('.')[0].replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(payload.data.extensionToken.split('.')[0].length / 4) * 4, '='))) as Record<string, unknown>
    expect(decoded).toMatchObject({ purpose: 'browser-extension', roomId: room.state.roomId, memberId: room.memberId, nonce, clientSessionId, capabilityVersion: 1 })
    expect(decoded.tokenId).toBeTruthy()
    expect((await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket?access=${room.accessToken}`, `chrome-extension://${'a'.repeat(32)}`)).response.status).toBe(400)
  })

  it('keeps manual room-code extension joining local-only', async () => {
    const room = await readyRoom()
    const body = {
      roomCode: room.state.roomCode,
      displayName: 'Local extension viewer',
      nonce: crypto.randomUUID(),
      clientSessionId: crypto.randomUUID(),
      capabilityVersion: 1,
    }
    expect((await request('/api/watch-party/extension/dev-connect', {
      method: 'POST',
      origin: `chrome-extension://${'f'.repeat(32)}`,
      body,
    })).status).toBe(404)
    const local = await SELF.fetch('http://127.0.0.1/api/watch-party/extension/dev-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: `chrome-extension://${'f'.repeat(32)}` },
      body: JSON.stringify(body),
    })
    expect(local.status).toBe(200)
    const payload = (await local.json()) as { data: { extensionToken: string; memberId: string } }
    expect(payload.data.extensionToken).toBeTruthy()
    expect(payload.data.memberId).toContain('guest:')
  })

  it('rejects invalid extension origins and requires authentication as the first message', async () => {
    const room = await readyRoom()
    expect((await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, 'https://attacker.test')).response.status).toBe(403)
    const opened = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'b'.repeat(32)}`)
    expect(opened.response.status).toBe(101)
    const error = nextSocketMessage(opened.webSocket!, (message) => message.type === 'error')
    opened.webSocket!.send(JSON.stringify({ type: 'room:sync-request', eventId: crypto.randomUUID(), baseRevision: 0 }))
    expect(await error).toMatchObject({ code: 'AUTH_REQUIRED' })
  })

  it('rejects an expired extension token even when the socket itself is newly opened', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-18T05:00:00Z'))
      const room = await readyRoom()
      const nonce = crypto.randomUUID()
      const clientSessionId = crypto.randomUUID()
      const tokenResponse = await mintExtensionToken(room.state.roomId, room.accessToken, nonce, clientSessionId)
      const token = ((await tokenResponse.json()) as { data: { extensionToken: string } }).data.extensionToken
      vi.setSystemTime(new Date('2026-07-18T05:02:01Z'))
      const opened = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'e'.repeat(32)}`)
      const error = nextSocketMessage(opened.webSocket!, (message) => message.type === 'error')
      opened.webSocket!.send(JSON.stringify({ type: 'extension:authenticate', token, nonce, clientSessionId, capabilityVersion: 1 }))
      expect(await error).toMatchObject({ code: 'AUTH_INVALID' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('rejects token replay and expires pending authentication through the room alarm', async () => {
    const room = await readyRoom()
    const first = await authenticatedExtension(room)
    const replay = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'c'.repeat(32)}`)
    const replayError = nextSocketMessage(replay.webSocket!, (message) => message.type === 'error')
    replay.webSocket!.send(JSON.stringify({ type: 'extension:authenticate', token: first.token, nonce: first.nonce, clientSessionId: first.clientSessionId, capabilityVersion: 1 }))
    expect(await replayError).toMatchObject({ code: 'TOKEN_REPLAYED' })

    vi.useFakeTimers()
    vi.setSystemTime(Date.now() + 11_000)
    const pending = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/extension-socket`, `chrome-extension://${'d'.repeat(32)}`)
    const close = new Promise<CloseEvent>((resolve) => pending.webSocket!.addEventListener('close', resolve, { once: true }))
    vi.setSystemTime(Date.now() + 11_000)
    await runDurableObjectAlarm(env.WATCH_PARTY_ROOM.getByName(room.state.roomId))
    await vi.runAllTimersAsync()
    expect((await close).code).toBe(4401)
    vi.useRealTimers()
  })

  it('replaces only the older extension session and keeps the website socket connected', async () => {
    const room = await readyRoom()
    const website = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/socket?access=${encodeURIComponent(room.accessToken)}`, origin)
    expect(website.response.status).toBe(101)
    let websiteClosed = false
    website.webSocket!.addEventListener('close', () => { websiteClosed = true })
    const clientSessionId = crypto.randomUUID()
    const first = await authenticatedExtension(room, clientSessionId)
    const firstClosed = new Promise<CloseEvent>((resolve) => first.webSocket.addEventListener('close', resolve, { once: true }))
    const second = await authenticatedExtension(room, clientSessionId)
    expect((await firstClosed).code).toBe(4001)
    expect(second.webSocket.readyState).toBe(WebSocket.OPEN)
    expect(websiteClosed).toBe(false)
    expect(website.webSocket!.readyState).toBe(WebSocket.OPEN)
  })

  it('stores extension snapshots only in attachments without changing authority or revision', async () => {
    const room = await readyRoom()
    const extension = await authenticatedExtension(room)
    extension.webSocket.send(JSON.stringify({
      type: 'playback:client-snapshot',
      eventId: crypto.randomUUID(),
      baseRevision: room.state.revision,
      positionMs: 55_000,
      playbackState: 'playing',
      playbackRate: 1,
      buffering: false,
      readyState: 4,
      driftMs: 900,
    }))
    await Promise.resolve()
    const summary = await env.WATCH_PARTY_ROOM.getByName(room.state.roomId).summary()
    expect(summary?.revision).toBe(room.state.revision)
    expect(summary?.positionMs).toBe(0)
  })

  it('preserves stale-control and host authority checks while echoing sync event IDs', async () => {
    const room = await readyRoom()
    const website = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/socket?access=${encodeURIComponent(room.accessToken)}`, origin)
    const syncId = crypto.randomUUID()
    const sync = nextSocketMessage(website.webSocket!, (message) => message.type === 'playback:sync')
    website.webSocket!.send(JSON.stringify({ type: 'room:sync-request', eventId: syncId, baseRevision: 0 }))
    expect(await sync).toMatchObject({ eventId: syncId })
    const stale = nextSocketMessage(website.webSocket!, (message) => message.type === 'error')
    website.webSocket!.send(JSON.stringify({ type: 'playback:play-request', eventId: crypto.randomUUID(), baseRevision: 99 }))
    expect(await stale).toMatchObject({ code: 'STALE_REVISION', revision: 0 })
    const accepted = nextSocketMessage(website.webSocket!, (message) => message.type === 'playback:state')
    website.webSocket!.send(JSON.stringify({ type: 'playback:play-request', eventId: crypto.randomUUID(), baseRevision: 0 }))
    const message = await accepted
    expect(message.command).toMatchObject({ reason: 'play' })
    expect((message.command as { executeAtServerMs: number }).executeAtServerMs).toBeGreaterThan(Date.now())
  })

  it('keeps host-only playback authority unchanged for extension-capable rooms', async () => {
    const room = await readyRoom({ controlMode: 'host_only' })
    const joined = await request(`/api/watch-party/rooms/${room.state.roomId}/join`, {
      method: 'POST',
      origin,
      body: { displayName: 'Participant viewer' },
    })
    const guest = (await joined.json()) as { data: { accessToken: string; state: { revision: number } } }
    const guestSocket = await openSocket(`/api/watch-party/rooms/${room.state.roomId}/socket?access=${encodeURIComponent(guest.data.accessToken)}`, origin)
    const forbidden = nextSocketMessage(guestSocket.webSocket!, (message) => message.type === 'error')
    guestSocket.webSocket!.send(JSON.stringify({ type: 'playback:play-request', eventId: crypto.randomUUID(), baseRevision: guest.data.state.revision }))
    expect(await forbidden).toMatchObject({ code: 'CONTROL_FORBIDDEN' })
  })
})
