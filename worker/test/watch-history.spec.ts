import { env } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { activeViewerCookie, activeViewerCookies, origin, request } from './helpers'

describe('watch history sync', () => {
  const movieItem = {
    id: 1,
    mediaType: 'movie',
    title: 'Dune: Part Two',
    overview: '',
    posterPath: '/dune.jpg',
    backdropPath: null,
    voteAverage: 8.3,
    date: null,
    year: '2024',
  }

  async function readHistory(cookie: string) {
    const response = await request('/api/watch-history', { cookie })
    expect(response.status).toBe(200)
    return ((await response.json()) as {
      data: { entries: Record<string, Record<string, unknown>>; titles: Record<string, Record<string, unknown>> }
    }).data
  }

  function sync(cookie: string, body: unknown) {
    return request('/api/watch-history', { method: 'POST', cookie, origin, body })
  }

  it('requires a signed-in viewer and a same-origin request', async () => {
    expect((await request('/api/watch-history')).status).toBe(401)
    expect((await request('/api/watch-history', { method: 'POST', origin, body: { entries: [] } })).status).toBe(401)
    const { viewer } = await activeViewerCookies()
    expect(
      (await request('/api/watch-history', { method: 'POST', cookie: viewer, origin: 'https://attacker.test', body: {} })).status,
    ).toBe(403)
  })

  it('stores progress and titles so another device can read them', async () => {
    const { viewer } = await activeViewerCookies()
    expect(await readHistory(viewer)).toEqual({ entries: {}, titles: {} })

    const saved = await sync(viewer, {
      entries: [
        { key: 'movie:1', watched: false, position: 1_200, duration: 9_000, updatedAt: 1_700_000_000_000 },
        { key: 'tv:2:1:3', watched: true, updatedAt: 1_700_000_000_500 },
      ],
      titles: [
        { mediaType: 'movie', id: 1, item: movieItem, seasonNumber: 4, episodeNumber: 4, updatedAt: 1_700_000_000_000 },
        { mediaType: 'tv', id: 2, seasonNumber: 1, episodeNumber: 3, updatedAt: 1_700_000_000_500 },
      ],
    })
    expect(saved.status).toBe(200)

    const history = await readHistory(viewer)
    expect(history.entries).toEqual({
      'movie:1': { watched: false, position: 1_200, duration: 9_000, updatedAt: 1_700_000_000_000 },
      'tv:2:1:3': { watched: true, updatedAt: 1_700_000_000_500 },
    })
    expect(history.titles['movie:1']).toEqual({
      mediaType: 'movie',
      id: 1,
      item: movieItem,
      seasonNumber: null,
      episodeNumber: null,
      updatedAt: 1_700_000_000_000,
    })
    expect(history.titles['tv:2']).toEqual({
      mediaType: 'tv',
      id: 2,
      seasonNumber: 1,
      episodeNumber: 3,
      updatedAt: 1_700_000_000_500,
    })
  })

  it('keeps the newest update when devices sync out of order', async () => {
    const { viewer } = await activeViewerCookies()
    await sync(viewer, {
      entries: [{ key: 'movie:1', watched: true, position: 8_900, duration: 9_000, updatedAt: 2_000 }],
      titles: [{ mediaType: 'movie', id: 1, item: movieItem, updatedAt: 2_000 }],
    })
    await sync(viewer, {
      entries: [{ key: 'movie:1', watched: false, position: 30, duration: 9_000, updatedAt: 1_000 }],
      titles: [{ mediaType: 'movie', id: 1, removed: true, updatedAt: 1_000 }],
    })
    let history = await readHistory(viewer)
    expect(history.entries['movie:1']).toMatchObject({ watched: true, position: 8_900, updatedAt: 2_000 })
    expect(history.titles['movie:1']).not.toHaveProperty('removed')

    // A newer removal wins, and keeps the stored card details.
    await sync(viewer, { titles: [{ mediaType: 'movie', id: 1, removed: true, updatedAt: 3_000 }] })
    history = await readHistory(viewer)
    expect(history.titles['movie:1']).toMatchObject({ removed: true, item: movieItem, updatedAt: 3_000 })

    // Clocks set in the future are clamped to the server time.
    await sync(viewer, { entries: [{ key: 'movie:5', watched: true, updatedAt: Date.now() + 86_400_000 }] })
    history = await readHistory(viewer)
    expect(Number(history.entries['movie:5'].updatedAt)).toBeLessThanOrEqual(Date.now())
  })

  it('stores watch time with each entry, newest update winning', async () => {
    const { viewer } = await activeViewerCookies()
    await sync(viewer, { entries: [{ key: 'movie:1', watched: false, watchSeconds: 320.5, updatedAt: 1_000 }] })
    await sync(viewer, { entries: [{ key: 'movie:1', watched: false, watchSeconds: 30, updatedAt: 500 }] })
    let history = await readHistory(viewer)
    expect(history.entries['movie:1']).toEqual({ watched: false, watchSeconds: 320.5, updatedAt: 1_000 })

    await sync(viewer, { entries: [{ key: 'movie:1', watched: true, watchSeconds: 5_400, updatedAt: 2_000 }] })
    history = await readHistory(viewer)
    expect(history.entries['movie:1']).toEqual({ watched: true, watchSeconds: 5_400, updatedAt: 2_000 })
    expect((await sync(viewer, { entries: [{ key: 'movie:1', watchSeconds: -1, updatedAt: 3_000 }] })).status).toBe(400)
  })

  it('rejects malformed items and oversized syncs', async () => {
    const { viewer } = await activeViewerCookies()
    const bad = [
      { entries: [{ key: 'movie:0', watched: true, updatedAt: 1 }] },
      { entries: [{ key: 'tv:1:1', watched: true, updatedAt: 1 }] },
      { entries: [{ key: 'movie:1', watched: true }] },
      { entries: [{ key: 'movie:1', position: -5, updatedAt: 1 }] },
      { titles: [{ mediaType: 'book', id: 1, updatedAt: 1 }] },
      { entries: 'movie:1' },
      { entries: Array.from({ length: 501 }, (_, index) => ({ key: `movie:${index + 1}`, updatedAt: 1 })) },
    ]
    for (const body of bad) {
      const response = await sync(viewer, body)
      expect(response.status).toBe(400)
    }
    expect(await readHistory(viewer)).toEqual({ entries: {}, titles: {} })
  })

  it('keeps each account history separate and deletes it with the account', async () => {
    const { admin, viewer } = await activeViewerCookies()
    const other = await activeViewerCookie(admin, 'viewer.two', 'Viewer Two')
    await sync(viewer, {
      entries: [{ key: 'movie:1', watched: true, updatedAt: 1_000 }],
      titles: [{ mediaType: 'movie', id: 1, item: movieItem, updatedAt: 1_000 }],
    })
    expect(await readHistory(other)).toEqual({ entries: {}, titles: {} })

    const accounts = (await (await request('/api/admin/accounts', { cookie: admin })).json()) as {
      data: { accounts: { id: string; username: string }[] }
    }
    const accountId = accounts.data.accounts.find((account) => account.username === 'viewer.one')!.id
    expect((await request(`/api/admin/accounts/${accountId}`, { method: 'DELETE', cookie: admin, origin })).status).toBe(200)
    const remaining = await env.DB
      .prepare('SELECT (SELECT COUNT(*) FROM watch_entries) AS entries, (SELECT COUNT(*) FROM watch_titles) AS titles')
      .first<{ entries: number; titles: number }>()
    expect(remaining).toEqual({ entries: 0, titles: 0 })
  })
})
