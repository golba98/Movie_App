import { DiagnosticRing } from '../diagnostics'
import type { PopupViewState, SocketStatus } from '../types'

const SESSION_KEY = 'watchSyncRoomSession'
const LOCAL_KEY = 'watchSyncPreferences'

// The room connection. Kept in chrome.storage.session so a restarted service
// worker can reconnect; it never outlives the browser session.
interface StoredSession {
  roomId: string | null
  memberId: string | null
  socketUrl: string | null
  extensionToken: string | null
  nonce: string
  clientSessionId: string
  roomTabId: number | null
  status: SocketStatus
  message: string
  reconnectAttempt: number
  // Bumped on every new connection so callbacks from older sockets are ignored.
  reconnectGeneration: number
  revision: number
  role: string | null
  driftMs: number | null
  playerState: PopupViewState['playerState']
  userDisconnected: boolean
  retryStopped: boolean
}

// Remembered across sessions in chrome.storage.local.
interface LocalPreferences {
  // Frame origins the viewer enabled, per top-level site.
  selectedOriginsByTopOrigin: Record<string, string[]>
  diagnosticsEnabled: boolean
}

const emptySession = (): StoredSession => ({
  roomId: null,
  memberId: null,
  socketUrl: null,
  extensionToken: null,
  nonce: crypto.randomUUID(),
  clientSessionId: crypto.randomUUID(),
  roomTabId: null,
  status: 'idle',
  message: 'Open a Fedora Movies watch-party room to connect.',
  reconnectAttempt: 0,
  reconnectGeneration: 0,
  revision: 0,
  role: null,
  driftMs: null,
  playerState: 'unavailable',
  userDisconnected: false,
  retryStopped: false,
})

const emptyPreferences = (): LocalPreferences => ({ selectedOriginsByTopOrigin: {}, diagnosticsEnabled: false })

// Mutated in place, so every module shares the same objects.
export const session: StoredSession = emptySession()
export const preferences: LocalPreferences = emptyPreferences()
export const diagnostics = new DiagnosticRing(500)

let hydrated: Promise<void> | null = null

/** Loads stored state once per service-worker lifetime. */
export function hydrate() {
  hydrated ??= (async () => {
    const [storedSession, storedLocal] = await Promise.all([
      chrome.storage.session.get(SESSION_KEY),
      chrome.storage.local.get(LOCAL_KEY),
    ])
    Object.assign(session, emptySession(), storedSession[SESSION_KEY] as Partial<StoredSession> | undefined)
    Object.assign(preferences, emptyPreferences(), storedLocal[LOCAL_KEY] as Partial<LocalPreferences> | undefined)
  })()
  return hydrated
}

export async function persistSession() {
  await chrome.storage.session.set({ [SESSION_KEY]: session })
}

export async function persistPreferences() {
  await chrome.storage.local.set({ [LOCAL_KEY]: preferences })
}
