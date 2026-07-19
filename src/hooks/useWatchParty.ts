import { useCallback, useEffect, useRef, useState } from 'react'
import type { WatchPartyClientRequest, WatchPartyState } from '../types/watch-party'

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

function websocketUrl(roomId: string, accessToken: string) {
  const url = new URL(`/api/watch-party/rooms/${encodeURIComponent(roomId)}/socket`, window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('access', accessToken)
  return url.toString()
}

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
      const socket = new WebSocket(websocketUrl(roomId, accessToken))
      socketRef.current = socket
      socket.onopen = () => {
        attempts = 0
        setConnection('connected')
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string; state?: WatchPartyState }
          if (message.state) setState(message.state)
        } catch {
          // Ignore malformed server messages; the next sync request restores state.
        }
      }
      socket.onclose = () => {
        if (stopped) return
        attempts += 1
        setConnection('reconnecting')
        retryRef.current = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** Math.min(attempts, 4)))
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

  const send = useCallback((event: WatchPartyClientRequest) => {
    const socket = socketRef.current
    const current = stateRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN || !current) return false
    socket.send(JSON.stringify({ ...event, eventId: crypto.randomUUID(), baseRevision: current.revision }))
    return true
  }, [])

  useEffect(() => {
    if (!accessToken) return
    const interval = window.setInterval(() => {
      void send({ type: 'room:sync-request' })
    }, 4_000)
    const visible = () => {
      if (document.visibilityState === 'visible') void send({ type: 'room:sync-request' })
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [accessToken, send])

  return { state, setState, connection, send }
}
