import { useCallback, useEffect, useState } from 'react'
import { errorMessage } from '../../lib/errors'
import { WATCH_PARTY_EXTENSION_CAPABILITY_VERSION } from '../../types/watch-party'
import { mintWatchPartyExtensionToken } from './api'
import {
  extensionSocketUrl,
  isExtensionBridgeMessage,
  postToExtension,
  WATCH_SYNC_BRIDGE_VERSION,
  WATCH_SYNC_WEBSITE_SOURCE,
  type ExtensionBridgeMessage,
  type ExtensionBridgeStatus,
} from './extension-bridge'

// The page announces itself until the extension's content script answers.
const HELLO_INTERVAL_MS = 2_000

type ExtensionHello = Extract<ExtensionBridgeMessage, { type: 'extension:hello' }>

/**
 * Hands a room connection to the companion browser extension, which then
 * drives the native video in another tab. While it is connected the room
 * page is in "companion mode" and unmounts its own player.
 */
export function useExtensionCompanion(roomId: string, accessToken: string) {
  const [hello, setHello] = useState<ExtensionHello | null>(null)
  const [status, setStatus] = useState<ExtensionBridgeStatus>('idle')
  const [message, setMessage] = useState('Open the companion extension, then connect it to this room.')
  const [companionMode, setCompanionMode] = useState(false)

  const report = useCallback((nextStatus: ExtensionBridgeStatus, nextMessage: string) => {
    setStatus(nextStatus)
    setMessage(nextMessage)
  }, [])

  const postToken = useCallback(async (
    type: 'website:connect' | 'website:token',
    nonce: string,
    clientSessionId: string,
  ) => {
    const minted = await mintWatchPartyExtensionToken(roomId, accessToken, {
      nonce,
      clientSessionId,
      capabilityVersion: WATCH_PARTY_EXTENSION_CAPABILITY_VERSION,
    })
    postToExtension({
      source: WATCH_SYNC_WEBSITE_SOURCE,
      type,
      protocolVersion: WATCH_SYNC_BRIDGE_VERSION,
      roomId,
      nonce,
      clientSessionId,
      extensionToken: minted.extensionToken,
      socketUrl: extensionSocketUrl(roomId),
    })
  }, [roomId, accessToken])

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin || !isExtensionBridgeMessage(event.data)) return
      const data = event.data
      if (data.type === 'extension:hello') {
        setHello(data)
        setMessage('Companion extension detected and ready to connect.')
        return
      }
      if (hello && data.clientSessionId !== hello.clientSessionId) return
      if (data.type === 'extension:status') {
        report(data.status, data.message)
        if (data.status === 'connected') setCompanionMode(true)
        return
      }
      if (data.type === 'extension:token-request') {
        report('reconnecting', 'Refreshing the short-lived companion connection…')
        void postToken('website:token', data.nonce, data.clientSessionId).catch(() => {
          report('error', 'Could not refresh the extension token. Keep this room tab open and try again.')
        })
      }
    }
    window.addEventListener('message', receive)
    return () => window.removeEventListener('message', receive)
  }, [hello, postToken, report])

  useEffect(() => {
    if (hello) return
    const ping = () => postToExtension({ source: WATCH_SYNC_WEBSITE_SOURCE, type: 'website:hello', protocolVersion: WATCH_SYNC_BRIDGE_VERSION })
    ping()
    const timer = window.setInterval(ping, HELLO_INTERVAL_MS)
    return () => window.clearInterval(timer)
  }, [hello])

  const connect = async () => {
    if (!hello) {
      report('error', 'Companion extension not detected. Install or reload it, then reopen this room.')
      return
    }
    report('connecting', 'Connecting the companion extension…')
    try {
      await postToken('website:connect', hello.nonce, hello.clientSessionId)
    } catch (caught) {
      report('error', errorMessage(caught, 'Could not connect the companion extension.'))
    }
  }

  const disconnect = () => {
    if (hello) {
      postToExtension({
        source: WATCH_SYNC_WEBSITE_SOURCE,
        type: 'website:disconnect',
        protocolVersion: WATCH_SYNC_BRIDGE_VERSION,
        clientSessionId: hello.clientSessionId,
      })
    }
    setCompanionMode(false)
    report('disconnected', 'Companion disconnected. The in-app player is active again.')
  }

  return { status, message, companionMode, connect, disconnect }
}
