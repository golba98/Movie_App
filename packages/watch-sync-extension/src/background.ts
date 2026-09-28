// The extension's service worker: holds the room connection and routes room
// state to the player controller injected into the chosen video's frame.
import { acceptPlayerPort, handleFrameNavigation, routeRoomState } from './background/frames'
import { handleMessage } from './background/messages'
import { onRoomState, reconnectTokenFromRoom } from './background/room-socket'
import { hydrate, session } from './background/store'
import { isInternalMessage } from './types'

onRoomState(routeRoomState)

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'watch-sync-player') acceptPlayerPort(port, isInternalMessage)
})

chrome.runtime.onMessage.addListener((raw: unknown, sender, sendResponse) => {
  if (!isInternalMessage(raw)) return false
  void hydrate()
    .then(() => handleMessage(raw, sender))
    .then(sendResponse)
    .catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : 'Unexpected extension error' }))
  // Keeps the channel open for the asynchronous reply.
  return true
})

chrome.webNavigation.onCommitted.addListener((details) => {
  void hydrate().then(() => handleFrameNavigation(details))
})

// A restarted service worker picks the room connection back up.
void hydrate().then(() => {
  if (session.roomId && !session.userDisconnected && !session.retryStopped) {
    session.reconnectGeneration += 1
    void reconnectTokenFromRoom(session.reconnectGeneration)
  }
})
