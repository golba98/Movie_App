import { originPattern } from '../origins'
import type { CandidateSummary, ControllerTarget, InternalMessage, PopupViewState } from '../types'

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
let state: PopupViewState | null = null

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
  container.replaceChildren(...origins.map(({ origin, label, checked }) => {
    const wrapper = document.createElement('label')
    wrapper.className = 'choice'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.name = 'origin'
    input.value = origin
    input.checked = checked || current.grantedOrigins.includes(origin)
    const content = document.createElement('span')
    const strong = document.createElement('strong')
    strong.textContent = label
    const small = document.createElement('small')
    small.textContent = origin
    content.append(strong, small)
    wrapper.append(input, content)
    return wrapper
  }))
  if (!origins.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'Open an HTTP or HTTPS page to scan its frames.'
    container.replaceChildren(empty)
  }
}

function candidateLabel(candidate: CandidateSummary) {
  return `${candidate.width}×${candidate.height} · score ${candidate.score} · ${candidate.paused ? 'paused' : 'playing'}`
}

function renderCandidates(current: PopupViewState) {
  const container = element<HTMLDivElement>('candidates')
  if (!current.candidates.length) {
    const empty = document.createElement('p')
    empty.className = 'empty'
    empty.textContent = 'No eligible native videos detected.'
    container.replaceChildren(empty)
    return
  }
  container.replaceChildren(...current.candidates.map((candidate) => {
    const wrapper = document.createElement('label')
    wrapper.className = 'choice'
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
    const content = document.createElement('span')
    const strong = document.createElement('strong')
    strong.textContent = candidateLabel(candidate)
    const small = document.createElement('small')
    small.textContent = `${candidate.origin} · ${candidate.fingerprint}`
    content.append(strong, small)
    wrapper.append(input, content)
    return wrapper
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
  const patterns = origins.flatMap((origin) => {
    const pattern = originPattern(origin)
    return pattern ? [pattern] : []
  })
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
  const patterns = origins.flatMap((origin) => {
    const pattern = originPattern(origin)
    return pattern ? [pattern] : []
  })
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
    try { return [new URL(pattern.replace(/\/\*$/, '/')).origin] } catch { return [] }
  })
  await send({ type: 'popup:rescan', tabId: state.tabId, grantedOrigins })
  await refresh()
})

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-control]')) {
  button.addEventListener('click', () => void send({ type: 'popup:control', intent: button.dataset.control as 'play' | 'pause' | 'restart' }))
}
element('seek-back').addEventListener('click', () => void send({ type: 'popup:control', intent: 'seek', positionMs: Math.max(0, (state?.positionMs ?? 0) - 10_000) }))
element('seek-forward').addEventListener('click', () => void send({ type: 'popup:control', intent: 'seek', positionMs: Math.max(0, (state?.positionMs ?? 0) + 10_000) }))
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
