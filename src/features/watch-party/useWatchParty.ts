import { useCallback, useEffect, useRef, useState } from 'react'
import type { WatchPartyClientRequest, WatchPartyState } from '../../types/watch-party'
import { roomSocketUrl } from './api'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const SYNC_REQUEST_INTERVAL_MS = 4_000
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 10_000

const reconnectDelay = (attempts: number) => Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** Math.min(attempts, 4))

/**
 * A live connection to a watch party room. Reconnects with backoff, and asks
 * for the authoritative state periodically and whenever the tab returns.
 */
export function useWatchParty(roomId: string, accessToken: string | null, initialState: WatchPartyState | null) {
  const [state, setState] = useState<WatchPartyState | null>(initialState)
  const [connection, setConnection] = useState<ConnectionState>('disconnected')
  const socketRef = useRef<WebSocket | null>(null)
  const retryRef = useRef<number | null>(null)
  const stateRef = useRef<WatchPartyState | null>(initialState)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    setState(initialState)
  }, [initialState])

  useEffect(() => {
    if (!accessToken) return
    let stopped = false
    let attempts = 0
    const connect = () => {
      if (stopped) return
      setConnection(attempts ? 'reconnecting' : 'connecting')
      const socket = new WebSocket(roomSocketUrl(roomId, 'socket', { access: accessToken }))
      socketRef.current = socket
      socket.onopen = () => {
        attempts = 0
        setConnection('connected')
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { state?: WatchPartyState }
          if (message.state) setState(message.state)
        } catch {
          // Ignore malformed server messages; the next sync request restores state.
        }
      }
      socket.onclose = () => {
        if (stopped) return
        attempts += 1
        setConnection('reconnecting')
        retryRef.current = window.setTimeout(connect, reconnectDelay(attempts))
      }
      socket.onerror = () => socket.close()
    }
    connect()
    return () => {
      stopped = true
      if (retryRef.current !== null) window.clearTimeout(retryRef.current)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [accessToken, roomId])

  // Returns false when the socket is not open, so nothing was sent.
  const send = useCallback((event: WatchPartyClientRequest) => {
    const socket = socketRef.current
    const current = stateRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN || !current) return false
    socket.send(JSON.stringify({ ...event, eventId: crypto.randomUUID(), baseRevision: current.revision }))
    return true
  }, [])

  useEffect(() => {
    if (!accessToken) return
    const requestSync = () => send({ type: 'room:sync-request' })
    const interval = window.setInterval(requestSync, SYNC_REQUEST_INTERVAL_MS)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') requestSync()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [accessToken, send])

  return { state, connection, send }
}
