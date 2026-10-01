import { isRecord } from '../../lib/is-record'
import type { MediaSource, SubtitleSelection } from '../../types/media-source'

const PREFIX = 'fedora-movies:viewing-session:v1'
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

export interface ViewingSession {
  version: 1
  sourceId: string
  sourceFingerprint: string
  duration?: number
  releaseFingerprint?: string
  subtitles?: SubtitleSelection | null
  updatedAt: number
}

// A local change detector, not a security identifier. Never store signed source URLs.
export function sourceFingerprint(source: MediaSource) {
  let hash = 14695981039346656037n
  for (const character of `${source.id}:${source.sourceUrl}`) {
    hash = BigInt.asUintN(64, (hash ^ BigInt(character.charCodeAt(0))) * 1099511628211n)
  }
  return hash.toString(16)
}

function validSubtitle(value: unknown): value is SubtitleSelection {
  return isRecord(value) && typeof value.id === 'string' && value.id.length <= 100
    && value.language === 'en' && ['bundled', 'opensubtitles'].includes(String(value.provider))
    && typeof value.releaseFingerprint === 'string' && /^[a-f0-9]{64}$/.test(value.releaseFingerprint)
    && ['bundled', 'exact-release', 'heuristic'].includes(String(value.confidence))
    && (value.lastCueSeconds === null || (typeof value.lastCueSeconds === 'number' && Number.isFinite(value.lastCueSeconds) && value.lastCueSeconds > 0))
    && (value.runtimeSeconds === null || (typeof value.runtimeSeconds === 'number' && Number.isFinite(value.runtimeSeconds) && value.runtimeSeconds > 0))
}

export function readViewingSession(accountId: string | null, mediaKey: string): ViewingSession | null {
  if (!accountId) return null
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${PREFIX}:${accountId}:${mediaKey}`) ?? 'null')
    if (!isRecord(value) || value.version !== 1 || typeof value.sourceId !== 'string'
      || typeof value.sourceFingerprint !== 'string' || typeof value.updatedAt !== 'number'
      || !Number.isFinite(value.updatedAt) || value.updatedAt > Date.now() + 60_000
      || Date.now() - value.updatedAt > MAX_AGE_MS
      || (value.duration !== undefined && (typeof value.duration !== 'number' || !Number.isFinite(value.duration) || value.duration <= 0 || value.duration > 86400))
      || (value.releaseFingerprint !== undefined && (typeof value.releaseFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.releaseFingerprint)))
      || (value.subtitles != null && !validSubtitle(value.subtitles))) return null
    return {
      version: 1,
      sourceId: value.sourceId,
      sourceFingerprint: value.sourceFingerprint,
      updatedAt: value.updatedAt,
      duration: typeof value.duration === 'number' ? value.duration : undefined,
      releaseFingerprint: typeof value.releaseFingerprint === 'string' ? value.releaseFingerprint : undefined,
      subtitles: validSubtitle(value.subtitles) ? value.subtitles : null,
    }
  } catch {
    return null
  }
}

export function writeViewingSession(accountId: string | null, mediaKey: string, session: Omit<ViewingSession, 'version' | 'updatedAt'>) {
  if (!accountId) return
  try {
    localStorage.setItem(`${PREFIX}:${accountId}:${mediaKey}`, JSON.stringify({ ...session, version: 1, updatedAt: Date.now() }))
  } catch {
    // Storage can be disabled. Playback and account watch-history sync still work.
  }
}
