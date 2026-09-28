import playerControllerFile from '../content/player-controller.ts?iife'
import { discoverFrameOrigins, normalizeHttpOrigin, originPattern } from '../origins'
import { chooseCandidate } from '../scoring'
import type { AuthoritativeState, CandidateSummary, ControllerTarget, FrameTarget, InternalMessage, PlaybackCommandMetadata } from '../types'
import { clock, currentRoomState, playbackRequest, sendRoomEvent, setStatus } from './room-socket'
import { diagnostics, persistPreferences, persistSession, preferences, session } from './store'

type FrameKey = string

// Player controllers injected into frames, and the videos each one reports.
const framePorts = new Map<FrameKey, { port: chrome.runtime.Port; target: FrameTarget }>()
const candidatesByFrame = new Map<FrameKey, CandidateSummary[]>()
let selectedTarget: ControllerTarget | null = null
let manualTarget: ControllerTarget | null = null

export const frameKey = (target: Pick<FrameTarget, 'tabId' | 'frameId' | 'documentId'>) =>
  `${target.tabId}:${target.frameId}:${target.documentId}`

export const senderOrigin = (sender: chrome.runtime.MessageSender) => (sender.url ? normalizeHttpOrigin(sender.url) : null)

export const currentTarget = () => selectedTarget
export const allCandidates = () => [...candidatesByFrame.values()].flat()

function selectedPort() {
  return selectedTarget ? framePorts.get(frameKey(selectedTarget))?.port ?? null : null
}

/** Forwards room state to the controller of the selected video. */
export function routeRoomState(state: AuthoritativeState, command?: PlaybackCommandMetadata) {
  selectedPort()?.postMessage({
    type: 'background:remote-command',
    state,
    command,
    clockOffsetMs: clock.estimate(),
  } satisfies InternalMessage)
}

function forgetFrame(key: FrameKey, notify: boolean) {
  const entry = framePorts.get(key)
  if (notify) entry?.port.postMessage({ type: 'background:shutdown' } satisfies InternalMessage)
  framePorts.delete(key)
  candidatesByFrame.delete(key)
}

export function shutdownAllFrames() {
  for (const entry of framePorts.values()) entry.port.postMessage({ type: 'background:shutdown' } satisfies InternalMessage)
}

/** Picks the video to control: the viewer's manual choice if it still exists, else a clear best candidate. */
function reconcileSelection() {
  const candidateId = (target: Pick<ControllerTarget, 'tabId' | 'documentId' | 'fingerprint'>) =>
    `${target.tabId}:${target.documentId}:${target.fingerprint}`
  const scored = allCandidates().map((candidate) => ({
    id: candidateId(candidate),
    fingerprint: candidate.fingerprint,
    score: candidate.score,
    eligible: true,
    value: candidate,
  }))
  const manual = manualTarget ? { id: candidateId(manualTarget), fingerprint: manualTarget.fingerprint } : null
  const choice = chooseCandidate(scored, manual)
  if (!choice.selected) {
    selectedTarget = null
    return
  }
  const candidate = choice.selected.value
  selectedTarget = {
    tabId: candidate.tabId,
    frameId: candidate.frameId,
    documentId: candidate.documentId,
    fingerprint: candidate.fingerprint,
    manual: choice.reason === 'manual-preserved',
  }
  selectedPort()?.postMessage({ type: 'background:select-target', fingerprint: candidate.fingerprint } satisfies InternalMessage)
  const state = currentRoomState()
  if (state) routeRoomState(state)
}

/** The viewer's choice from the popup; false when that video is no longer reported. */
export function selectTargetManually(target: ControllerTarget) {
  const actual = allCandidates().find((candidate) =>
    candidate.frameId === target.frameId
    && candidate.documentId === target.documentId
    && candidate.fingerprint === target.fingerprint)
  if (!actual) return false
  manualTarget = { ...target, manual: true }
  selectedTarget = manualTarget
  selectedPort()?.postMessage({ type: 'background:select-target', fingerprint: actual.fingerprint } satisfies InternalMessage)
  return true
}

async function safeFrames(tabId: number) {
  const rawFrames = await chrome.webNavigation.getAllFrames({ tabId }) ?? []
  return rawFrames.flatMap((frame) => {
    const origin = normalizeHttpOrigin(frame.url)
    if (!origin) return []
    return [{ tabId, frameId: frame.frameId, documentId: frame.documentId ?? '', origin } satisfies FrameTarget]
  })
}

export async function scanOrigins(tabId: number) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }) ?? []
  return discoverFrameOrigins(frames.map((frame) => ({ frameId: frame.frameId, url: frame.url })))
}

