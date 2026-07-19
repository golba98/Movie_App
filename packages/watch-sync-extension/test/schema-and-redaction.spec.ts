import { describe, expect, it } from 'vitest'
import { DiagnosticRing, redactDiagnosticValue } from '../src/diagnostics'
import { discoverFrameOrigins, normalizeHttpOrigin, originPattern } from '../src/origins'
import { isInternalMessage, isRoomServerEvent } from '../src/types'

describe('schemas, origins, and diagnostics safety', () => {
  it('normalizes only HTTP(S) origins and discards paths and queries', () => {
    expect(normalizeHttpOrigin('https://player.example/movie?id=secret')).toBe('https://player.example')
    expect(normalizeHttpOrigin('chrome://extensions')).toBeNull()
    expect(originPattern('http://127.0.0.1:4301/path')).toBe('http://127.0.0.1:4301/*')
    expect(discoverFrameOrigins([
      { frameId: 0, url: 'http://127.0.0.1:4300/watch?room=secret' },
      { frameId: 2, url: 'http://127.0.0.1:4301/player?media=secret' },
      { frameId: 3, url: 'data:text/plain,ignored' },
    ])).toEqual({ topOrigin: 'http://127.0.0.1:4300', embeddedOrigins: ['http://127.0.0.1:4301'] })
  })

  it('validates internal connect messages and server events', () => {
    expect(isInternalMessage({
      type: 'bridge:connect',
      roomId: 'room-identifier-1234',
      socketUrl: 'wss://example.test/socket',
      nonce: 'nonce-identifier-1234',
      clientSessionId: 'session-identifier-1234',
      extensionToken: 'x'.repeat(64),
    })).toBe(true)
    expect(isInternalMessage({ type: 'bridge:connect', extensionToken: '' })).toBe(false)
    expect(isRoomServerEvent({ type: 'playback:sync', state: { revision: 1, serverNow: 100 } })).toBe(true)
    expect(isRoomServerEvent({ type: 'mystery', state: {} })).toBe(false)
  })

  it('recursively redacts tokens, headers, cookies, queries, and media-source-like fields', () => {
    const redacted = redactDiagnosticValue({
      token: 'secret',
      nested: { Authorization: 'Bearer abc.def', mediaSource: 'https://cdn.test/movie.mp4?token=abc' },
      message: 'request?room=secret&token=abc',
    })
    expect(JSON.stringify(redacted)).not.toContain('abc.def')
    expect(JSON.stringify(redacted)).not.toContain('movie.mp4')
    expect(JSON.stringify(redacted)).not.toContain('secret')
  })

  it('keeps a bounded metadata-only allowlisted ring', () => {
    const ring = new DiagnosticRing(2)
    ring.add({ kind: 'one', token: 'secret', unknown: 'discard' })
    ring.add({ kind: 'two', revision: 2 })
    ring.add({ kind: 'three', revision: 3 })
    expect(ring.size).toBe(2)
    expect(ring.export().map((entry) => entry.kind)).toEqual(['two', 'three'])
    expect(ring.export()[0]).not.toHaveProperty('unknown')
  })
})
