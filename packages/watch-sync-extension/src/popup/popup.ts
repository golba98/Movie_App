import { originPattern } from '../origins'
import type { CandidateSummary, ControllerTarget, InternalMessage, PopupViewState } from '../types'

const SEEK_STEP_MS = 10_000

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let state: PopupViewState | null = null

const originPatterns = (origins: string[]) => origins.flatMap((origin) => originPattern(origin) ?? [])

// A labelled checkbox or radio row, as used for origins and candidates.
function choiceRow(input: HTMLInputElement, title: string, detail: string) {
  const wrapper = document.createElement('label')
  wrapper.className = 'choice'
  const content = document.createElement('span')
  const strong = document.createElement('strong')
  strong.textContent = title
  const small = document.createElement('small')
  small.textContent = detail
  content.append(strong, small)
  wrapper.append(input, content)
  return wrapper
}

function emptyMessage(text: string) {
  const empty = document.createElement('p')
  empty.className = 'empty'
  empty.textContent = text
  return empty
}

async function send<T>(message: InternalMessage) {
  return chrome.runtime.sendMessage(message) as Promise<T>
}

function checkedOrigins() {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="origin"]:checked')).map((input) => input.value)
}

function renderOrigins(current: PopupViewState) {
  const container = element<HTMLDivElement>('origins')
  const origins = [
    ...(current.topOrigin ? [{ origin: current.topOrigin, label: 'Top page', checked: true }] : []),
    ...current.embeddedOrigins.map((origin) => ({ origin, label: 'Embedded frame', checked: false })),
  ]
  if (!origins.length) {
    container.replaceChildren(emptyMessage('Open an HTTP or HTTPS page to scan its frames.'))
    return
  }
  container.replaceChildren(...origins.map(({ origin, label, checked }) => {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.name = 'origin'
    input.value = origin
    input.checked = checked || current.grantedOrigins.includes(origin)
    return choiceRow(input, label, origin)
  }))
}

function candidateLabel(candidate: CandidateSummary) {
  return `${candidate.width}×${candidate.height} · score ${candidate.score} · ${candidate.paused ? 'paused' : 'playing'}`
}

function renderCandidates(current: PopupViewState) {
  const container = element<HTMLDivElement>('candidates')
  if (!current.candidates.length) {
    container.replaceChildren(emptyMessage('No eligible native videos detected.'))
    return
  }
  container.replaceChildren(...current.candidates.map((candidate) => {
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'candidate'
    input.checked = current.selectedTarget?.documentId === candidate.documentId && current.selectedTarget.fingerprint === candidate.fingerprint
    input.addEventListener('change', () => {
      if (current.tabId === null) return
      const target: ControllerTarget = {
        tabId: candidate.tabId,
        frameId: candidate.frameId,
        documentId: candidate.documentId,
        fingerprint: candidate.fingerprint,
        manual: true,
      }
      void send({ type: 'popup:select-target', target }).then(refresh)
    })
    return choiceRow(input, candidateLabel(candidate), `${candidate.origin} · ${candidate.fingerprint}`)
  }))
}

function render(current: PopupViewState) {
  state = current
  element('socket-message').textContent = current.socketMessage
  element('socket-status').textContent = current.socketStatus
  element('room-role').textContent = current.roomId ? `${current.roomId.slice(0, 7)}… / ${current.role ?? 'participant'}` : 'Not connected'
  element('revision').textContent = String(current.revision)
  element('drift').textContent = current.driftMs === null ? '—' : `${Math.round(current.driftMs)} ms`
  element('player-state').textContent = current.playerState
  element('reconnect').textContent = String(current.reconnectAttempt)
  element<HTMLInputElement>('diagnostics-toggle').checked = current.diagnosticsEnabled
  renderOrigins(current)
  renderCandidates(current)
}

async function refresh() {
  render(await send<PopupViewState>({ type: 'popup:get-state' }))
}

element('enable').addEventListener('click', async () => {
  if (!state?.tabId) return
  const origins = checkedOrigins()
  const patterns = originPatterns(origins)
  if (!patterns.length) return
  const granted = await chrome.permissions.request({ origins: patterns })
  if (!granted) return
  await send({ type: 'popup:enable', tabId: state.tabId, origins })
  await refresh()
})

element('revoke').addEventListener('click', async () => {
  if (!state?.tabId) return
  const origins = checkedOrigins()
  await send({ type: 'popup:shutdown-origins', tabId: state.tabId, origins })
  const patterns = originPatterns(origins)
  if (patterns.length) {
    try {
      await chrome.permissions.remove({ origins: patterns })
    } catch {
      // Test manifests may pregrant fixture origins permanently; shutdown still applies.
    }
  }
  await refresh()
})

element('rescan').addEventListener('click', async () => {
  if (!state?.tabId) return refresh()
  const grants = await chrome.permissions.getAll()
  const grantedOrigins = (grants.origins ?? []).flatMap((pattern) => {
    try {
      return [new URL(pattern.replace(/\/\*$/, '/')).origin]
    } catch {
      return []
    }
  })
  await send({ type: 'popup:rescan', tabId: state.tabId, grantedOrigins })
  await refresh()
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
  button.addEventListener('click', () => void send({ type: 'popup:control', intent: button.dataset.control as 'play' | 'pause' | 'restart' }))
}
const seekBy = (deltaMs: number) =>
  void send({ type: 'popup:control', intent: 'seek', positionMs: Math.max(0, (state?.positionMs ?? 0) + deltaMs) })
element('seek-back').addEventListener('click', () => seekBy(-SEEK_STEP_MS))
element('seek-forward').addEventListener('click', () => seekBy(SEEK_STEP_MS))
element<HTMLSelectElement>('rate').addEventListener('change', (event) => void send({ type: 'popup:control', intent: 'rate', playbackRate: Number((event.target as HTMLSelectElement).value) }))
element('disconnect').addEventListener('click', () => void send({ type: 'popup:disconnect' }).then(refresh))

element('dev-connect').addEventListener('click', async () => {
  await send({
    type: 'popup:dev-connect',
    roomCode: element<HTMLInputElement>('room-code').value.trim(),
    displayName: element<HTMLInputElement>('display-name').value.trim(),
    password: element<HTMLInputElement>('room-password').value || undefined,
  })
  await refresh()
})

element<HTMLInputElement>('diagnostics-toggle').addEventListener('change', (event) => {
  void send({ type: 'popup:set-diagnostics', enabled: (event.target as HTMLInputElement).checked })
})

element('export-diagnostics').addEventListener('click', async () => {
  const data = await send<Record<string, unknown>>({ type: 'popup:get-diagnostics' })
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `fedora-watch-sync-diagnostics-${Date.now()}.json`
  link.click()
  URL.revokeObjectURL(url)
})

void refresh()