async function injectFrame(target: FrameTarget) {
  const location = { tabId: target.tabId, origin: target.origin }
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: target.tabId, frameIds: [target.frameId] },
      files: [playerControllerFile],
      world: 'ISOLATED',
      injectImmediately: true,
    })
    const documentId = result?.documentId ?? target.documentId
    diagnostics.add({ kind: 'controller-injected', ...location, frameId: result?.frameId ?? target.frameId, documentId, controllerState: 'injected' })
    return { ok: true, documentId }
  } catch (error) {
    diagnostics.add({
      kind: 'controller-inaccessible',
      ...location,
      frameId: target.frameId,
      documentId: target.documentId,
      controllerState: 'inaccessible',
      message: error instanceof Error ? error.message : 'Injection failed',
    })
    return { ok: false, documentId: target.documentId }
  }
}

/** Injects the player controller into the tab's frames from `origins`, and remembers the choice for the site. */
export async function enableOrigins(tabId: number, origins: string[]) {
  const { topOrigin } = await scanOrigins(tabId)
  if (!topOrigin) return { injected: 0, inaccessible: 0 }
  preferences.selectedOriginsByTopOrigin[topOrigin] = [...new Set(origins)]
  await persistPreferences()
  const frames = await safeFrames(tabId)
  const results = await Promise.all(frames.filter((frame) => origins.includes(frame.origin)).map(injectFrame))
  return { injected: results.filter((result) => result.ok).length, inaccessible: results.filter((result) => !result.ok).length }
}

export async function shutdownOrigins(tabId: number, origins: string[]) {
  for (const [key, entry] of framePorts) {
    if (entry.target.tabId === tabId && origins.includes(entry.target.origin)) forgetFrame(key, true)
  }
  const { topOrigin } = await scanOrigins(tabId)
  if (topOrigin) {
    const saved = preferences.selectedOriginsByTopOrigin[topOrigin] ?? []
    preferences.selectedOriginsByTopOrigin[topOrigin] = saved.filter((origin) => !origins.includes(origin))
    await persistPreferences()
  }
}

/** Re-injects into frames of enabled origins after they navigate, when permission still allows. */
export async function handleFrameNavigation(details: { tabId: number; frameId: number; documentId?: string; url: string }) {
  for (const [key, entry] of framePorts) {
    const { target } = entry
    if (target.tabId === details.tabId && target.frameId === details.frameId && target.documentId !== details.documentId) {
      forgetFrame(key, true)
    }
  }
  const origin = normalizeHttpOrigin(details.url)
  if (!origin) return
  const tab = await chrome.tabs.get(details.tabId)
  const topOrigin = tab.url ? normalizeHttpOrigin(tab.url) : null
  if (!topOrigin || !(preferences.selectedOriginsByTopOrigin[topOrigin] ?? []).includes(origin)) return
  const pattern = originPattern(origin)
  if (!pattern || !(await chrome.permissions.contains({ origins: [pattern] }))) return
  await injectFrame({ tabId: details.tabId, frameId: details.frameId, documentId: details.documentId ?? '', origin })
}

export function handleFrameMessage(message: InternalMessage, sender: chrome.runtime.MessageSender) {
  const tabId = sender.tab?.id
  const frameId = sender.frameId
  const documentId = sender.documentId
  const origin = senderOrigin(sender)
  if (tabId === undefined || frameId === undefined || !documentId || !origin) return
  const key = frameKey({ tabId, frameId, documentId })

  switch (message.type) {
    case 'frame:candidates':
      candidatesByFrame.set(key, message.candidates.map((candidate) => ({ ...candidate, tabId, frameId, documentId, origin })))
      diagnostics.add({ kind: 'candidate-update', tabId, frameId, documentId, origin, candidateCount: message.candidates.length })
      reconcileSelection()
      break
    case 'frame:local-intent':
      sendRoomEvent(playbackRequest(message.intent, message.positionMs, message.playbackRate))
      break
    case 'frame:snapshot':
      session.driftMs = message.driftMs
      session.playerState = message.playbackState
      void persistSession()
      sendRoomEvent({ ...message, type: 'playback:client-snapshot' })
      break
    case 'frame:activation-required':
      session.message = message.message
      void setStatus(session.status, message.message)
      break
    case 'frame:unavailable':
      session.playerState = 'unavailable'
      diagnostics.add({ kind: 'player-unavailable', tabId, frameId, documentId, origin, message: message.reason })
      break
  }
}

/** Player controllers connect a long-lived port from their frame. */
export function acceptPlayerPort(port: chrome.runtime.Port, isMessage: (value: unknown) => value is InternalMessage) {
  const tabId = port.sender?.tab?.id
  const frameId = port.sender?.frameId
  const documentId = port.sender?.documentId
  const origin = port.sender ? senderOrigin(port.sender) : null
  if (tabId === undefined || frameId === undefined || !documentId || !origin) return port.disconnect()
  const target = { tabId, frameId, documentId, origin }
  const key = frameKey(target)
  framePorts.set(key, { port, target })
  port.onMessage.addListener((message: unknown) => {
    if (isMessage(message)) handleFrameMessage(message, port.sender!)
  })
  port.onDisconnect.addListener(() => {
    forgetFrame(key, false)
    if (selectedTarget && frameKey(selectedTarget) === key) selectedTarget = null
    reconcileSelection()
  })
}
